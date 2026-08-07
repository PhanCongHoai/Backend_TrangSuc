require('dotenv').config({ path: 'c:/Users/ASUS/Documents/Demo/Web_TrangSuc1/Web_TrangSuc/backend/.env' });
const { poolPromise, sql } = require('../config/db.js');

const migrate = async () => {
  try {
    const pool = await poolPromise;
    console.log("Checking and creating product_details table...");
    
    await pool.request().query(`
      IF OBJECT_ID('dbo.product_details', 'U') IS NULL
      BEGIN
          CREATE TABLE [dbo].[product_details] (
              [id] INT IDENTITY(1,1) PRIMARY KEY,
              [product_id] INT NOT NULL UNIQUE,
              [main_material] NVARCHAR(100) NULL,
              [material_purity] VARCHAR(50) NULL,
              [primary_color] NVARCHAR(50) NULL,
              [main_gemstone] NVARCHAR(100) NULL,
              [gemstone_size] VARCHAR(50) NULL,
              [gemstone_shape] NVARCHAR(50) NULL,
              [side_gemstone] NVARCHAR(150) NULL,
              [gender] NVARCHAR(30) NULL,
              [collection] NVARCHAR(150) NULL,
              [origin] NVARCHAR(100) NULL,
              [warranty_months] INT NULL DEFAULT 12,
              [created_at] DATETIME DEFAULT GETDATE(),
              [updated_at] DATETIME DEFAULT GETDATE(),
              CONSTRAINT FK_product_details_products FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
          );

          -- Seed attributes for existing products
          INSERT INTO dbo.product_details (product_id, main_material, material_purity, primary_color, main_gemstone, gemstone_size, gemstone_shape, side_gemstone, gender, collection, origin, warranty_months)
          SELECT id, 
                 CASE WHEN material_type = 'gold' THEN N'Vàng'
                      WHEN material_type = 'silver' THEN N'Bạc'
                      ELSE N'Vàng trắng' END,
                 CASE WHEN material_type = 'gold' THEN '18K (75%)'
                      WHEN material_type = 'silver' THEN '92.5%'
                      ELSE '14K' END,
                 CASE WHEN material_type = 'gold' THEN N'Vàng vàng'
                      ELSE N'Vàng trắng' END,
                 N'Kim cương', '4.5 mm', N'Tròn', N'Đá CZ tấm', N'Nữ', N'Wedding Collection', N'Việt Nam', 12
          FROM dbo.products;

          PRINT 'Table product_details created and seeded successfully.'
      END
      ELSE
      BEGIN
          PRINT 'Table product_details already exists.'
      END
    `);
    console.log("Migration finished.");
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    process.exit(0);
  }
};

migrate();
