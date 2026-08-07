const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { poolPromise } = require("../src/config/db");

async function main() {
  const pool = await poolPromise;
  
  console.log("=== KIEM TRA CAC TIEN TRINH DANG BI KHOA TRÊN SQL SERVER ===");
  const locks = await pool.request().query(`
    SELECT 
        spid,
        blocked,
        waittime,
        lastwaittype,
        status,
        cmd,
        loginame
    FROM tempdb.dbo.sysprocesses
    WHERE blocked <> 0 OR spid IN (SELECT blocked FROM tempdb.dbo.sysprocesses WHERE blocked <> 0);
  `);
  
  console.log(JSON.stringify(locks.recordset, null, 2));

  console.log("\n=== CONG VIEC CHAY THU DBCC OPENTRAN ===");
  try {
    const openTran = await pool.request().query("DBCC OPENTRAN WITH TABLERESULTS;");
    console.log(JSON.stringify(openTran.recordset, null, 2));
  } catch (e) {
    console.log("DBCC OPENTRAN khong co giao dich nao mo hoac loi:", e.message);
  }

  process.exit(0);
}

main().catch(err => {
  console.error("Loi:", err);
  process.exit(1);
});
