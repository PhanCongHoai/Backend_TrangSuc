const { poolPromise, sql } = require("../../config/db");
const {
  ADMIN_ORDER_STATUSES,
  buildInternalOrderCode,
  buildOrderTitle,
  buildReportSummary,
  formatCurrency,
  formatDateTime,
  mapPaymentMethod,
  mapReportRow,
  normalizeReportFilters,
  parseJsonSafe,
} = require("./shared");
const { notifyOrderSubscribers } = require("./realtime");

const resolveDashboardLowStockThreshold = () => {
  const threshold = Number(process.env.DASHBOARD_LOW_STOCK_THRESHOLD || 5);

  if (!Number.isFinite(threshold)) {
    return 5;
  }

  return Math.max(1, Math.floor(threshold));
};

// Chuẩn hóa trạng thái đơn hàng admin về tập giá trị backend cho phép.
const normalizeAdminOrderStatus = (value) => {
  const status = String(value || "").trim().toUpperCase();
  return ADMIN_ORDER_STATUSES.has(status) ? status : "";
};

// Ánh xạ trạng thái đơn hàng admin sang nhãn tiếng Việt hiển thị.
const mapAdminOrderStatus = (value) => {
  const status = normalizeAdminOrderStatus(value);

  if (status === "PENDING") return "Chờ xác nhận";
  if (status === "PROCESSING") return "Đang xử lý";
  if (status === "SHIPPING") return "Đang giao";
  if (status === "COMPLETED") return "Hoàn tất";
  if (status === "CANCELLED") return "Đã hủy";
  return "Chờ xác nhận";
};

// Tính các chỉ số tổng quan cho dashboard danh sách đơn hàng admin.
const buildAdminOrderSummary = (orders = []) => {
  const countByStatus = orders.reduce((acc, order) => {
    const status = normalizeAdminOrderStatus(order.status) || "PENDING";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
  const totalRevenue = orders
    .filter((order) => normalizeAdminOrderStatus(order.status) !== "CANCELLED")
    .reduce((sum, order) => sum + Number(order.total_amount || 0), 0);

  return [
    { label: "Tổng đơn hàng", value: String(orders.length) },
    { label: "Chờ xác nhận", value: String(countByStatus.PENDING || 0) },
    { label: "Đang xử lý", value: String(countByStatus.PROCESSING || 0) },
    { label: "Đang giao", value: String(countByStatus.SHIPPING || 0) },
    { label: "Hoàn tất", value: String(countByStatus.COMPLETED || 0) },
    { label: "Doanh thu hợp lệ", value: formatCurrency(totalRevenue) },
  ];
};

// Chuẩn hóa một đơn hàng thành payload chi tiết cho giao diện quản trị.
const mapAdminOrder = (order, items = []) => {
  const shippingAddress = parseJsonSafe(order.shipping_address, {});
  const paymentLog = parseJsonSafe(order.payment_log, {});
  const normalizedStatus = normalizeAdminOrderStatus(order.status) || "PENDING";
  const recipientName =
    shippingAddress?.fullName ||
    order.full_name ||
    order.username ||
    order.email ||
    "Khách hàng JewelryBook";
  const orderItems = items.map((item) => ({
    productId: Number(item.product_id || 0),
    variantId: Number(item.variant_id || 0),
    name: item.product_name || "Sản phẩm",
    sku: item.sku || "",
    size: item.size || "",
    quantity: Number(item.quantity || 0),
    unitPrice: Number(item.unit_price || 0),
    totalPrice: Number(item.total_price || 0),
  }));

  return {
    id: Number(order.id),
    code: buildInternalOrderCode(order.id),
    customer: recipientName,
    email: shippingAddress?.email || order.email || "",
    phone: shippingAddress?.phone || order.phone || "",
    address: shippingAddress?.fullAddress || shippingAddress?.streetAddress || "",
    note: shippingAddress?.note || "",
    item: buildOrderTitle(orderItems),
    items: orderItems,
    subtotal: Number(order.sub_total || 0),
    discount: Number(order.discount_amount || 0),
    total: Number(order.total_amount || 0),
    formattedTotal: formatCurrency(order.total_amount),
    status: normalizedStatus,
    statusLabel: mapAdminOrderStatus(normalizedStatus),
    paymentStatus: order.payment_status || "",
    paymentMethod: order.payment_method || "",
    paymentLabel: paymentLog?.paymentLabel || mapPaymentMethod(order.payment_method),
    paymentReference: paymentLog?.paymentReference || "",
    paidAt: paymentLog?.paidAt || null,
    sepayTransactionId:
      paymentLog?.sepay?.id || paymentLog?.sepayTransactionId || order.transaction_id || "",
    shippingCode: order.tracking_code || order.shipping_code || "",
    shippingStatus: order.shipping_status || "",
    createdAt: order.created_at,
    createdAtLabel: formatDateTime(order.created_at),
  };
};

// Trả về báo cáo doanh thu theo ngày, tháng hoặc năm cho quản trị viên.
const getAdminRevenueReport = async (req, res) => {
  try {
    const { period, year, month } = normalizeReportFilters(req.query);
    const pool = await poolPromise;
    let result;

    if (period === "day") {
      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
      result = await pool
        .request()
        .input("StartDate", sql.Date, startDate)
        .query(`
          DECLARE @EndDate DATE = DATEADD(MONTH, 1, @StartDate);

          ;WITH buckets AS (
            SELECT CAST(@StartDate AS DATE) AS bucket_date
            UNION ALL
            SELECT DATEADD(DAY, 1, bucket_date)
            FROM buckets
            WHERE bucket_date < DATEADD(DAY, -1, @EndDate)
          ),
          aggregated AS (
            SELECT
              CAST(o.created_at AS DATE) AS bucket_date,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN o.total_amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'COMPLETED' THEN o.total_amount ELSE 0 END) AS completed_revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN 1 ELSE 0 END) AS order_count,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count
            FROM orders o
            WHERE o.created_at >= @StartDate
              AND o.created_at < @EndDate
            GROUP BY CAST(o.created_at AS DATE)
          )
          SELECT
            CONVERT(VARCHAR(10), b.bucket_date, 23) AS bucket,
            CONCAT(DAY(b.bucket_date), '/', MONTH(b.bucket_date)) AS label,
            ISNULL(a.revenue, 0) AS revenue,
            ISNULL(a.completed_revenue, 0) AS completed_revenue,
            ISNULL(a.order_count, 0) AS order_count,
            ISNULL(a.cancelled_count, 0) AS cancelled_count
          FROM buckets b
          LEFT JOIN aggregated a ON a.bucket_date = b.bucket_date
          ORDER BY b.bucket_date ASC
          OPTION (MAXRECURSION 366);
        `);
    } else if (period === "month") {
      result = await pool
        .request()
        .input("Year", sql.Int, year)
        .query(`
          ;WITH buckets AS (
            SELECT 1 AS month_number
            UNION ALL
            SELECT month_number + 1
            FROM buckets
            WHERE month_number < 12
          ),
          aggregated AS (
            SELECT
              MONTH(o.created_at) AS month_number,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN o.total_amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'COMPLETED' THEN o.total_amount ELSE 0 END) AS completed_revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN 1 ELSE 0 END) AS order_count,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count
            FROM orders o
            WHERE YEAR(o.created_at) = @Year
            GROUP BY MONTH(o.created_at)
          )
          SELECT
            CONCAT(@Year, '-', RIGHT('0' + CAST(b.month_number AS VARCHAR(2)), 2)) AS bucket,
            CONCAT(N'Thang ', b.month_number) AS label,
            ISNULL(a.revenue, 0) AS revenue,
            ISNULL(a.completed_revenue, 0) AS completed_revenue,
            ISNULL(a.order_count, 0) AS order_count,
            ISNULL(a.cancelled_count, 0) AS cancelled_count
          FROM buckets b
          LEFT JOIN aggregated a ON a.month_number = b.month_number
          ORDER BY b.month_number ASC
          OPTION (MAXRECURSION 12);
        `);
    } else {
      const startYear = year - 4;
      result = await pool
        .request()
        .input("StartYear", sql.Int, startYear)
        .input("EndYear", sql.Int, year)
        .query(`
          ;WITH buckets AS (
            SELECT @StartYear AS year_number
            UNION ALL
            SELECT year_number + 1
            FROM buckets
            WHERE year_number < @EndYear
          ),
          aggregated AS (
            SELECT
              YEAR(o.created_at) AS year_number,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN o.total_amount ELSE 0 END) AS revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'COMPLETED' THEN o.total_amount ELSE 0 END) AS completed_revenue,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN 1 ELSE 0 END) AS order_count,
              SUM(CASE WHEN UPPER(ISNULL(o.status, '')) = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_count
            FROM orders o
            WHERE YEAR(o.created_at) BETWEEN @StartYear AND @EndYear
            GROUP BY YEAR(o.created_at)
          )
          SELECT
            CAST(b.year_number AS VARCHAR(4)) AS bucket,
            CAST(b.year_number AS VARCHAR(4)) AS label,
            ISNULL(a.revenue, 0) AS revenue,
            ISNULL(a.completed_revenue, 0) AS completed_revenue,
            ISNULL(a.order_count, 0) AS order_count,
            ISNULL(a.cancelled_count, 0) AS cancelled_count
          FROM buckets b
          LEFT JOIN aggregated a ON a.year_number = b.year_number
          ORDER BY b.year_number ASC
          OPTION (MAXRECURSION 10);
        `);
    }

    const rows = result.recordset.map(mapReportRow);

    return res.status(200).json({
      success: true,
      filters: { period, year, month },
      summary: buildReportSummary(rows),
      data: rows,
    });
  } catch (error) {
    console.error("Get admin revenue report error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể tải báo cáo doanh thu.",
    });
  }
};

// Lấy 4 chỉ số thật cho trang bảng điều khiển quản trị trong ngày hiện tại.
const getAdminDashboardSummary = async (req, res) => {
  try {
    const pool = await poolPromise;
    const lowStockThreshold = resolveDashboardLowStockThreshold();
    const result = await pool
      .request()
      .input("LowStockThreshold", sql.Int, lowStockThreshold)
      .query(`
        DECLARE @Today DATE = CAST(GETDATE() AS DATE);
        DECLARE @Tomorrow DATE = DATEADD(DAY, 1, @Today);

        ;WITH low_stock_products AS (
          SELECT
            p.id,
            SUM(ISNULL(stock.quantity, 0)) AS total_stock
          FROM products p
          INNER JOIN product_variants pv ON pv.product_id = p.id
          LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
          WHERE UPPER(ISNULL(p.status, 'ACTIVE')) = 'ACTIVE'
          GROUP BY p.id
        )
        SELECT
          (
            SELECT COUNT(1)
            FROM orders o
            WHERE o.created_at >= @Today
              AND o.created_at < @Tomorrow
          ) AS today_orders,
          (
            SELECT ISNULL(SUM(CASE WHEN UPPER(ISNULL(o.status, '')) <> 'CANCELLED' THEN o.total_amount ELSE 0 END), 0)
            FROM orders o
            WHERE o.created_at >= @Today
              AND o.created_at < @Tomorrow
          ) AS today_revenue,
          (
            SELECT COUNT(1)
            FROM users u
            LEFT JOIN roles r ON r.id = u.role_id
            WHERE u.created_at >= @Today
              AND u.created_at < @Tomorrow
              AND (r.role_name = 'customer' OR r.role_name IS NULL)
          ) AS today_new_customers,
          (
            SELECT COUNT(1)
            FROM low_stock_products lsp
            WHERE lsp.total_stock > 0
              AND lsp.total_stock <= @LowStockThreshold
          ) AS low_stock_products
      `);

    const summary = result.recordset[0] || {};

    return res.status(200).json({
      success: true,
      summary: {
        todayOrders: Number(summary.today_orders || 0),
        todayRevenue: Number(summary.today_revenue || 0),
        todayNewCustomers: Number(summary.today_new_customers || 0),
        lowStockProducts: Number(summary.low_stock_products || 0),
        lowStockThreshold,
      },
      stats: [
        { label: "Đơn hàng trong ngày", value: String(Number(summary.today_orders || 0)) },
        { label: "Doanh thu trong ngày", value: formatCurrency(summary.today_revenue || 0) },
        { label: "Khách hàng mới đăng ký", value: String(Number(summary.today_new_customers || 0)) },
        { label: "Sản phẩm sắp hết", value: String(Number(summary.low_stock_products || 0)) },
      ],
    });
  } catch (error) {
    console.error("Get admin dashboard summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể tải dữ liệu bảng điều khiển.",
    });
  }
};

// Lấy toàn bộ đơn hàng kèm danh sách sản phẩm và thông tin thanh toán cho admin.
const getAdminOrders = async (req, res) => {
  try {
    const pool = await poolPromise;
    const ordersResult = await pool.request().query(`
      SELECT
        o.id,
        o.user_id,
        o.sub_total,
        o.discount_amount,
        o.total_amount,
        o.status,
        o.payment_status,
        o.shipping_code,
        o.shipping_address,
        o.created_at,
        u.email,
        u.username,
        profile.full_name,
        profile.phone,
        ship.tracking_code,
        ship.status AS shipping_status,
        payment.method AS payment_method,
        payment.transaction_id,
        payment.payment_log
      FROM orders o
      LEFT JOIN users u ON u.id = o.user_id
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      LEFT JOIN shipping_orders ship ON ship.order_id = o.id
      OUTER APPLY (
        SELECT TOP 1 method, transaction_id, payment_log
        FROM order_payments
        WHERE order_id = o.id
        ORDER BY created_at DESC, id DESC
      ) payment
      ORDER BY o.created_at DESC, o.id DESC
    `);

    const orders = ordersResult.recordset;

    if (!orders.length) {
      return res.status(200).json({
        success: true,
        summary: buildAdminOrderSummary([]),
        orders: [],
      });
    }

    const itemRequest = pool.request();
    const orderIdParams = orders.map((order, index) => {
      const key = `OrderId${index}`;
      itemRequest.input(key, sql.Int, Number(order.id));
      return `@${key}`;
    });

    const itemsResult = await itemRequest.query(`
      SELECT
        oi.order_id,
        oi.variant_id,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        pv.product_id,
        pv.sku,
        pv.size,
        p.name AS product_name
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id IN (${orderIdParams.join(", ")})
      ORDER BY oi.order_id DESC, oi.id ASC
    `);

    const itemsByOrderId = itemsResult.recordset.reduce((acc, item) => {
      const key = Number(item.order_id);
      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {});

    return res.status(200).json({
      success: true,
      summary: buildAdminOrderSummary(orders),
      orders: orders.map((order) => mapAdminOrder(order, itemsByOrderId[Number(order.id)] || [])),
    });
  } catch (error) {
    console.error("Get admin orders error:", error);
    return res.status(500).json({
        success: false,
        message: "Không thể tải danh sách đơn hàng.",
      });
  }
};

// Cập nhật trạng thái đơn hàng từ giao diện quản trị và đồng bộ trạng thái liên quan.
const updateAdminOrderStatus = async (req, res) => {
  const orderId = Number(req.params.id);
  const nextStatus = normalizeAdminOrderStatus(req.body?.status);

  if (Number.isNaN(orderId) || orderId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Mã đơn hàng không hợp lệ.",
    });
  }

  if (!nextStatus) {
    return res.status(400).json({
      success: false,
      message: "Trạng thái đơn hàng không hợp lệ.",
    });
  }

  let transaction;

  try {
    const pool = await poolPromise;
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const updateResult = await new sql.Request(transaction)
      .input("OrderId", sql.Int, orderId)
      .input("Status", sql.VarChar(50), nextStatus)
      .input(
        "PaymentStatus",
        sql.VarChar(50),
        nextStatus === "COMPLETED" ? "PAID" : null,
      )
      .query(`
        UPDATE orders
        SET
          status = @Status,
          payment_status = CASE
            WHEN @PaymentStatus IS NULL THEN payment_status
            ELSE @PaymentStatus
          END
        OUTPUT
          INSERTED.id,
          INSERTED.user_id,
          INSERTED.status,
          INSERTED.payment_status
        WHERE id = @OrderId
      `);

    const updatedOrder = updateResult.recordset[0];

    if (!updatedOrder) {
      await transaction.rollback();
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng.",
      });
    }

    if (nextStatus === "SHIPPING") {
      await new sql.Request(transaction)
        .input("OrderId", sql.Int, orderId)
        .input("ShippingStatus", sql.VarChar(50), "SHIPPING")
        .query(`
          UPDATE shipping_orders
          SET status = @ShippingStatus, updated_at = GETDATE()
          WHERE order_id = @OrderId
        `);
    }

    if (nextStatus === "COMPLETED") {
      await new sql.Request(transaction)
        .input("OrderId", sql.Int, orderId)
        .input("PaymentStatus", sql.VarChar(50), updatedOrder.payment_status)
        .query(`
          UPDATE order_payments
          SET status = @PaymentStatus
          WHERE order_id = @OrderId
        `);

      await new sql.Request(transaction)
        .input("OrderId", sql.Int, orderId)
        .query(`
          UPDATE shipping_orders
          SET status = 'DELIVERED', updated_at = GETDATE()
          WHERE order_id = @OrderId
        `);
    }

    if (nextStatus === "CANCELLED") {
      await new sql.Request(transaction)
        .input("OrderId", sql.Int, orderId)
        .query(`
          UPDATE shipping_orders
          SET status = 'CANCELLED', updated_at = GETDATE()
          WHERE order_id = @OrderId
        `);
    }

    await transaction.commit();
    notifyOrderSubscribers({
      orderId: Number(updatedOrder.id),
      userId: Number(updatedOrder.user_id || 0),
      reason: "status-updated",
      status: updatedOrder.status,
      paymentStatus: updatedOrder.payment_status,
    });

    return res.status(200).json({
      success: true,
      order: {
        id: Number(updatedOrder.id),
        status: updatedOrder.status,
        statusLabel: mapAdminOrderStatus(updatedOrder.status),
        paymentStatus: updatedOrder.payment_status,
      },
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback update admin order status error:", rollbackError);
      }
    }

    console.error("Update admin order status error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể cập nhật trạng thái đơn hàng.",
    });
  }
};

module.exports = {
  getAdminDashboardSummary,
  getAdminOrders,
  getAdminRevenueReport,
  updateAdminOrderStatus,
};
