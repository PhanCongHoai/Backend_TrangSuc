require('dotenv').config({ path: 'c:/Users/ASUS/Documents/Demo/Web_TrangSuc1/Web_TrangSuc/backend/.env' });
const { poolPromise } = require('../src/config/db.js');

const check = async () => {
  try {
    const pool = await poolPromise;
    const res = await pool.request().query(`
      SELECT DISTINCT p.material_type, c.name AS category_name
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
    `);
    console.log("Product categories and materials in DB:", res.recordset);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
};

check();
