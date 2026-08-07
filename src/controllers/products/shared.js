const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sql } = require("../../config/db");

const DEFAULT_COMPARE_MAX_ITEMS = 2;

// Định dạng tiền tệ VND cho các màn hình sản phẩm và quản trị.
const formatCurrency = (value) => {
  const amount = Number(value || 0);

  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
};

// Chuẩn hóa nhãn vật liệu hoặc trạng thái thành chuỗi dễ đọc.
const normalizeLabel = (value) => {
  if (!value) {
    return "Trang suc";
  }

  return String(value).replaceAll("_", " ").trim();
};

// Sinh badge hiển thị cho sản phẩm dựa trên trạng thái hiện tại.
const buildBadge = (status) => {
  if (!status) {
    return "Noi bat";
  }

  const normalizedStatus = String(status).trim().toUpperCase();

  if (normalizedStatus === "ACTIVE") {
    return "San pham moi";
  }

  return normalizeLabel(status);
};

// Định dạng ngày về chuỗi gọn dùng trong response sản phẩm.
const formatDateTime = (value) => {
  if (!value) {
    return null;
  }

  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
};

// Tính giá bán cuối cùng từ giá vàng, trọng lượng và các chi phí cấu thành.
const computeSalePrice = ({
  baseSellPrice,
  baseWeight,
  laborCost,
  stoneCost,
  markupRate,
}) => {
  const materialCost = Number(baseSellPrice || 0) * Number(baseWeight || 0);
  const subtotal =
    materialCost + Number(laborCost || 0) + Number(stoneCost || 0);
  const total = subtotal * (1 + Number(markupRate || 0));

  return Math.round(total);
};

// Ánh xạ một bản ghi bảng giá số lượng sang object frontend đang dùng.
const mapPriceTier = (item, pricingContext = null) => {
  const markupRate = Number(item.markup_rate ?? item.markupRate ?? 0);
  const computedPrice = pricingContext
    ? computeSalePrice({
        ...pricingContext,
        markupRate,
      })
    : Number(item.tier_price || 0);

  return {
    id: item.id ? Number(item.id) : null,
    minQuantity: Number(item.min_quantity || 1),
    maxQuantity:
      item.max_quantity === null || item.max_quantity === undefined
        ? null
        : Number(item.max_quantity),
    markupRate,
    price: computedPrice,
  };
};

// Chuẩn hóa danh sách price tier nhận từ request trước khi lưu xuống DB.
const normalizePriceTierInputs = (priceTiers = []) => {
  if (!Array.isArray(priceTiers)) {
    return [];
  }

  return priceTiers
    .map((tier) => {
      const minQuantity = Math.max(
        1,
        Math.floor(Number(tier?.min_quantity ?? tier?.minQuantity ?? 0))
      );
      const rawMaxQuantity = tier?.max_quantity ?? tier?.maxQuantity;
      const maxQuantity =
        rawMaxQuantity === "" || rawMaxQuantity === null || rawMaxQuantity === undefined
          ? null
          : Math.max(1, Math.floor(Number(rawMaxQuantity)));
      const markupRate = Math.max(
        0,
        Number(tier?.markup_rate ?? tier?.markupRate ?? tier?.tier_price ?? tier?.price ?? 0)
      );

      return {
        minQuantity,
        maxQuantity,
        markupRate,
      };
    })
    .filter(
      (tier) =>
        tier.minQuantity > 0 &&
        tier.markupRate >= 0 &&
        (tier.maxQuantity === null || tier.maxQuantity >= tier.minQuantity)
    )
    .sort((left, right) => left.minQuantity - right.minQuantity);
};

// Kiểm tra tính hợp lệ và chồng chéo của các bậc số lượng.
// Trả về chuỗi thông báo lỗi nếu có lỗi, ngược lại trả về null (hợp lệ).
const validatePriceTiers = (priceTiers = []) => {
  if (!Array.isArray(priceTiers) || priceTiers.length === 0) {
    return null;
  }

  const normalized = [];

  for (let i = 0; i < priceTiers.length; i++) {
    const tier = priceTiers[i];

    const rawMin = tier?.min_quantity ?? tier?.minQuantity;
    const rawMax = tier?.max_quantity ?? tier?.maxQuantity;
    const rawRate = tier?.markup_rate ?? tier?.markupRate;

    const minQty = rawMin === "" || rawMin === null || rawMin === undefined ? NaN : Number(rawMin);
    const maxQty = rawMax === "" || rawMax === null || rawMax === undefined ? null : Number(rawMax);
    const markupRate = rawRate === "" || rawRate === null || rawRate === undefined ? NaN : Number(rawRate);

    if (Number.isNaN(minQty) || minQty < 1 || !Number.isInteger(minQty)) {
      return `Bậc số lượng thứ ${i + 1}: Số lượng bắt đầu ("Từ SL") phải là số nguyên lớn hơn hoặc bằng 1.`;
    }
    if (Number.isNaN(markupRate) || markupRate < 0) {
      return `Bậc số lượng thứ ${i + 1}: Tỷ lệ markup phải là số lớn hơn hoặc bằng 0.`;
    }
    if (maxQty !== null) {
      if (Number.isNaN(maxQty) || maxQty < 1 || !Number.isInteger(maxQty)) {
        return `Bậc số lượng thứ ${i + 1}: Số lượng kết thúc ("Đến SL") phải là số nguyên lớn hơn hoặc bằng 1.`;
      }
      if (maxQty < minQty) {
        return `Bậc số lượng thứ ${i + 1}: Số lượng kết thúc ("Đến SL": ${maxQty}) không được nhỏ hơn số lượng bắt đầu ("Từ SL": ${minQty}).`;
      }
    }

    normalized.push({
      min: minQty,
      max: maxQty,
      originalIndex: i
    });
  }

  // Sắp xếp các bậc theo số lượng bắt đầu (min)
  normalized.sort((a, b) => a.min - b.min);

  for (let i = 0; i < normalized.length - 1; i++) {
    const current = normalized[i];
    const next = normalized[i + 1];

    if (current.max === null) {
      return `Bậc số lượng từ ${current.min} đến vô cùng phải là bậc cuối cùng. Không thể có thêm bậc khác sau nó.`;
    }
    if (next.min <= current.max) {
      return `Các bậc số lượng bị chồng chéo nhau: Bậc từ ${current.min} đến ${current.max} chồng chéo với bậc từ ${next.min} đến ${next.max !== null ? next.max : "vô cùng"}.`;
    }
  }

  return null;
};

// Parse đầu vào số không âm và trả kèm trạng thái hợp lệ để validate.
const parseNonNegativeNumberInput = (value, fallbackValue = 0) => {
  if (value === null || value === undefined || value === "") {
    return {
      valid: true,
      value: fallbackValue,
    };
  }

  const normalizedValue =
    typeof value === "string" ? value.trim() : value;

  if (normalizedValue === "") {
    return {
      valid: true,
      value: fallbackValue,
    };
  }

  const parsedValue = Number(normalizedValue);

  return {
    valid: Number.isFinite(parsedValue) && parsedValue >= 0,
    value:
      Number.isFinite(parsedValue) && parsedValue >= 0
        ? parsedValue
        : fallbackValue,
  };
};

// Chọn nguồn biến thể từ mảng variants hoặc fallback từ form đơn giản cũ.
const getVariantInputSource = (variantItems, fallback = {}) =>
  Array.isArray(variantItems) && variantItems.length
    ? variantItems
    : [
        {
          id: fallback.id,
          sku: fallback.sku,
          size: fallback.size,
          weight_modifier: fallback.weight_modifier,
          stock_quantity: fallback.stock_quantity,
          warehouse_location: fallback.warehouse_location,
        },
      ];

// Tìm các trường số không hợp lệ trong payload sản phẩm và biến thể.
const findInvalidNumericProductFields = ({
  base_weight,
  weight_modifier,
  labor_cost,
  stone_cost,
  markup_rate,
  variants,
  fallbackVariant = {},
}) => {
  const invalidFields = [];
  const topLevelFields = [
    ["base_weight", base_weight],
    ["weight_modifier", weight_modifier],
    ["labor_cost", labor_cost],
    ["stone_cost", stone_cost],
    ["markup_rate", markup_rate],
  ];

  topLevelFields.forEach(([fieldName, fieldValue]) => {
    if (!parseNonNegativeNumberInput(fieldValue).valid) {
      invalidFields.push(fieldName);
    }
  });

  getVariantInputSource(variants, fallbackVariant).forEach((variant, index) => {
    if (!parseNonNegativeNumberInput(variant?.weight_modifier ?? variant?.weightModifier).valid) {
      invalidFields.push(`variants[${index}].weight_modifier`);
    }

    if (!parseNonNegativeNumberInput(variant?.stock_quantity ?? variant?.stockQuantity).valid) {
      invalidFields.push(`variants[${index}].stock_quantity`);
    }
  });

  return invalidFields;
};

// Bảo đảm bảng product_price_tiers và các cột liên quan đã tồn tại.
const ensureProductPriceTiersSchema = async (pool) => {
  await pool.request().query(`
    IF OBJECT_ID('dbo.product_price_tiers', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.product_price_tiers (
        id INT IDENTITY(1,1) PRIMARY KEY,
        product_id INT NOT NULL,
        min_quantity INT NOT NULL,
        max_quantity INT NULL,
        tier_price DECIMAL(15,2) NOT NULL,
        markup_rate FLOAT NOT NULL CONSTRAINT DF_product_price_tiers_markup_rate DEFAULT 0,
        created_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_product_price_tiers_products
          FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE CASCADE
      );
    END;

    IF COL_LENGTH('dbo.product_price_tiers', 'markup_rate') IS NULL
    BEGIN
      ALTER TABLE dbo.product_price_tiers
      ADD markup_rate FLOAT NOT NULL CONSTRAINT DF_product_price_tiers_markup_rate DEFAULT 0;
    END;
  `);
};

// Bảo đảm bảng product_details đã tồn tại và seed dữ liệu mẫu
const ensureProductDetailsSchema = async (pool) => {
  await pool.request().query(`
    IF OBJECT_ID('dbo.product_details', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.product_details (
        id INT IDENTITY(1,1) PRIMARY KEY,
        product_id INT NOT NULL UNIQUE,
        main_material NVARCHAR(100) NULL,
        material_purity VARCHAR(50) NULL,
        primary_color NVARCHAR(50) NULL,
        main_gemstone NVARCHAR(100) NULL,
        gemstone_size VARCHAR(50) NULL,
        gemstone_shape NVARCHAR(50) NULL,
        side_gemstone NVARCHAR(150) NULL,
        gender NVARCHAR(30) NULL,
        collection NVARCHAR(150) NULL,
        origin NVARCHAR(100) NULL,
        warranty_months INT NULL DEFAULT 12,
        created_at DATETIME DEFAULT GETDATE(),
        updated_at DATETIME DEFAULT GETDATE(),
        CONSTRAINT FK_product_details_products
          FOREIGN KEY (product_id) REFERENCES dbo.products(id) ON DELETE CASCADE
      );

      -- Seed attributes for existing products
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
    END;
  `);
};

// Thay thế toàn bộ bảng giá số lượng của một sản phẩm trong cùng transaction.
const replaceProductPriceTiers = async (
  transaction,
  productId,
  priceTiers = [],
  pricingContext = {}
) => {
  await new sql.Request(transaction)
    .input("ProductId", sql.Int, productId)
    .query(`
      DELETE FROM product_price_tiers
      WHERE product_id = @ProductId
    `);

  for (const tier of priceTiers) {
    const tierPrice = computeSalePrice({
      ...pricingContext,
      markupRate: tier.markupRate,
    });

    await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .input("MinQuantity", sql.Int, tier.minQuantity)
      .input("MaxQuantity", sql.Int, tier.maxQuantity)
      .input("TierPrice", sql.Decimal(15, 2), tierPrice)
      .input("MarkupRate", sql.Float, tier.markupRate)
      .query(`
        INSERT INTO product_price_tiers (product_id, min_quantity, max_quantity, tier_price, markup_rate)
        VALUES (@ProductId, @MinQuantity, @MaxQuantity, @TierPrice, @MarkupRate)
      `);
  }
};

// Chuẩn hóa danh sách biến thể sản phẩm từ request về cấu trúc nội bộ.
const normalizeVariantInputs = (variantItems, fallback = {}) => {
  const sourceItems = getVariantInputSource(variantItems, fallback);

  return sourceItems
    .map((variant) => ({
      id: variant?.id ? Number(variant.id) : null,
      sku: String(variant?.sku || "").trim(),
      size: String(variant?.size || "").trim() || null,
      weightModifier: parseNonNegativeNumberInput(
        variant?.weight_modifier ?? variant?.weightModifier,
      ).value,
      stockQuantity: parseNonNegativeNumberInput(
        variant?.stock_quantity ?? variant?.stockQuantity,
      ).value,
      warehouseLocation: String(
        variant?.warehouse_location ?? variant?.warehouseLocation ?? ""
      ).trim() || null,
    }))
    .filter(
      (variant) =>
        variant.sku ||
        variant.size ||
        variant.weightModifier > 0 ||
        variant.stockQuantity > 0 ||
        variant.warehouseLocation
    );
};

// Tìm SKU bị trùng ngay trong payload biến thể người dùng gửi lên.
const findDuplicateVariantSku = (variants = []) => {
  const seenSkus = new Set();

  for (const variant of variants) {
    const normalizedSku = String(variant.sku || "").trim().toLowerCase();

    if (!normalizedSku) {
      continue;
    }

    if (seenSkus.has(normalizedSku)) {
      return variant.sku;
    }

    seenSkus.add(normalizedSku);
  }

  return null;
};

// Kiểm tra các SKU biến thể có đang bị trùng với dữ liệu hiện có trong DB hay không.
const validateVariantSkusAvailable = async (pool, variants = []) => {
  for (const variant of variants) {
    const result = await pool
      .request()
      .input("Sku", sql.VarChar(100), variant.sku)
      .input("VariantId", sql.Int, variant.id || null)
      .query(`
        SELECT TOP 1 id
        FROM product_variants
        WHERE sku = @Sku
          AND (@VariantId IS NULL OR id <> @VariantId)
      `);

    if (result.recordset.length) {
      return variant.sku;
    }
  }

  return null;
};

// Thêm mới hoặc cập nhật danh sách biến thể và tồn kho của một sản phẩm.
const upsertProductVariants = async (transaction, productId, variants = []) => {
  const retainedVariantIds = [];

  for (const variant of variants) {
    if (variant.id) {
      const updateResult = await new sql.Request(transaction)
        .input("VariantId", sql.Int, variant.id)
        .input("ProductId", sql.Int, productId)
        .input("Sku", sql.VarChar(100), variant.sku)
        .input("Size", sql.NVarChar(50), variant.size)
        .input("WeightModifier", sql.Float, variant.weightModifier)
        .query(`
          UPDATE product_variants
          SET
            sku = @Sku,
            size = @Size,
            weight_modifier = @WeightModifier
          OUTPUT INSERTED.id
          WHERE id = @VariantId
            AND product_id = @ProductId
        `);

      const updatedVariantId = Number(updateResult.recordset[0]?.id || 0);

      if (updatedVariantId) {
        retainedVariantIds.push(updatedVariantId);
        await new sql.Request(transaction)
          .input("VariantId", sql.Int, updatedVariantId)
          .input("Quantity", sql.Int, variant.stockQuantity)
          .input("WarehouseLocation", sql.NVarChar(100), variant.warehouseLocation)
          .query(`
            MERGE inventory_stocks AS target
            USING (SELECT @VariantId AS variant_id) AS source
            ON target.variant_id = source.variant_id
            WHEN MATCHED THEN
              UPDATE SET
                quantity = @Quantity,
                warehouse_location = @WarehouseLocation
            WHEN NOT MATCHED THEN
              INSERT (variant_id, quantity, warehouse_location)
              VALUES (@VariantId, @Quantity, @WarehouseLocation);
          `);
        continue;
      }
    }

    const insertResult = await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .input("Sku", sql.VarChar(100), variant.sku)
      .input("Size", sql.NVarChar(50), variant.size)
      .input("WeightModifier", sql.Float, variant.weightModifier)
      .query(`
        INSERT INTO product_variants (product_id, sku, size, weight_modifier)
        OUTPUT INSERTED.id
        VALUES (@ProductId, @Sku, @Size, @WeightModifier)
      `);

    const insertedVariantId = Number(insertResult.recordset[0]?.id || 0);
    retainedVariantIds.push(insertedVariantId);

    await new sql.Request(transaction)
      .input("VariantId", sql.Int, insertedVariantId)
      .input("Quantity", sql.Int, variant.stockQuantity)
      .input("WarehouseLocation", sql.NVarChar(100), variant.warehouseLocation)
      .query(`
        INSERT INTO inventory_stocks (variant_id, quantity, warehouse_location)
        VALUES (@VariantId, @Quantity, @WarehouseLocation)
      `);
  }

  return retainedVariantIds.filter(Boolean);
};

// Cho nghỉ các biến thể không còn xuất hiện trong payload cập nhật mà vẫn an toàn dữ liệu.
const retireMissingProductVariants = async (transaction, productId, retainedVariantIds = []) => {
  const request = new sql.Request(transaction).input("ProductId", sql.Int, productId);
  const placeholders = retainedVariantIds.map((variantId, index) => {
    const name = `RetainedVariantId${index}`;
    request.input(name, sql.Int, variantId);
    return `@${name}`;
  });
  const retainedCondition = placeholders.length
    ? `AND id NOT IN (${placeholders.join(", ")})`
    : "";

  await request.query(`
    UPDATE inventory_stocks
    SET quantity = 0
    WHERE variant_id IN (
      SELECT id
      FROM product_variants
      WHERE product_id = @ProductId
      ${retainedCondition}
    );
  `);

  const deleteRequest = new sql.Request(transaction).input("ProductId", sql.Int, productId);
  const deletePlaceholders = retainedVariantIds.map((variantId, index) => {
    const name = `RetainedVariantId${index}`;
    deleteRequest.input(name, sql.Int, variantId);
    return `@${name}`;
  });
  const deleteRetainedCondition = deletePlaceholders.length
    ? `AND pv.id NOT IN (${deletePlaceholders.join(", ")})`
    : "";

  await deleteRequest.query(`
    DELETE stock
    FROM inventory_stocks stock
    INNER JOIN product_variants pv ON pv.id = stock.variant_id
    WHERE pv.product_id = @ProductId
      ${deleteRetainedCondition}
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM cart_items cart WHERE cart.variant_id = pv.id);

    DELETE pv
    FROM product_variants pv
    WHERE pv.product_id = @ProductId
      ${deleteRetainedCondition}
      AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.variant_id = pv.id)
      AND NOT EXISTS (SELECT 1 FROM cart_items cart WHERE cart.variant_id = pv.id);
  `);
};

// Đọc số lượng sản phẩm tối đa cho tính năng so sánh từ biến môi trường.
const resolveCompareMaxItems = () => {
  const envValue = Number(process.env.COMPARE_MAX_ITEMS || DEFAULT_COMPARE_MAX_ITEMS);

  if (!Number.isFinite(envValue)) {
    return DEFAULT_COMPARE_MAX_ITEMS;
  }

  return Math.max(2, Math.floor(envValue));
};

// Lưu ảnh sản phẩm dạng data URL ra thư mục uploads hoặc giữ nguyên URL có sẵn.
// Chặn hoàn toàn việc lưu ảnh local từ data URL.
const saveProductImage = (req, imageValue) => {
  const normalizedValue = String(imageValue || "").trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.startsWith("data:image/")) {
    throw new Error("Tải ảnh từ máy tính (local) không được phép. Vui lòng cung cấp URL ảnh công khai.");
  }

  return normalizedValue;
};

// Ánh xạ trạng thái sản phẩm admin sang nhãn dễ đọc.
const buildAdminStatusLabel = (status) => {
  const normalizedStatus = String(status || "").trim().toUpperCase();

  if (normalizedStatus === "ACTIVE") {
    return "Dang ban";
  }

  if (normalizedStatus === "DRAFT") {
    return "Ban nhap";
  }

  if (normalizedStatus === "HIDDEN") {
    return "An";
  }

  return normalizeLabel(status || "Chua cap nhat");
};

// Gộp dữ liệu sản phẩm, ảnh, biến thể và bảng giá thành payload admin hoàn chỉnh.
const buildAdminProducts = (products, images, variants, priceTiers = [], details = []) =>
  products.map((product) => {
    const pDetail = details.find((d) => d.product_id === product.id);
    return {
      id: product.id,
      category_id: product.category_id,
      category_name: product.category_name || "Chua phan loai",
      name: product.name,
      description: product.description || "",
      material_type: product.material_type || "",
      base_weight: Number(product.base_weight || 0),
      status: product.status || "DRAFT",
      status_label: buildAdminStatusLabel(product.status),
      created_at: product.created_at,
      attributes: pDetail ? {
        mainMaterial: pDetail.main_material || "",
        materialPurity: pDetail.material_purity || "",
        primaryColor: pDetail.primary_color || "",
        mainGemstone: pDetail.main_gemstone || "",
        gemstoneSize: pDetail.gemstone_size || "",
        gemstoneShape: pDetail.gemstone_shape || "",
        sideGemstone: pDetail.side_gemstone || "",
        gender: pDetail.gender || "",
        collection: pDetail.collection || "",
        origin: pDetail.origin || "",
        warrantyMonths: pDetail.warranty_months !== null ? Number(pDetail.warranty_months) : 12,
      } : {
        mainMaterial: "",
        materialPurity: "",
        primaryColor: "",
        mainGemstone: "",
        gemstoneSize: "",
        gemstoneShape: "",
        sideGemstone: "",
        gender: "",
        collection: "",
        origin: "",
        warrantyMonths: 12,
      },
      images: images
        .filter((item) => item.product_id === product.id)
        .map((item) => ({
          id: item.id,
          url: item.url,
          is_main: Boolean(item.is_main),
        })),
      variants: variants
        .filter((item) => item.product_id === product.id)
        .map((item) => ({
          id: item.id,
          sku: item.sku,
          size: item.size || "Free size",
          weight_modifier: Number(item.weight_modifier || 0),
          stock: {
            quantity: Number(item.quantity || 0),
            warehouse_location: item.warehouse_location || "Chua cap nhat",
          },
        })),
      price_tiers: priceTiers
        .filter((item) => item.product_id === product.id)
        .map((item) =>
          mapPriceTier(item, {
            baseSellPrice: product.base_sell_price,
            baseWeight: product.base_weight,
            laborCost: product.labor_cost,
            stoneCost: product.stone_cost,
          })
        ),
      pricing: {
        labor_cost: Number(product.labor_cost || 0),
        stone_cost: Number(product.stone_cost || 0),
        markup_rate: Number(product.markup_rate || 0),
        current_sale_price_cache: computeSalePrice({
          baseSellPrice: product.base_sell_price,
          baseWeight: product.base_weight,
          laborCost: product.labor_cost,
          stoneCost: product.stone_cost,
          markupRate: product.markup_rate,
        }),
      },
    };
  });

module.exports = {
  buildAdminProducts,
  buildAdminStatusLabel,
  buildBadge,
  computeSalePrice,
  ensureProductPriceTiersSchema,
  ensureProductDetailsSchema,
  findDuplicateVariantSku,
  findInvalidNumericProductFields,
  formatCurrency,
  formatDateTime,
  mapPriceTier,
  normalizeLabel,
  normalizePriceTierInputs,
  normalizeVariantInputs,
  replaceProductPriceTiers,
  resolveCompareMaxItems,
  retireMissingProductVariants,
  saveProductImage,
  upsertProductVariants,
  validatePriceTiers,
  validateVariantSkusAvailable,
};
