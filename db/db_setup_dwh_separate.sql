-- SQL Script: Kho dữ liệu độc lập và tạo bảng Star Schema (DWH)
-- Cơ sở dữ liệu: JewelryStoreDWH

-- 1. Tạo Database mới nếu chưa tồn tại
IF NOT EXISTS (SELECT * FROM sys.databases WHERE name = 'JewelryStoreDWH')
BEGIN
    CREATE DATABASE JewelryStoreDWH;
    PRINT 'Da tao Database JewelryStoreDWH thanh cong.';
END
ELSE
BEGIN
    PRINT 'Database JewelryStoreDWH da ton tai.';
END
GO

USE JewelryStoreDWH;
GO

-- 2. Tạo bảng Chiều Sản Phẩm: DIM_PRODUCTS
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
        capital_cost DECIMAL(18,2) NULL, -- Giá vốn ước lượng = tiền công + tiền đá
        stock_quantity INT DEFAULT 0,
        status VARCHAR(50) NULL,
        last_sync_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT UC_DIM_PRODUCTS_original UNIQUE(original_product_id)
    );
    PRINT 'Da tao bang DIM_PRODUCTS.';
END

-- 3. Tạo bảng Chiều Thời Gian: DIM_DATES
IF OBJECT_ID('dbo.DIM_DATES', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.DIM_DATES (
        date_key INT PRIMARY KEY, -- Định dạng YYYYMMDD
        full_date DATE NOT NULL,
        day_of_month INT NOT NULL,
        month INT NOT NULL,
        quarter INT NOT NULL,
        year INT NOT NULL,
        day_name NVARCHAR(50) NOT NULL,
        month_name NVARCHAR(50) NOT NULL
    );
    PRINT 'Da tao bang DIM_DATES.';
END

-- 4. Tạo bảng Sự Kiện Bán Hàng Sản Phẩm: FACT_PRODUCT_SALES
IF OBJECT_ID('dbo.FACT_PRODUCT_SALES', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.FACT_PRODUCT_SALES (
        sale_id INT IDENTITY(1,1) PRIMARY KEY,
        date_key INT NOT NULL,
        product_key INT NOT NULL,
        original_order_id INT NOT NULL,
        quantity_sold INT NOT NULL,
        revenue DECIMAL(18,2) NOT NULL, -- Giá bán thực tế * Số lượng
        cost DECIMAL(18,2) NOT NULL,    -- Giá vốn * Số lượng
        profit DECIMAL(18,2) NOT NULL,  -- Lợi nhuận = Doanh thu - Giá vốn
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_FACT_SALES_DATES FOREIGN KEY (date_key) REFERENCES dbo.DIM_DATES(date_key),
        CONSTRAINT FK_FACT_SALES_PRODUCTS FOREIGN KEY (product_key) REFERENCES dbo.DIM_PRODUCTS(product_key)
    );
    PRINT 'Da tao bang FACT_PRODUCT_SALES.';
END
GO

-- 5. Tự động điền dữ liệu cho chiều DIM_DATES nếu bảng rỗng (Thời gian từ 2024 đến 2028)
IF (SELECT COUNT(*) FROM dbo.DIM_DATES) = 0
BEGIN
    PRINT 'Bat dau sinh du lieu tu dong cho bang DIM_DATES...';
    
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

    PRINT 'Da dien xong du lieu chieu DIM_DATES.';
END
ELSE
BEGIN
    PRINT 'DIM_DATES da co du lieu, khong can khoi tao lai.';
END
GO
