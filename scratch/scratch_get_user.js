require("dotenv").config();
const { poolPromise } = require("../src/config/db");
async function main() {
  const pool = await poolPromise;
  const result = await pool.request().query("SELECT TOP 5 id, username, email, is_active FROM users");
  console.log("Users:", JSON.stringify(result.recordset, null, 2));
  process.exit(0);
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
