const sql = require("mssql");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const config = {
  server: String(process.env.DB_SERVER || "localhost").trim(),
  port: parseInt(process.env.DB_PORT) || 1433,
  database: "JewelryStoreDWH",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    useUTC: false,
  },
  authentication: {
    type: "default",
    options: {
      userName: String(process.env.DB_USER || "").trim(),
      password: String(process.env.DB_PASSWORD || "").trim(),
    },
  },
  pool: { max: 1 }
};

async function main() {
  console.log("Connecting to JewelryStoreDWH...");
  const pool = new sql.ConnectionPool(config);
  await pool.connect();
  console.log("Connected successfully!");

  console.log("Creating DIM_PRODUCTS table...");
  await pool.request().query(`
    IF OBJECT_ID('dbo.DIM_PRODUCTS', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.DIM_PRODUCTS (
            product_key INT IDENTITY(1,1) PRIMARY KEY,
            original_product_id INT NOT NULL,
            product_name NVARCHAR(400) NOT NULL,
            category_name NVARCHAR(300) NULL,
            material_type NVARCHAR(100) NULL,
            base_weight FLOAT NULL,
            current_price DECIMAL(18,2) NULL,
            capital_cost DECIMAL(18,2) NULL,
            stock_quantity INT DEFAULT 0,
            status VARCHAR(50) NULL,
            last_sync_at DATETIME DEFAULT GETDATE(),
            CONSTRAINT UC_DIM_PRODUCTS_original UNIQUE(original_product_id)
        );
    END
  `);
  console.log("Success creating DIM_PRODUCTS!");

  console.log("Creating DIM_DATES table...");
  await pool.request().query(`
    IF OBJECT_ID('dbo.DIM_DATES', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.DIM_DATES (
            date_key INT PRIMARY KEY,
            full_date DATE NOT NULL,
            day_of_month INT NOT NULL,
            month INT NOT NULL,
            quarter INT NOT NULL,
            year INT NOT NULL,
            day_name NVARCHAR(50) NOT NULL,
            month_name NVARCHAR(50) NOT NULL
        );
    END
  `);
  console.log("Success creating DIM_DATES!");

  console.log("Creating FACT_PRODUCT_SALES table...");
  await pool.request().query(`
    IF OBJECT_ID('dbo.FACT_PRODUCT_SALES', 'U') IS NULL
    BEGIN
        CREATE TABLE dbo.FACT_PRODUCT_SALES (
            sale_id INT IDENTITY(1,1) PRIMARY KEY,
            date_key INT NOT NULL,
            product_key INT NOT NULL,
            original_order_id INT NOT NULL,
            quantity_sold INT NOT NULL,
            revenue DECIMAL(18,2) NOT NULL,
            cost DECIMAL(18,2) NOT NULL,
            profit DECIMAL(18,2) NOT NULL,
            created_at DATETIME DEFAULT GETDATE(),
            CONSTRAINT FK_FACT_SALES_DATES FOREIGN KEY (date_key) REFERENCES dbo.DIM_DATES(date_key),
            CONSTRAINT FK_FACT_SALES_PRODUCTS FOREIGN KEY (product_key) REFERENCES dbo.DIM_PRODUCTS(product_key)
        );
    END
  `);
  console.log("Success creating FACT_PRODUCT_SALES!");

  console.log("Checking and seeding DIM_DATES...");
  const dateCheck = await pool.request().query("SELECT COUNT(*) AS count FROM dbo.DIM_DATES");
  console.log("Current DIM_DATES count:", dateCheck.recordset[0].count);
  if (dateCheck.recordset[0].count === 0) {
    console.log("Seeding dates...");
    await pool.request().query(`
      DECLARE @StartDate DATE = '2024-01-01';
      DECLARE @EndDate DATE = '2028-12-31';

      WITH DateCTE AS (
          SELECT @StartDate AS DateVal
          UNION ALL
          SELECT DATEADD(day, 1, DateVal)
          FROM DateCTE
          WHERE DateVal < @EndDate
      )
      INSERT INTO dbo.DIM_DATES (date_key, full_date, day_of_month, month, quarter, year, day_name, month_name)
      SELECT 
          YEAR(DateVal) * 10000 + MONTH(DateVal) * 100 + DAY(DateVal) AS date_key,
          DateVal AS full_date,
          DAY(DateVal) AS day_of_month,
          MONTH(DateVal) AS month,
          DATEPART(quarter, DateVal) AS quarter,
          YEAR(DateVal) AS year,
          CASE DATEPART(weekday, DateVal)
              WHEN 1 THEN N'Chủ Nhật'
              WHEN 2 THEN N'Thứ Hai'
              WHEN 3 THEN N'Thứ Ba'
              WHEN 4 THEN N'Thứ Tư'
              WHEN 5 THEN N'Thứ Năm'
              WHEN 6 THEN N'Thứ Sáu'
              WHEN 7 THEN N'Thứ Bảy'
          END AS day_name,
          CASE MONTH(DateVal)
              WHEN 1 THEN N'Tháng Một'
              WHEN 2 THEN N'Tháng Hai'
              WHEN 3 THEN N'Tháng Ba'
              WHEN 4 THEN N'Tháng Tư'
              WHEN 5 THEN N'Tháng Năm'
              WHEN 6 THEN N'Tháng Sáu'
              WHEN 7 THEN N'Tháng Bảy'
              WHEN 8 THEN N'Tháng Tám'
              WHEN 9 THEN N'Tháng Chín'
              WHEN 10 THEN N'Tháng Mười'
              WHEN 11 THEN N'Tháng Mười Một'
              WHEN 12 THEN N'Tháng Mười Hai'
          END AS month_name
      FROM DateCTE
      OPTION (MAXRECURSION 0);
    `);
    console.log("Seeding DIM_DATES completed!");
  }

  await pool.close();
  process.exit(0);
}

main().catch(err => {
  console.error("Loi:", err);
  process.exit(1);
});
