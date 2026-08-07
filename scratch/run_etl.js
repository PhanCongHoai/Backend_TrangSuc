const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const etlService = require("../src/services/etl.service");

async function main() {
  console.log("=== KICH HOAT TIEN TRINH ETL THU CONG ===");
  const result = await etlService.run();
  
  if (result.success) {
    console.log("\n[ETL SUCCESS]");
    console.log("So san pham dong bo:", result.productsSynced);
    console.log("So luong dong ban hang dong bo:", result.salesSynced);
  } else {
    console.log("\n[ETL FAILED]");
    console.error("Loi chi tiet:", result.error);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Loi chay kich hoat etl:", err);
  process.exit(1);
});
