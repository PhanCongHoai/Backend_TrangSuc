const { poolPromise, sql } = require("../config/db");

const DEFAULT_BLOCK_REASON =
  "Tài khoản của bạn đã bị chặn. Vui lòng liên hệ quản trị viên để được hỗ trợ.";

// Chuẩn hóa lý do khóa tài khoản trước khi lưu xuống cơ sở dữ liệu.
const normalizeBlockReason = (value) =>
  String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 500);

// Bảo đảm bảng users đã có các cột phục vụ tính năng khóa tài khoản khách hàng.
const ensureCustomerStatusSchema = async (pool) => {
  await pool.request().query(`
    IF COL_LENGTH('dbo.users', 'block_reason') IS NULL
    BEGIN
      ALTER TABLE dbo.users ADD block_reason NVARCHAR(500) NULL;
    END;

    IF COL_LENGTH('dbo.users', 'blocked_at') IS NULL
    BEGIN
      ALTER TABLE dbo.users ADD blocked_at DATETIME NULL;
    END;
  `);
};

// Định dạng số tiền sang chuỗi tiền tệ VND để hiển thị ở admin.
const formatCurrency = (value) => {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
};

// Lấy danh sách khách hàng và các thống kê phục vụ màn hình quản trị.
const getAdminCustomers = async (req, res) => {
  try {
    const pool = await poolPromise;
    await ensureCustomerStatusSchema(pool);

    const result = await pool.request().query(`
      SELECT
        u.id,
        u.email,
        u.username,
        u.is_active,
        u.block_reason,
        u.blocked_at,
        u.created_at,
        r.role_name,
        profile.full_name,
        ISNULL(COUNT(o.id), 0) AS total_orders,
        ISNULL(SUM(o.total_amount), 0) AS total_spend
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      LEFT JOIN orders o ON o.user_id = u.id
      WHERE r.role_name = 'customer' OR r.role_name IS NULL
      GROUP BY
        u.id,
        u.email,
        u.username,
        u.is_active,
        u.block_reason,
        u.blocked_at,
        u.created_at,
        r.role_name,
        profile.full_name
      ORDER BY u.created_at DESC, u.id DESC
    `);

    // Chuẩn hóa từng dòng khách hàng thành dữ liệu frontend admin sử dụng.
    const customers = result.recordset.map((item) => {
      const totalOrders = Number(item.total_orders || 0);
      const totalSpend = Number(item.total_spend || 0);

      return {
        id: item.id,
        code: `KH${String(item.id).padStart(3, "0")}`,
        name: item.full_name || item.username || "Khach hang JewelryBook",
        email: item.email,
        orders: totalOrders,
        spend: formatCurrency(totalSpend),
        totalSpend,
        isActive: Boolean(item.is_active),
        blockReason: item.block_reason || "",
        blockedAt: item.blocked_at || null,
        createdAt: item.created_at,
      };
    });

    // Thống kê nhanh số lượng khách hoạt động, bị chặn và khách mới.
    const activeCount = customers.filter((item) => item.isActive).length;
    const blockedCount = customers.filter((item) => !item.isActive).length;
    const newCount = customers.filter((item) => {
      if (!item.createdAt) {
        return false;
      }

      const createdAt = new Date(item.createdAt).getTime();
      const days30Ago = Date.now() - 30 * 24 * 60 * 60 * 1000;

      return createdAt >= days30Ago;
    }).length;

    return res.status(200).json({
      success: true,
      customerStats: [
        { label: "Tong khach hang", value: String(customers.length) },
        { label: "Tai khoan hoat dong", value: String(activeCount) },
        { label: "Tai khoan bi chan", value: String(blockedCount) },
        { label: "Moi trong 30 ngay", value: String(newCount) },
      ],
      customerList: customers,
    });
  } catch (error) {
    console.error("Get admin customers error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Cập nhật trạng thái hoạt động của tài khoản khách hàng.
const updateCustomerStatus = async (req, res) => {
  try {
    const customerId = Number(req.params.id);
    const { is_active } = req.body;

    if (Number.isNaN(customerId)) {
      return res.status(400).json({
        success: false,
        message: "Customer id is invalid.",
      });
    }

    if (typeof is_active !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "is_active must be a boolean.",
      });
    }

    const pool = await poolPromise;
    await ensureCustomerStatusSchema(pool);
    const blockReason = normalizeBlockReason(req.body?.block_reason || req.body?.blockReason);

    if (!is_active && !blockReason) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập lý do khóa tài khoản để thông báo cho khách hàng.",
      });
    }

    const result = await pool.request()
      .input("CustomerId", customerId)
      .input("IsActive", is_active ? 1 : 0)
      .input("BlockReason", sql.NVarChar(500), is_active ? null : blockReason || DEFAULT_BLOCK_REASON)
      .query(`
        UPDATE u
        SET
          is_active = @IsActive,
          block_reason = CASE WHEN @IsActive = 1 THEN NULL ELSE @BlockReason END,
          blocked_at = CASE WHEN @IsActive = 1 THEN NULL ELSE GETDATE() END
        OUTPUT INSERTED.id, INSERTED.is_active, INSERTED.block_reason, INSERTED.blocked_at
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = @CustomerId
          AND (r.role_name = 'customer' OR r.role_name IS NULL)
      `);

    const updatedCustomer = result.recordset[0];

    if (!updatedCustomer) {
      return res.status(404).json({
        success: false,
        message: "Customer not found.",
      });
    }

    return res.status(200).json({
      success: true,
      customer: {
        id: updatedCustomer.id,
        isActive: Boolean(updatedCustomer.is_active),
        blockReason: updatedCustomer.block_reason || "",
        blockedAt: updatedCustomer.blocked_at || null,
      },
    });
  } catch (error) {
    console.error("Update customer status error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getAdminCustomers,
  updateCustomerStatus,
};
