const { poolPromise, sql } = require("../../config/db");
const { sendOrderRefundedEmail, sendOrderRefundRejectedEmail } = require("../../services/mail.service");
const { buildInternalOrderCode } = require("./shared");

// Khách hàng tạo yêu cầu hoàn hàng.
const createReturnRequest = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const { orderId, bankName, accountNumber, accountHolderName, reason } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!orderId || !bankName || !accountNumber || !accountHolderName) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập đầy đủ thông tin: Mã đơn hàng, Tên ngân hàng, Số tài khoản và Tên chủ tài khoản.",
      });
    }

    const pool = await poolPromise;

    // 1. Kiểm tra đơn hàng có tồn tại, thuộc về user và có trạng thái hợp lệ không
    const orderResult = await pool.request()
      .input("OrderId", sql.Int, orderId)
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT TOP 1 id, status, total_amount, payment_status
        FROM orders
        WHERE id = @OrderId AND user_id = @UserId
      `);

    const order = orderResult.recordset[0];

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng.",
      });
    }

    // Kiểm tra đơn hàng đã hoàn tất chưa (thường hoàn hàng áp dụng cho đơn hoàn tất hoặc đã thanh toán trước)
    const currentStatus = String(order.status || "").trim().toUpperCase();
    if (["CANCELLED"].includes(currentStatus)) {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng đã bị hủy, không thể yêu cầu hoàn trả.",
      });
    }

    // 2. Kiểm tra xem đã có yêu cầu hoàn trả nào cho đơn này chưa
    const existingResult = await pool.request()
      .input("OrderId", sql.Int, orderId)
      .query(`
        SELECT TOP 1 id, status
        FROM return_requests
        WHERE order_id = @OrderId
      `);
    
    if (existingResult.recordset.length > 0) {
      const existingReq = existingResult.recordset[0];
      return res.status(400).json({
        success: false,
        message: `Đơn hàng đã có yêu cầu hoàn tiền ở trạng thái: ${existingReq.status === 'PENDING' ? 'Chờ xử lý' : 'Đã xử lý'}.`,
      });
    }

    // 3. Tiến hành tạo yêu cầu hoàn tiền
    await pool.request()
      .input("OrderId", sql.Int, orderId)
      .input("UserId", sql.Int, userId)
      .input("BankName", sql.NVarChar(150), bankName.trim())
      .input("AccountNumber", sql.VarChar(50), accountNumber.trim())
      .input("AccountHolderName", sql.NVarChar(150), accountHolderName.trim())
      .input("Reason", sql.NVarChar(500), (reason || "").trim() || null)
      .input("Amount", sql.Decimal(15, 2), Number(order.total_amount || 0))
      .query(`
        INSERT INTO return_requests (order_id, user_id, bank_name, account_number, account_holder_name, reason, amount, status)
        VALUES (@OrderId, @UserId, @BankName, @AccountNumber, @AccountHolderName, @Reason, @Amount, 'PENDING')
      `);

    return res.status(201).json({
      success: true,
      message: "Gửi yêu cầu hoàn hàng thành công. Vui lòng chờ đối soát.",
    });
  } catch (error) {
    console.error("Create return request error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy danh sách yêu cầu hoàn hàng của cá nhân.
const getMyReturnRequests = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const pool = await poolPromise;
    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT 
          r.id,
          r.order_id,
          r.bank_name,
          r.account_number,
          r.account_holder_name,
          r.reason,
          r.amount,
          r.status,
          r.admin_transferred,
          r.transferred_at,
          r.created_at,
          o.status AS order_status
        FROM return_requests r
        INNER JOIN orders o ON o.id = r.order_id
        WHERE r.user_id = @UserId
        ORDER BY r.created_at DESC
      `);

    const data = result.recordset.map(row => ({
      id: Number(row.id),
      orderId: Number(row.order_id),
      orderCode: buildInternalOrderCode(row.order_id),
      bankName: row.bank_name,
      accountNumber: row.account_number,
      accountHolderName: row.account_holder_name,
      reason: row.reason || "",
      amount: Number(row.amount || 0),
      status: row.status,
      adminTransferred: Boolean(row.admin_transferred),
      transferredAt: row.transferred_at,
      createdAt: row.created_at,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get my return requests error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Admin: Lấy danh sách toàn bộ yêu cầu hoàn hàng để đối soát.
const getAdminReturnRequests = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT 
        r.id,
        r.order_id,
        r.user_id,
        r.bank_name,
        r.account_number,
        r.account_holder_name,
        r.reason,
        r.amount,
        r.status,
        r.admin_transferred,
        r.transferred_at,
        r.created_at,
        u.username,
        u.email,
        profile.full_name
      FROM return_requests r
      INNER JOIN users u ON u.id = r.user_id
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      ORDER BY r.status ASC, r.created_at DESC
    `);

    const data = result.recordset.map(row => ({
      id: Number(row.id),
      orderId: Number(row.order_id),
      orderCode: buildInternalOrderCode(row.order_id),
      userId: Number(row.user_id),
      customerName: row.full_name || row.username || "Khách hàng",
      email: row.email || row.username || "",
      bankName: row.bank_name,
      accountNumber: row.account_number,
      accountHolderName: row.account_holder_name,
      reason: row.reason || "",
      amount: Number(row.amount || 0),
      status: row.status,
      adminTransferred: Boolean(row.admin_transferred),
      transferredAt: row.transferred_at,
      createdAt: row.created_at,
    }));

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get admin return requests error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

const sendRefundChatNotification = async (userId, userFullName, orderId, internalCode, amount) => {
  try {
    const { ensureChatSchema } = require("../chat/schema");
    await ensureChatSchema();

    const { ensureConversationForActor, postMessageToConversation } = require("../chat/service");

    const customerActor = {
      type: "user",
      user: {
        id: userId,
        role: "customer",
        fullName: userFullName || "Khách hàng",
      },
      guestKey: null,
      guestName: userFullName || "Khách hàng",
    };

    const conversation = await ensureConversationForActor(customerActor);

    const adminActor = {
      type: "user",
      user: {
        id: null,
        role: "admin",
        fullName: "Hệ thống",
      },
    };

    const formatCurrencyVnd = (value) => {
      return new Intl.NumberFormat("vi-VN", {
        style: "currency",
        currency: "VND",
        maximumFractionDigits: 0,
      }).format(value);
    };

    const messageText = `🔔 **Thông báo hoàn tiền đơn hàng**\n\n` +
      `Yêu cầu hoàn trả cho đơn hàng **${internalCode}** của bạn đã được đối soát thành công và hoàn tất:\n` +
      `• Số tiền hoàn trả: **${formatCurrencyVnd(amount)}**\n` +
      `• Trạng thái: **Đã chuyển khoản hoàn tất**\n\n` +
      `👉 Số tiền đã được chuyển về thông tin tài khoản bạn cung cấp. Vui lòng kiểm tra tài khoản ngân hàng của bạn nhé!`;

    await postMessageToConversation({
      conversationId: conversation.id,
      actor: adminActor,
      message: messageText,
    });

    console.log(`Chat notification sent to customer ID ${userId} about refund of order ${internalCode}`);
  } catch (err) {
    console.error(`Failed to send chat notification for refund to user ${userId}:`, err);
  }
};

// Admin: Xác nhận đã chuyển khoản hoàn tiền thành công.
const confirmAdminReturnRequest = async (req, res) => {
  try {
    const requestId = req.params.id !== undefined ? Number(req.params.id) : null;

    if (requestId === null || isNaN(requestId)) {
      return res.status(400).json({
        success: false,
        message: "Mã yêu cầu hoàn trả không hợp lệ.",
      });
    }

    const pool = await poolPromise;

    // 1. Kiểm tra yêu cầu hoàn hàng có tồn tại không
    const checkResult = await pool.request()
      .input("RequestId", sql.Int, requestId)
      .query(`
        SELECT TOP 1 
          r.id, r.order_id, r.user_id, r.amount, r.bank_name, r.account_number, r.status,
          u.email, u.username
        FROM return_requests r
        INNER JOIN users u ON u.id = r.user_id
        WHERE r.id = @RequestId
      `);

    const reqRow = checkResult.recordset[0];

    if (!reqRow) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy yêu cầu hoàn hàng.",
      });
    }

    if (reqRow.status === "COMPLETED") {
      return res.status(400).json({
        success: false,
        message: "Yêu cầu hoàn trả này đã được hoàn tất trước đó.",
      });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Cập nhật bảng return_requests
      await new sql.Request(transaction)
        .input("RequestId", sql.Int, requestId)
        .query(`
          UPDATE return_requests
          SET status = 'COMPLETED', admin_transferred = 1, transferred_at = GETDATE(), updated_at = GETDATE()
          WHERE id = @RequestId
        `);

      // Cập nhật trạng thái đơn hàng gốc sang CANCELLED và payment_status sang REFUNDED
      await new sql.Request(transaction)
        .input("OrderId", sql.Int, reqRow.order_id)
        .query(`
          UPDATE orders
          SET status = 'CANCELLED', payment_status = 'REFUNDED'
          WHERE id = @OrderId
        `);

      await new sql.Request(transaction)
        .input("OrderId", sql.Int, reqRow.order_id)
        .query(`
          UPDATE order_payments
          SET status = 'UNPAID'
          WHERE order_id = @OrderId
        `);

      await new sql.Request(transaction)
        .input("OrderId", sql.Int, reqRow.order_id)
        .query(`
          UPDATE shipping_orders
          SET status = 'CANCELLED', updated_at = GETDATE()
          WHERE order_id = @OrderId
        `);

      await transaction.commit();

      // Gửi email thông báo hoàn tiền về Gmail cho khách hàng
      const internalCode = buildInternalOrderCode(reqRow.order_id);
      const recipientEmail = reqRow.email || reqRow.username || "";
      if (recipientEmail) {
        sendOrderRefundedEmail({
          to: recipientEmail,
          displayName: reqRow.username || "Khách hàng",
          orderId: reqRow.order_id,
          internalCode,
          amount: reqRow.amount,
          bankName: reqRow.bank_name,
          accountNumber: reqRow.account_number,
        }).catch((err) => {
          console.error("Gửi email hoàn tiền thất bại:", err);
        });
      }

      // Gửi tin nhắn thông báo về phần chat trong hệ thống
      sendRefundChatNotification(
        reqRow.user_id,
        reqRow.username || "Khách hàng",
        reqRow.order_id,
        internalCode,
        reqRow.amount
      ).catch((err) => {
        console.error("Gửi tin nhắn hoàn tiền trong hệ thống thất bại:", err);
      });

      return res.status(200).json({
        success: true,
        message: "Xác nhận đã chuyển khoản hoàn tiền thành công.",
      });
    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }
  } catch (error) {
    console.error("Confirm admin return request error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

const sendRefundRejectedChatNotification = async (userId, userFullName, orderId, internalCode, reason) => {
  try {
    const { ensureChatSchema } = require("../chat/schema");
    await ensureChatSchema();

    const { ensureConversationForActor, postMessageToConversation } = require("../chat/service");

    const customerActor = {
      type: "user",
      user: {
        id: userId,
        role: "customer",
        fullName: userFullName || "Khách hàng",
      },
      guestKey: null,
      guestName: userFullName || "Khách hàng",
    };

    const conversation = await ensureConversationForActor(customerActor);

    const adminActor = {
      type: "user",
      user: {
        id: null,
        role: "admin",
        fullName: "Hệ thống",
      },
    };

    const messageText = `🔔 **Thông báo từ chối hoàn tiền**\n\n` +
      `Yêu cầu hoàn trả cho đơn hàng **${internalCode}** của bạn đã bị từ chối.\n` +
      (reason ? `• Lý do từ chối: *${reason}*\n\n` : `\n`) +
      `Nếu có thắc mắc hoặc cần hỗ trợ thêm, vui lòng phản hồi tại đây hoặc liên hệ bộ phận hỗ trợ khách hàng.`;

    await postMessageToConversation({
      conversationId: conversation.id,
      actor: adminActor,
      message: messageText,
    });

    console.log(`Chat notification sent to customer ID ${userId} about refund rejection of order ${internalCode}`);
  } catch (err) {
    console.error(`Failed to send chat notification for refund rejection to user ${userId}:`, err);
  }
};

// Admin: Từ chối yêu cầu hoàn tiền.
const rejectAdminReturnRequest = async (req, res) => {
  try {
    const requestId = req.params.id !== undefined ? Number(req.params.id) : null;
    const { reason } = req.body;

    if (requestId === null || isNaN(requestId)) {
      return res.status(400).json({
        success: false,
        message: "Mã yêu cầu hoàn trả không hợp lệ.",
      });
    }

    const pool = await poolPromise;

    // 1. Kiểm tra yêu cầu hoàn hàng có tồn tại không
    const checkResult = await pool.request()
      .input("RequestId", sql.Int, requestId)
      .query(`
        SELECT TOP 1 
          r.id, r.order_id, r.user_id, r.amount, r.status,
          u.email, u.username
        FROM return_requests r
        INNER JOIN users u ON u.id = r.user_id
        WHERE r.id = @RequestId
      `);

    const reqRow = checkResult.recordset[0];

    if (!reqRow) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy yêu cầu hoàn hàng.",
      });
    }

    if (reqRow.status !== "PENDING") {
      return res.status(400).json({
        success: false,
        message: "Chỉ có thể từ chối yêu cầu hoàn trả ở trạng thái Chờ đối soát.",
      });
    }

    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      // Cập nhật bảng return_requests sang REJECTED
      await new sql.Request(transaction)
        .input("RequestId", sql.Int, requestId)
        .query(`
          UPDATE return_requests
          SET status = 'REJECTED', updated_at = GETDATE()
          WHERE id = @RequestId
        `);

      await transaction.commit();

      const internalCode = buildInternalOrderCode(reqRow.order_id);
      const recipientEmail = reqRow.email || reqRow.username || "";

      // Gửi email thông báo từ chối về Gmail cho khách hàng
      if (recipientEmail) {
        sendOrderRefundRejectedEmail({
          to: recipientEmail,
          displayName: reqRow.username || "Khách hàng",
          orderId: reqRow.order_id,
          internalCode,
          reason,
        }).catch((err) => {
          console.error("Gửi email từ chối hoàn tiền thất bại:", err);
        });
      }

      // Gửi tin nhắn thông báo về phần chat trong hệ thống
      sendRefundRejectedChatNotification(
        reqRow.user_id,
        reqRow.username || "Khách hàng",
        reqRow.order_id,
        internalCode,
        reason
      ).catch((err) => {
        console.error("Gửi tin nhắn từ chối hoàn tiền trong hệ thống thất bại:", err);
      });

      return res.status(200).json({
        success: true,
        message: "Từ chối yêu cầu hoàn tiền thành công.",
      });
    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }
  } catch (error) {
    console.error("Reject admin return request error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  createReturnRequest,
  getMyReturnRequests,
  getAdminReturnRequests,
  confirmAdminReturnRequest,
  rejectAdminReturnRequest,
};
