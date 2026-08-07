const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { poolPromise } = require("../src/config/db");

async function main() {
  const pool = await poolPromise;
  
  const result = await pool.request().query(`
    SELECT 
      GETDATE() AS sql_local_time,
      GETUTCDATE() AS sql_utc_time,
      SYSDATETIMEOFFSET() AS sql_offset_time
  `);
  
  console.log("=== THỜI GIAN TRÊN SQL SERVER ===");
  console.log("SQL Server Local Time (GETDATE()):", result.recordset[0].sql_local_time);
  console.log("SQL Server UTC Time (GETUTCDATE()):", result.recordset[0].sql_utc_time);
  console.log("SQL Server Offset Time:", result.recordset[0].sql_offset_time);
  console.log("Node.js Server Local Time:", new Date().toString());
  console.log("Node.js Server UTC Time (ISO):", new Date().toISOString());

  // Xem các đơn hàng prepaid mới nhất
  const orders = await pool.request().query(`
    SELECT TOP 5 
      o.id, 
      o.status, 
      o.payment_status, 
      o.created_at,
      DATEDIFF(second, o.created_at, GETDATE()) AS diff_seconds
    FROM orders o
    WHERE o.id IN (SELECT order_id FROM order_payments WHERE method = 'prepaid')
    ORDER BY o.created_at DESC
  `);
  
  console.log("\n=== 5 ĐƠN HÀNG PREPAID MỚI NHẤT ===");
  console.log(JSON.stringify(orders.recordset, null, 2));

  process.exit(0);
}

main().catch(err => {
  console.error("Lỗi:", err);
  process.exit(1);
});
