const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { cleanupExpiredOrders } = require("../src/services/orderCleanup.service");

async function main() {
  console.log("Chạy thử nghiệm cleanupExpiredOrders()...");
  await cleanupExpiredOrders();
  console.log("Hoàn thành chạy thử nghiệm.");
  process.exit(0);
}

main().catch(err => {
  console.error("Lỗi:", err);
  process.exit(1);
});
