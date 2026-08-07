const sql = require("mssql");
const { poolPromise } = require("../config/db");

// Hàm thực hiện quét và tự động hủy các đơn hàng thanh toán trước quá 3 phút (180s) chưa thanh toán
async function cleanupExpiredOrders() {
  try {
    const pool = await poolPromise;
    
    // Bước 1: Tìm các đơn hàng PENDING + UNPAID thuộc hình thức thanh toán trước (prepaid) quá 180 giây
    const expiredOrdersResult = await pool.request().query(`
      SELECT o.id, u.email, u.username, o.user_id
      FROM orders o
      INNER JOIN users u ON u.id = o.user_id
      WHERE o.status = 'PENDING'
        AND o.payment_status = 'UNPAID'
        AND o.id IN (
          SELECT order_id 
          FROM order_payments 
          WHERE method = 'prepaid'
        )
        AND DATEDIFF(second, o.created_at, GETDATE()) > 180
    `);
    
    const expiredOrders = expiredOrdersResult.recordset;
    
    if (expiredOrders.length > 0) {
      const expiredIds = expiredOrders.map(r => r.id);
      console.log(`[OrderCleanup] Phát hiện ${expiredIds.length} đơn hàng quá hạn (3 phút). Tiến hành hủy tự động...`);
      
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        // Cập nhật trạng thái đơn hàng sang CANCELLED trong orders
        await new sql.Request(transaction).query(`
          UPDATE orders
          SET status = 'CANCELLED', payment_status = 'CANCELLED'
          WHERE status = 'PENDING'
            AND payment_status = 'UNPAID'
            AND id IN (
              SELECT order_id 
              FROM order_payments 
              WHERE method = 'prepaid'
            )
            AND DATEDIFF(second, created_at, GETDATE()) > 180
        `);
        
        // Cập nhật trạng thái thanh toán trong order_payments sang CANCELLED
        const requestPayments = new sql.Request(transaction);
        await requestPayments.query(`
          UPDATE order_payments
          SET status = 'CANCELLED'
          WHERE status = 'UNPAID'
            AND method = 'prepaid'
            AND order_id IN (${expiredIds.join(",")})
        `);
        
        await transaction.commit();
        console.log(`[OrderCleanup] Đã tự động hủy thành công các đơn hàng ID: ${expiredIds.join(", ")}`);

        // Thông báo realtime cho client đang mở trang Web & Gửi email
        try {
          const { notifyOrderSubscribers } = require("../controllers/orders/realtime");
          const { sendOrderCancelledEmail } = require("./mail.service");
          const { buildInternalOrderCode } = require("../controllers/orders/shared");
          
          for (const order of expiredOrders) {
            // Gửi tín hiệu SSE để frontend tự cập nhật trạng thái đơn hàng
            notifyOrderSubscribers({
              userId: Number(order.user_id || 0) || null,
              orderId: order.id,
              status: "CANCELLED",
            });

            const recipientEmail = order.email || order.username || "";
            if (recipientEmail && recipientEmail.includes("@")) {
              sendOrderCancelledEmail({
                to: recipientEmail,
                displayName: order.username || "Khách hàng",
                orderId: order.id,
                internalCode: buildInternalOrderCode(order.id),
              }).catch(err => console.error(`[OrderCleanup] Gửi email cho đơn #${order.id} thất bại:`, err.message));
            }
          }
        } catch (realtimeErr) {
          console.error("[OrderCleanup] Lỗi gửi thông báo realtime/email:", realtimeErr.message);
        }
      } catch (err) {
        await transaction.rollback();
        throw err;
      }
    }
  } catch (error) {
    console.error("[OrderCleanup] Lỗi trong tiến trình dọn dẹp đơn hàng:", error.message);
  }
}

// Khởi chạy vòng lặp setInterval rà soát mỗi 20 giây
function startCleanupJob() {
  console.log("[OrderCleanup] Đã khởi chạy tiến trình quét hủy đơn hàng hết hạn (3 phút) tự động.");
  setInterval(cleanupExpiredOrders, 20 * 1000);
}

module.exports = {
  startCleanupJob,
  cleanupExpiredOrders
};
