const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { poolPromise } = require("../src/config/db");

async function main() {
  const pool = await poolPromise;
  
  console.log("=== TRANG THAI CAC DATABASE TREN SQL SERVER ===");
  const dbs = await pool.request().query(`
    SELECT name, state_desc, user_access_desc 
    FROM sys.databases;
  `);
  
  console.log(JSON.stringify(dbs.recordset, null, 2));
  process.exit(0);
}

main().catch(err => {
  console.error("Loi:", err);
  process.exit(1);
});
