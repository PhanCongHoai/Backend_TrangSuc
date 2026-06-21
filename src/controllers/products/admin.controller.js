const { poolPromise, sql } = require("../../config/db");
const {
  buildAdminProducts,
  computeSalePrice,
  ensureProductPriceTiersSchema,
  findDuplicateVariantSku,
  findInvalidNumericProductFields,
  normalizePriceTierInputs,
  normalizeVariantInputs,
  replaceProductPriceTiers,
  retireMissingProductVariants,
  saveProductImage,
  upsertProductVariants,
  validatePriceTiers,
  validateVariantSkusAvailable,
} = require("./shared");

const formatDeleteProductErrorMessage = (error) => {
  const sqlMessage = String(error?.originalError?.info?.message || error?.message || "").trim();

  if (
    Number(error?.number) === 547 ||
    /reference constraint|conflicted with the reference constraint/i.test(sqlMessage)
  ) {
    return "Sản phẩm đang còn dữ liệu liên kết nên chưa thể xóa. Hãy ẩn sản phẩm thay vì xóa.";
  }

  if (/invalid object name ['"]?product_price_tiers['"]?/i.test(sqlMessage)) {
    return "Cấu trúc dữ liệu giá số lượng chưa được đồng bộ. Vui lòng tải lại trang và thử xóa lại.";
  }

  return "Không thể xóa sản phẩm lúc này. Vui lòng thử lại sau.";
};

// Lấy toàn bộ dữ liệu sản phẩm phục vụ màn hình quản trị.
const getAdminProducts = async (req, res) => {
  try {
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);

    const [productsResult, imagesResult, variantsResult, priceTiersResult] = await Promise.all([
      pool.request().query(`
        WITH latest_rates AS (
          SELECT
            material_type,
            base_sell_price,
            ROW_NUMBER() OVER (
              PARTITION BY material_type
              ORDER BY id DESC
            ) AS rn
          FROM gold_rate_history
        )
        SELECT
          p.id,
          p.category_id,
          p.name,
          p.description,
          p.material_type,
          p.base_weight,
          p.status,
          p.created_at,
          c.name AS category_name,
          pricing.labor_cost,
          pricing.stone_cost,
          pricing.markup_rate,
          pricing.current_sale_price_cache,
          rate.base_sell_price
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN product_pricing_configs pricing ON pricing.product_id = p.id
        LEFT JOIN latest_rates rate
          ON rate.material_type = p.material_type
          AND rate.rn = 1
        ORDER BY p.created_at DESC, p.id DESC
      `),
      pool.request().query(`
        SELECT
          id,
          product_id,
          url,
          is_main
        FROM product_images
        ORDER BY product_id ASC, CASE WHEN is_main = 1 THEN 0 ELSE 1 END, id ASC
      `),
      pool.request().query(`
        SELECT
          pv.id,
          pv.product_id,
          pv.sku,
          pv.size,
          pv.weight_modifier,
          stock.quantity,
          stock.warehouse_location
        FROM product_variants pv
        LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
        ORDER BY pv.product_id ASC, pv.id ASC
      `),
      pool.request().query(`
        SELECT
          id,
          product_id,
          min_quantity,
          max_quantity,
          tier_price,
          markup_rate
        FROM product_price_tiers
        ORDER BY product_id ASC, min_quantity ASC, id ASC
      `),
    ]);

    const products = buildAdminProducts(
      productsResult.recordset,
      imagesResult.recordset,
      variantsResult.recordset,
      priceTiersResult.recordset
    );

    return res.status(200).json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("Get admin products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Tạo sản phẩm mới kèm biến thể, cấu hình giá và ảnh đại diện.
const createAdminProduct = async (req, res) => {
  const {
    category_id,
    name,
    description,
    material_type,
    base_weight,
    status,
    variants,
    sku,
    size,
    weight_modifier,
    main_image_url,
    labor_cost,
    stone_cost,
    markup_rate,
    price_tiers,
    stock_quantity,
    warehouse_location,
  } = req.body;

  if (String(main_image_url || "").trim().startsWith("data:image/")) {
    return res.status(400).json({
      success: false,
      message: "Tải ảnh từ máy tính (local) không được phép. Vui lòng cung cấp địa chỉ URL ảnh công khai.",
    });
  }

  if (!String(name || "").trim()) {
    return res.status(400).json({ success: false, message: "Product name is required." });
  }

  if (!String(material_type || "").trim()) {
    return res.status(400).json({ success: false, message: "material_type is required." });
  }

  const tierValidationError = validatePriceTiers(price_tiers || req.body?.priceTiers);
  if (tierValidationError) {
    return res.status(400).json({
      success: false,
      message: tierValidationError,
    });
  }

  const invalidNumericFields = findInvalidNumericProductFields({
    base_weight,
    weight_modifier,
    labor_cost,
    stone_cost,
    markup_rate,
    variants: variants || req.body?.variants,
    fallbackVariant: {
      sku,
      size,
      weight_modifier,
      stock_quantity,
      warehouse_location,
    },
  });

  const normalizedCategoryId =
    category_id === null || category_id === "" || category_id === undefined
      ? null
      : Number(category_id);
  const normalizedBaseWeight = Number(base_weight || 0);
  const normalizedLaborCost = Number(labor_cost || 0);
  const normalizedStoneCost = Number(stone_cost || 0);
  const normalizedMarkupRate = Number(markup_rate || 0);
  const normalizedStatus = String(status || "DRAFT").trim().toUpperCase();
  const normalizedPriceTiers = normalizePriceTierInputs(price_tiers || req.body?.priceTiers);
  const normalizedVariants = normalizeVariantInputs(variants || req.body?.variants, {
    sku,
    size,
    weight_modifier,
    stock_quantity,
    warehouse_location,
  });

  if (!normalizedVariants.length || normalizedVariants.some((variant) => !variant.sku)) {
    return res.status(400).json({
      success: false,
      message: "Vui long nhap it nhat mot bien the co SKU.",
    });
  }

  const duplicateInputSku = findDuplicateVariantSku(normalizedVariants);

  if (duplicateInputSku) {
    return res.status(400).json({
      success: false,
      message: `SKU ${duplicateInputSku} bi trung trong danh sach bien the.`,
    });
  }

  if (normalizedCategoryId !== null && Number.isNaN(normalizedCategoryId)) {
    return res.status(400).json({ success: false, message: "category_id is invalid." });
  }

  if (invalidNumericFields.length) {
    return res.status(400).json({
      success: false,
      message: `CÃ¡c trÆ°á»ng sá»‘ khÃ´ng há»£p lá»‡: ${invalidNumericFields.join(", ")}.`,
    });
  }

  let transaction;

  try {
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);
    const normalizedMainImageUrl = saveProductImage(req, main_image_url);
    const latestRateResult = await pool
      .request()
      .input("MaterialType", sql.NVarChar(50), String(material_type).trim())
      .query(`
        SELECT TOP 1 base_sell_price
        FROM gold_rate_history
        WHERE material_type = @MaterialType
        ORDER BY id DESC
      `);

    const latestRate = latestRateResult.recordset[0];

    if (!latestRate) {
      return res.status(400).json({
        success: false,
        message: "Khong tim thay gia vang hien hanh cho chat lieu da chon.",
      });
    }

    const computedSalePrice = computeSalePrice({
      baseSellPrice: latestRate.base_sell_price,
      baseWeight: normalizedBaseWeight,
      laborCost: normalizedLaborCost,
      stoneCost: normalizedStoneCost,
      markupRate: normalizedMarkupRate,
    });

    const duplicateSku = await validateVariantSkusAvailable(pool, normalizedVariants);

    if (duplicateSku) {
      return res.status(409).json({
        success: false,
        message: `SKU ${duplicateSku} already exists.`,
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const productRequest = new sql.Request(transaction);
    const productInsert = await productRequest
      .input("CategoryId", sql.Int, normalizedCategoryId)
      .input("Name", sql.NVarChar(200), String(name).trim())
      .input("Description", sql.NVarChar(sql.MAX), String(description || "").trim() || null)
      .input("MaterialType", sql.NVarChar(50), String(material_type).trim())
      .input("BaseWeight", sql.Float, normalizedBaseWeight)
      .input("Status", sql.VarChar(50), normalizedStatus)
      .query(`
        INSERT INTO products (category_id, name, description, material_type, base_weight, status)
        OUTPUT INSERTED.id, INSERTED.created_at
        VALUES (@CategoryId, @Name, @Description, @MaterialType, @BaseWeight, @Status)
      `);

    const productId = productInsert.recordset[0].id;

    await upsertProductVariants(transaction, productId, normalizedVariants);

    await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .input("LaborCost", sql.Decimal(15, 2), normalizedLaborCost)
      .input("StoneCost", sql.Decimal(15, 2), normalizedStoneCost)
      .input("MarkupRate", sql.Float, normalizedMarkupRate)
      .input("SalePrice", sql.Decimal(15, 2), computedSalePrice)
      .query(`
        INSERT INTO product_pricing_configs (
          product_id,
          labor_cost,
          stone_cost,
          markup_rate,
          current_sale_price_cache
        )
        VALUES (@ProductId, @LaborCost, @StoneCost, @MarkupRate, @SalePrice)
      `);

    await replaceProductPriceTiers(transaction, productId, normalizedPriceTiers, {
      baseSellPrice: latestRate.base_sell_price,
      baseWeight: normalizedBaseWeight,
      laborCost: normalizedLaborCost,
      stoneCost: normalizedStoneCost,
    });

    if (normalizedMainImageUrl) {
      await new sql.Request(transaction)
        .input("ProductId", sql.Int, productId)
        .input("Url", sql.VarChar(255), normalizedMainImageUrl)
        .query(`
          INSERT INTO product_images (product_id, url, is_main)
          VALUES (@ProductId, @Url, 1)
        `);
    }

    await transaction.commit();

    return res.status(201).json({
      success: true,
      message: "Product created successfully.",
      productId,
      computedSalePrice,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback create product error:", rollbackError);
      }
    }

    console.error("Create admin product error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Cập nhật sản phẩm hiện có và đồng bộ lại biến thể, giá, ảnh chính.
const updateAdminProduct = async (req, res) => {
  const productId = Number(req.params.id);
  const {
    category_id,
    name,
    description,
    material_type,
    base_weight,
    status,
    variants,
    sku,
    size,
    weight_modifier,
    main_image_url,
    labor_cost,
    stone_cost,
    markup_rate,
    price_tiers,
    stock_quantity,
    warehouse_location,
  } = req.body;

  if (Number.isNaN(productId) || productId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product id.",
    });
  }

  if (String(main_image_url || "").trim().startsWith("data:image/")) {
    return res.status(400).json({
      success: false,
      message: "Tải ảnh từ máy tính (local) không được phép. Vui lòng cung cấp địa chỉ URL ảnh công khai.",
    });
  }

  if (!String(name || "").trim()) {
    return res.status(400).json({ success: false, message: "Product name is required." });
  }

  if (!String(material_type || "").trim()) {
    return res.status(400).json({ success: false, message: "material_type is required." });
  }

  const tierValidationError = validatePriceTiers(price_tiers || req.body?.priceTiers);
  if (tierValidationError) {
    return res.status(400).json({
      success: false,
      message: tierValidationError,
    });
  }

  const invalidNumericFields = findInvalidNumericProductFields({
    base_weight,
    weight_modifier,
    labor_cost,
    stone_cost,
    markup_rate,
    variants: variants || req.body?.variants,
    fallbackVariant: {
      sku,
      size,
      weight_modifier,
      stock_quantity,
      warehouse_location,
    },
  });

  const normalizedCategoryId =
    category_id === null || category_id === "" || category_id === undefined
      ? null
      : Number(category_id);
  const normalizedBaseWeight = Number(base_weight || 0);
  const normalizedLaborCost = Number(labor_cost || 0);
  const normalizedStoneCost = Number(stone_cost || 0);
  const normalizedMarkupRate = Number(markup_rate || 0);
  const normalizedStatus = String(status || "DRAFT").trim().toUpperCase();
  const normalizedPriceTiers = normalizePriceTierInputs(price_tiers || req.body?.priceTiers);
  const normalizedVariants = normalizeVariantInputs(variants || req.body?.variants, {
    sku,
    size,
    weight_modifier,
    stock_quantity,
    warehouse_location,
  });

  if (!normalizedVariants.length || normalizedVariants.some((variant) => !variant.sku)) {
    return res.status(400).json({
      success: false,
      message: "Vui long nhap it nhat mot bien the co SKU.",
    });
  }

  const duplicateInputSku = findDuplicateVariantSku(normalizedVariants);

  if (duplicateInputSku) {
    return res.status(400).json({
      success: false,
      message: `SKU ${duplicateInputSku} bi trung trong danh sach bien the.`,
    });
  }

  if (normalizedCategoryId !== null && Number.isNaN(normalizedCategoryId)) {
    return res.status(400).json({ success: false, message: "category_id is invalid." });
  }

  if (invalidNumericFields.length) {
    return res.status(400).json({
      success: false,
      message: `CÃ¡c trÆ°á»ng sá»‘ khÃ´ng há»£p lá»‡: ${invalidNumericFields.join(", ")}.`,
    });
  }

  let transaction;

  try {
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);
    const normalizedMainImageUrl = saveProductImage(req, main_image_url);
    const existingProductResult = await pool.request().input("ProductId", sql.Int, productId)
      .query(`
        SELECT TOP 1 p.id, pv.id AS variant_id, img.id AS image_id, pricing.product_id AS pricing_product_id
        FROM products p
        LEFT JOIN product_variants pv ON pv.product_id = p.id
        LEFT JOIN product_images img ON img.product_id = p.id AND img.is_main = 1
        LEFT JOIN product_pricing_configs pricing ON pricing.product_id = p.id
        WHERE p.id = @ProductId
        ORDER BY pv.id ASC, img.id ASC
      `);

    const existingProduct = existingProductResult.recordset[0];

    if (!existingProduct) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const latestRateResult = await pool
      .request()
      .input("MaterialType", sql.NVarChar(50), String(material_type).trim())
      .query(`
        SELECT TOP 1 base_sell_price
        FROM gold_rate_history
        WHERE material_type = @MaterialType
        ORDER BY id DESC
      `);

    const latestRate = latestRateResult.recordset[0];

    if (!latestRate) {
      return res.status(400).json({
        success: false,
        message: "Khong tim thay gia vang hien hanh cho chat lieu da chon.",
      });
    }

    const duplicateSku = await validateVariantSkusAvailable(pool, normalizedVariants);

    if (duplicateSku) {
      return res.status(409).json({
        success: false,
        message: `SKU ${duplicateSku} already exists.`,
      });
    }

    const computedSalePrice = computeSalePrice({
      baseSellPrice: latestRate.base_sell_price,
      baseWeight: normalizedBaseWeight,
      laborCost: normalizedLaborCost,
      stoneCost: normalizedStoneCost,
      markupRate: normalizedMarkupRate,
    });

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .input("CategoryId", sql.Int, normalizedCategoryId)
      .input("Name", sql.NVarChar(200), String(name).trim())
      .input("Description", sql.NVarChar(sql.MAX), String(description || "").trim() || null)
      .input("MaterialType", sql.NVarChar(50), String(material_type).trim())
      .input("BaseWeight", sql.Float, normalizedBaseWeight)
      .input("Status", sql.VarChar(50), normalizedStatus)
      .query(`
        UPDATE products
        SET
          category_id = @CategoryId,
          name = @Name,
          description = @Description,
          material_type = @MaterialType,
          base_weight = @BaseWeight,
          status = @Status
        WHERE id = @ProductId
      `);

    const retainedVariantIds = await upsertProductVariants(
      transaction,
      productId,
      normalizedVariants
    );
    await retireMissingProductVariants(transaction, productId, retainedVariantIds);

    await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .input("LaborCost", sql.Decimal(15, 2), normalizedLaborCost)
      .input("StoneCost", sql.Decimal(15, 2), normalizedStoneCost)
      .input("MarkupRate", sql.Float, normalizedMarkupRate)
      .input("SalePrice", sql.Decimal(15, 2), computedSalePrice)
      .query(`
        MERGE product_pricing_configs AS target
        USING (SELECT @ProductId AS product_id) AS source
        ON target.product_id = source.product_id
        WHEN MATCHED THEN
          UPDATE SET
            labor_cost = @LaborCost,
            stone_cost = @StoneCost,
            markup_rate = @MarkupRate,
            current_sale_price_cache = @SalePrice
        WHEN NOT MATCHED THEN
          INSERT (product_id, labor_cost, stone_cost, markup_rate, current_sale_price_cache)
          VALUES (@ProductId, @LaborCost, @StoneCost, @MarkupRate, @SalePrice);
      `);

    await replaceProductPriceTiers(transaction, productId, normalizedPriceTiers, {
      baseSellPrice: latestRate.base_sell_price,
      baseWeight: normalizedBaseWeight,
      laborCost: normalizedLaborCost,
      stoneCost: normalizedStoneCost,
    });

    if (normalizedMainImageUrl) {
      await new sql.Request(transaction)
        .input("ProductId", sql.Int, productId)
        .input("Url", sql.VarChar(255), normalizedMainImageUrl)
        .query(`
          UPDATE product_images
          SET is_main = 0
          WHERE product_id = @ProductId
        `);

      await new sql.Request(transaction)
        .input("ProductId", sql.Int, productId)
        .input("Url", sql.VarChar(255), normalizedMainImageUrl)
        .query(`
          MERGE product_images AS target
          USING (
            SELECT TOP 1 id
            FROM product_images
            WHERE product_id = @ProductId
            ORDER BY CASE WHEN is_main = 1 THEN 0 ELSE 1 END, id ASC
          ) AS source
          ON target.id = source.id
          WHEN MATCHED THEN
            UPDATE SET
              url = @Url,
              is_main = 1
          WHEN NOT MATCHED THEN
            INSERT (product_id, url, is_main)
            VALUES (@ProductId, @Url, 1);
        `);
    }

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Product updated successfully.",
      productId,
      computedSalePrice,
      status: normalizedStatus,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback update product error:", rollbackError);
      }
    }

    console.error("Update admin product error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Xóa một sản phẩm khi chưa phát sinh giao dịch hoặc lịch sử kho ràng buộc.
const deleteAdminProduct = async (req, res) => {
  const productId = Number(req.params.id);

  if (Number.isNaN(productId) || productId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product id.",
    });
  }

  let transaction;

  try {
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);
    const variantIdsResult = await pool.request().input("ProductId", sql.Int, productId).query(`
      SELECT id
      FROM product_variants
      WHERE product_id = @ProductId
    `);

    const variantIds = variantIdsResult.recordset.map((item) => Number(item.id));

    const hasOrderItems = variantIds.length
      ? (
          await pool.request().input("ProductId", sql.Int, productId).query(`
            SELECT TOP 1 oi.id
            FROM order_items oi
            INNER JOIN product_variants pv ON pv.id = oi.variant_id
            WHERE pv.product_id = @ProductId
          `)
        ).recordset.length > 0
      : false;

    const hasInventoryHistory = false;

    if (hasOrderItems || hasInventoryHistory) {
      return res.status(409).json({
        success: false,
        message: "San pham da phat sinh giao dich hoac lich su kho, hay an san pham thay vi xoa.",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction)
      .input("ProductId", sql.Int, productId)
      .query(`
        DELETE FROM reviews WHERE product_id = @ProductId;
        DELETE FROM product_certificates WHERE product_id = @ProductId;
        DELETE FROM product_images WHERE product_id = @ProductId;
        DELETE FROM product_price_tiers WHERE product_id = @ProductId;
        DELETE FROM product_pricing_configs WHERE product_id = @ProductId;
        DELETE cart_items
        FROM cart_items
        INNER JOIN product_variants pv ON pv.id = cart_items.variant_id
        WHERE pv.product_id = @ProductId;
        DELETE FROM inventory_stocks
        WHERE variant_id IN (SELECT id FROM product_variants WHERE product_id = @ProductId);
        DELETE FROM product_variants WHERE product_id = @ProductId;
        DELETE FROM products WHERE id = @ProductId;
      `);

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "Product deleted successfully.",
      productId,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback delete product error:", rollbackError);
      }
    }

    console.error("Delete admin product error:", error);
    return res.status(500).json({
      success: false,
      message: formatDeleteProductErrorMessage(error),
    });
  }
};

// Xóa toàn bộ sản phẩm khi dữ liệu chưa dính tới giao dịch hay lịch sử kho.
const deleteAllAdminProducts = async (req, res) => {
  let transaction;

  try {
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);

    const productsCountResult = await pool.request().query(`
      SELECT COUNT(1) AS total_products
      FROM products
    `);
    const totalProducts = Number(productsCountResult.recordset[0]?.total_products || 0);

    if (totalProducts <= 0) {
      return res.status(200).json({
        success: true,
        message: "No products to delete.",
        deletedProducts: 0,
      });
    }

    const hasOrderItems =
      (
        await pool.request().query(`
          SELECT TOP 1 oi.id
          FROM order_items oi
          INNER JOIN product_variants pv ON pv.id = oi.variant_id
        `)
      ).recordset.length > 0;

    const hasInventoryHistory = false;

    if (hasOrderItems || hasInventoryHistory) {
      return res.status(409).json({
        success: false,
        message: "Khong the xoa tat ca vi da co giao dich hoac lich su kho. Hay an san pham thay vi xoa.",
      });
    }

    transaction = new sql.Transaction(pool);
    await transaction.begin();

    await new sql.Request(transaction).query(`
      DELETE FROM reviews;
      DELETE FROM product_certificates;
      DELETE FROM product_images;
      DELETE FROM product_price_tiers;
      DELETE FROM product_pricing_configs;
      DELETE FROM cart_items;
      DELETE FROM inventory_stocks;
      DELETE FROM product_variants;
      DELETE FROM products;
    `);

    await transaction.commit();

    return res.status(200).json({
      success: true,
      message: "All products deleted successfully.",
      deletedProducts: totalProducts,
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback delete all products error:", rollbackError);
      }
    }

    console.error("Delete all products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Ẩn toàn bộ sản phẩm khỏi giao diện khách hàng nhưng vẫn giữ dữ liệu.
const hideAllAdminProducts = async (req, res) => {
  try {
    const pool = await poolPromise;

    const productsCountResult = await pool.request().query(`
      SELECT COUNT(1) AS total_products
      FROM products
    `);
    const totalProducts = Number(productsCountResult.recordset[0]?.total_products || 0);

    if (totalProducts <= 0) {
      return res.status(200).json({
        success: true,
        message: "No products to hide.",
        totalProducts: 0,
        hiddenProducts: 0,
        products: [],
      });
    }

    const result = await pool.request().query(`
      UPDATE products
      SET status = 'HIDDEN'
      OUTPUT INSERTED.id, INSERTED.status
      WHERE status IS NULL OR UPPER(status) <> 'HIDDEN'
    `);

    return res.status(200).json({
      success: true,
      message: "All products hidden successfully.",
      totalProducts,
      hiddenProducts: result.recordset.length,
      products: result.recordset,
    });
  } catch (error) {
    console.error("Hide all admin products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Ẩn một sản phẩm cụ thể khỏi giao diện khách hàng.
const hideAdminProduct = async (req, res) => {
  const productId = Number(req.params.id);

  if (Number.isNaN(productId) || productId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product id.",
    });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .query(`
        UPDATE products
        SET status = 'HIDDEN'
        OUTPUT INSERTED.id, INSERTED.status
        WHERE id = @ProductId
      `);

    const product = result.recordset[0];

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product hidden successfully.",
      product,
    });
  } catch (error) {
    console.error("Hide admin product error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Hiển thị lại một sản phẩm đã bị ẩn.
const showAdminProduct = async (req, res) => {
  const productId = Number(req.params.id);

  if (Number.isNaN(productId) || productId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Invalid product id.",
    });
  }

  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .query(`
        UPDATE products
        SET status = 'ACTIVE'
        OUTPUT INSERTED.id, INSERTED.status
        WHERE id = @ProductId
      `);

    const product = result.recordset[0];

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Product shown successfully.",
      product,
    });
  } catch (error) {
    console.error("Show admin product error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  createAdminProduct,
  deleteAdminProduct,
  deleteAllAdminProducts,
  getAdminProducts,
  hideAdminProduct,
  hideAllAdminProducts,
  showAdminProduct,
  updateAdminProduct,
};
