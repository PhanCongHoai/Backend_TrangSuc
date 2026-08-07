const sql = require("mssql");
const { poolPromise } = require("../config/db");

// Cấu hình Database Kho dữ liệu (JewelryStoreDWH)
const baseDwhConfig = {
  server: String(process.env.DB_SERVER || "localhost").trim(),
  port: parseInt(process.env.DB_PORT) || 1433,
  database: "JewelryStoreDWH",
  options: {
    encrypt: false,
    trustServerCertificate: true,
    useUTC: false,
  },
  pool: {
    max: 5,
    min: 0,
    idleTimeoutMillis: 30000,
  },
};

const dwhLegacyConfig = {
  ...baseDwhConfig,
  user: String(process.env.DB_USER || "").trim(),
  password: String(process.env.DB_PASSWORD || "").trim(),
};

const dwhExplicitConfig = {
  ...baseDwhConfig,
  authentication: {
    type: "default",
    options: {
      userName: String(process.env.DB_USER || "").trim(),
      password: String(process.env.DB_PASSWORD || "").trim(),
    },
  },
};

const dbAuthMode = process.env.DB_AUTH_MODE || "legacy";
const dwhConnectionStrategies =
  dbAuthMode === "explicit"
    ? [
        [dwhExplicitConfig, "explicit authentication"],
        [dwhLegacyConfig, "legacy authentication"],
      ]
    : [
        [dwhLegacyConfig, "legacy authentication"],
        [dwhExplicitConfig, "explicit authentication"],
      ];

let dwhPoolPromise = null;

// Lấy connection pool cho DWH (với cơ chế Fallback tương tự db.js)
async function getDwhPool() {
  if (dwhPoolPromise) return dwhPoolPromise;

  let lastError;
  for (let index = 0; index < dwhConnectionStrategies.length; index += 1) {
    const [connectionConfig, label] = dwhConnectionStrategies[index];
    try {
      const pool = new sql.ConnectionPool(connectionConfig);
      await pool.connect();
      console.log(`[DWH] Đã kết nối thành công tới Database JewelryStoreDWH bằng ${label}.`);
      dwhPoolPromise = pool;
      return pool;
    } catch (connectionError) {
      lastError = connectionError;
      if (index < dwhConnectionStrategies.length - 1) {
        const [, fallbackLabel] = dwhConnectionStrategies[index + 1];
        console.warn(
          `[DWH] Kết nối bằng ${label} thất bại, thử lại bằng ${fallbackLabel}:`,
          connectionError.message
        );
      }
    }
  }

  console.error("[DWH] Lỗi kết nối CSDL phân tích:", lastError.message);
  throw lastError;
}

class EtlService {
  // 1. Đảm bảo Database JewelryStoreDWH và các bảng Star Schema được thiết lập đầy đủ
  async ensureSchema() {
    try {
      console.log("[ETL] Đang kiểm tra và khởi tạo Database/Bảng phân tích...");
      
      // 1. Kết nối Database chính, tạo Database JewelryStoreDWH nếu chưa có
      const mainPool = await poolPromise;
      await mainPool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'JewelryStoreDWH')
        BEGIN
            CREATE DATABASE JewelryStoreDWH;
        END
      `);

      // 2. Kết nối tới DWH Pool
      const dwhPool = await getDwhPool();

      // 3. Tạo bảng DIM_PRODUCTS
      await dwhPool.request().query(`
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

      // 4. Tạo bảng DIM_DATES
      await dwhPool.request().query(`
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

      // 5. Tạo bảng FACT_PRODUCT_SALES
      await dwhPool.request().query(`
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

      // 6. Điền dữ liệu cho DIM_DATES nếu rỗng (từ 2024 đến 2028)
      const dateCheck = await dwhPool.request().query("SELECT COUNT(*) AS count FROM dbo.DIM_DATES");
      if (dateCheck.recordset[0].count === 0) {
        console.log("[ETL] Đang sinh dữ liệu ngày tháng cho DIM_DATES (2024-2028)...");
        await dwhPool.request().query(`
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
        console.log("[ETL] Đã khởi tạo bảng DIM_DATES.");
      }
      
      console.log("[ETL] Kiểm tra cấu trúc CSDL DWH thành công.");
      return true;
    } catch (error) {
      console.error("[ETL] Lỗi kiểm tra cấu trúc CSDL DWH:", error.message);
      throw error;
    }
  }

  // 2. Tiến hành chạy toàn bộ quy trình ETL để đồng bộ dữ liệu
  async run() {
    try {
      // Đảm bảo schema tồn tại
      await this.ensureSchema();

      const mainPool = await poolPromise;
      const dwhPool = await getDwhPool();

      console.log("[ETL] Bắt đầu chạy tiến trình ETL đồng bộ sang JewelryStoreDWH...");

      // ---------- STEP 1: ĐỒNG BỘ DIM_PRODUCTS ----------
      console.log("[ETL - Extract] Đang lấy dữ liệu Sản phẩm từ JewelryStoreDB...");
      const productsResult = await mainPool.request().query(`
        SELECT 
          p.id, 
          p.name, 
          c.name AS category_name, 
          p.material_type, 
          p.base_weight,
          p.status,
          COALESCE(cfg.current_sale_price_cache, 0) AS current_price,
          (COALESCE(cfg.labor_cost, 0) + COALESCE(cfg.stone_cost, 0)) AS capital_cost,
          COALESCE((SELECT SUM(stock.quantity) FROM inventory_stocks stock INNER JOIN product_variants pv ON pv.id = stock.variant_id WHERE pv.product_id = p.id), 0) AS stock_quantity
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN product_pricing_configs cfg ON cfg.product_id = p.id
      `);

      console.log(`[ETL - Transform & Load] Đang đồng bộ ${productsResult.recordset.length} sản phẩm sang DIM_PRODUCTS...`);
      const transaction = new sql.Transaction(dwhPool);
      await transaction.begin();
      try {
        for (const row of productsResult.recordset) {
          await new sql.Request(transaction)
            .input("id", sql.Int, row.id)
            .input("name", sql.NVarChar(400), row.name)
            .input("category", sql.NVarChar(300), row.category_name || "N/A")
            .input("material", sql.NVarChar(100), row.material_type || "N/A")
            .input("weight", sql.Float, row.base_weight || 0)
            .input("price", sql.Decimal(18, 2), row.current_price)
            .input("cost", sql.Decimal(18, 2), row.capital_cost)
            .input("stock", sql.Int, row.stock_quantity)
            .input("status", sql.VarChar(50), row.status || "ACTIVE")
            .query(`
              MERGE dbo.DIM_PRODUCTS AS target
              USING (SELECT @id AS original_product_id) AS source
              ON (target.original_product_id = source.original_product_id)
              WHEN MATCHED THEN
                  UPDATE SET 
                      product_name = @name,
                      category_name = @category,
                      material_type = @material,
                      base_weight = @weight,
                      current_price = @price,
                      capital_cost = @cost,
                      stock_quantity = @stock,
                      status = @status,
                      last_sync_at = GETDATE()
              WHEN NOT MATCHED THEN
                  INSERT (original_product_id, product_name, category_name, material_type, base_weight, current_price, capital_cost, stock_quantity, status)
                  VALUES (source.original_product_id, @name, @category, @material, @weight, @price, @cost, @stock, @status);
            `);
        }
        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }

      // Lấy bản đồ sản phẩm để chuyển đổi ID gốc -> DWH Product Key nhanh
      const productMap = {};
      const dwhProducts = await dwhPool.request().query("SELECT product_key, original_product_id, capital_cost FROM dbo.DIM_PRODUCTS");
      for (const p of dwhProducts.recordset) {
        productMap[p.original_product_id] = {
          product_key: p.product_key,
          capital_cost: Number(p.capital_cost || 0)
        };
      }

      // ---------- STEP 2: ĐỒNG BỘ FACT_PRODUCT_SALES ----------
      console.log("[ETL - Extract] Đang trích xuất đơn hàng thành công (COMPLETED) từ JewelryStoreDB...");
      const salesResult = await mainPool.request().query(`
        SELECT 
            o.id AS original_order_id,
            o.created_at AS order_date,
            pv.product_id AS original_product_id,
            oi.quantity,
            oi.total_price AS revenue
        FROM orders o
        JOIN order_items oi ON oi.order_id = o.id
        JOIN product_variants pv ON pv.id = oi.variant_id
        WHERE UPPER(ISNULL(o.status, '')) = 'COMPLETED'
      `);

      console.log("[ETL - Transform] Chuyển đổi dữ liệu và làm sạch...");
      const factRows = [];
      for (const row of salesResult.recordset) {
        const prodData = productMap[row.original_product_id];
        if (!prodData) {
          // Bỏ qua nếu không tìm thấy sản phẩm trong DIM (tránh lỗi khóa ngoại)
          continue;
        }

        const orderDate = new Date(row.order_date);
        const dateKey = orderDate.getFullYear() * 10000 + (orderDate.getMonth() + 1) * 100 + orderDate.getDate();
        
        const quantity = row.quantity;
        const revenue = Number(row.revenue);
        const cost = prodData.capital_cost * quantity;
        const profit = revenue - cost;

        factRows.push({
          date_key: dateKey,
          product_key: prodData.product_key,
          original_order_id: row.original_order_id,
          quantity_sold: quantity,
          revenue: revenue,
          cost: cost,
          profit: profit
        });
      }

      console.log("[ETL - Load] Nạp dữ liệu vào bảng FACT_PRODUCT_SALES...");
      // Thực hiện Full Refresh cho bảng FACT nhằm đảm bảo tính nhất quán đơn giản
      await dwhPool.request().query("TRUNCATE TABLE dbo.FACT_PRODUCT_SALES");

      // Chèn dữ liệu theo khối (Batch Insert)
      const chunkSize = 100;
      for (let i = 0; i < factRows.length; i += chunkSize) {
        const chunk = factRows.slice(i, i + chunkSize);
        
        let insertQuery = "INSERT INTO dbo.FACT_PRODUCT_SALES (date_key, product_key, original_order_id, quantity_sold, revenue, cost, profit) VALUES ";
        const request = dwhPool.request();

        const valueStrings = chunk.map((row, idx) => {
          request.input(`dk_${idx}`, sql.Int, row.date_key);
          request.input(`pk_${idx}`, sql.Int, row.product_key);
          request.input(`oid_${idx}`, sql.Int, row.original_order_id);
          request.input(`qs_${idx}`, sql.Int, row.quantity_sold);
          request.input(`rev_${idx}`, sql.Decimal(18, 2), row.revenue);
          request.input(`cost_${idx}`, sql.Decimal(18, 2), row.cost);
          request.input(`prof_${idx}`, sql.Decimal(18, 2), row.profit);

          return `(@dk_${idx}, @pk_${idx}, @oid_${idx}, @qs_${idx}, @rev_${idx}, @cost_${idx}, @prof_${idx})`;
        });

        insertQuery += valueStrings.join(", ");
        await request.query(insertQuery);
      }

      console.log(`[ETL] Đồng bộ thành công! Đã chèn ${factRows.length} dòng doanh số bán hàng vào DWH.`);
      return {
        success: true,
        productsSynced: productsResult.recordset.length,
        salesSynced: factRows.length
      };

    } catch (error) {
      console.error("[ETL] Tiến trình ETL thất bại. Lỗi:", error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

module.exports = new EtlService();
module.exports.getDwhPool = getDwhPool;
