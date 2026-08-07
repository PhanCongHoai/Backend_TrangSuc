require('dotenv').config({ path: 'c:/Users/ASUS/Documents/Demo/Web_TrangSuc1/Web_TrangSuc/backend/.env' });
const { poolPromise } = require('../src/config/db.js');

const run = async () => {
  try {
    const pool = await poolPromise;
    console.log("Truncating and re-seeding product_details with proper matched data...");
    await pool.request().query(`
      TRUNCATE TABLE dbo.product_details;

      INSERT INTO dbo.product_details (
        product_id, main_material, material_purity, primary_color,
        main_gemstone, gemstone_size, gemstone_shape, side_gemstone,
        gender, collection, origin, warranty_months
      )
      SELECT 
        p.id,
        -- Chất liệu chính
        CASE 
          WHEN p.material_type LIKE N'%Bạch kim%' THEN N'Bạch kim'
          WHEN p.material_type LIKE N'%Bạc%' OR p.material_type LIKE N'%SILVER%' THEN N'Bạc'
          WHEN p.material_type LIKE N'%Vàng trắng%' OR p.material_type LIKE N'%WHITE_GOLD%' THEN N'Vàng trắng'
          WHEN p.material_type LIKE N'%Vàng%' OR p.material_type LIKE N'%GOLD%' THEN N'Vàng'
          ELSE N'Vàng 18K'
        END AS main_material,
        
        -- Độ tinh khiết
        CASE 
          WHEN p.material_type LIKE N'%18K%' OR p.material_type LIKE N'%GOLD_18K%' THEN '18K (75%)'
          WHEN p.material_type LIKE N'%24K%' OR p.material_type LIKE N'%GOLD_24K%' THEN '24K (99.9%)'
          WHEN p.material_type LIKE N'%10K%' OR p.material_type LIKE N'%GOLD_10K%' THEN '10K (41.7%)'
          WHEN p.material_type LIKE N'%Bạch kim%' THEN 'Pt950 (95%)'
          WHEN p.material_type LIKE N'%925%' THEN '92.5%'
          ELSE '75%'
        END AS material_purity,
        
        -- Màu sắc chủ đạo
        CASE 
          WHEN p.material_type LIKE N'%Vàng trắng%' OR p.material_type LIKE N'%WHITE_GOLD%' 
               OR p.material_type LIKE N'%Bạc%' OR p.material_type LIKE N'%SILVER%'
               OR p.material_type LIKE N'%Bạch kim%' THEN N'Trắng'
          ELSE N'Vàng vàng'
        END AS primary_color,
        
        -- Đá chính
        CASE 
          WHEN c.name LIKE N'%Nhẫn cưới%' THEN N'Kim cương tự nhiên'
          WHEN c.name LIKE N'%Nhẫn%' THEN N'Kim cương'
          WHEN c.name LIKE N'%Dây chuyền%' OR c.name LIKE N'%Vòng cổ%' THEN N'Kim cương Thượng hải'
          ELSE N'Đá CZ cao cấp'
        END AS main_gemstone,
        
        -- Kích thước đá chính
        CASE 
          WHEN c.name LIKE N'%Nhẫn cưới%' THEN '3.5 mm'
          WHEN c.name LIKE N'%Nhẫn%' THEN '4.0 mm'
          WHEN c.name LIKE N'%Dây chuyền%' OR c.name LIKE N'%Vòng cổ%' THEN '4.5 mm'
          ELSE '2.5 mm'
        END AS gemstone_size,
        
        -- Kiểu cắt đá chính
        N'Tròn' AS gemstone_shape,
        
        -- Đá phụ
        CASE 
          WHEN c.name LIKE N'%Nhẫn cưới%' THEN N'Kim cương tấm'
          ELSE N'Đá CZ tấm'
        END AS side_gemstone,
        
        -- Giới tính
        CASE 
          WHEN c.name LIKE N'%nam%' THEN N'Nam'
          WHEN c.name LIKE N'%nữ%' OR c.name LIKE N'%Nữ%' THEN N'Nữ'
          WHEN c.name LIKE N'%cưới%' THEN N'Cặp đôi'
          ELSE N'Unisex'
        END AS gender,
        
        -- Bộ sưu tập
        CASE 
          WHEN c.name LIKE N'%cưới%' THEN N'Wedding Collection'
          ELSE N'Eternal Love'
        END AS collection,
        
        N'Việt Nam' AS origin,
        12 AS warranty_months
      FROM dbo.products p
      LEFT JOIN dbo.product_categories c ON c.id = p.category_id;
    `);
    console.log("Re-seeding finished successfully.");
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
};

run();
