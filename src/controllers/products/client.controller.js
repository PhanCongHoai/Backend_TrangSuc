const { poolPromise, sql } = require("../../config/db");
const {
  buildBadge,
  computeSalePrice,
  ensureProductPriceTiersSchema,
  formatCurrency,
  formatDateTime,
  mapPriceTier,
  normalizeLabel,
} = require("./shared");

// Lấy danh sách sản phẩm công khai có hỗ trợ lọc, sắp xếp và phân trang.
const getClientProducts = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 12, 1), 48);
    const search = String(req.query.search || "").trim().toLowerCase();
    const category = String(req.query.category || "").trim().toLowerCase();
    const sort = String(req.query.sort || "newest").trim().toLowerCase();
    const inStockOnly =
      String(req.query.in_stock || req.query.inStock || "").trim() === "1";
    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);

    const result = await pool.request().query(`
      WITH latest_rates AS (
        SELECT
          material_type,
          base_sell_price,
          recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY material_type
            ORDER BY id DESC
          ) AS rn
        FROM gold_rate_history
      ),
      primary_images AS (
        SELECT
          product_id,
          url,
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY
              CASE WHEN is_main = 1 THEN 0 ELSE 1 END,
              id ASC
          ) AS rn
        FROM product_images
      ),
      inventory_summary AS (
        SELECT
          pv.product_id,
          SUM(ISNULL(stock.quantity, 0)) AS total_quantity
        FROM product_variants pv
        LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
        GROUP BY pv.product_id
      )
      SELECT
        p.id,
        p.name,
        p.description,
        p.material_type,
        p.base_weight,
        p.status,
        p.created_at,
        c.name AS category_name,
        parent.name AS parent_category_name,
        img.url AS image_url,
        pc.current_sale_price_cache,
        pc.labor_cost,
        pc.stone_cost,
        pc.markup_rate,
        inventory.total_quantity,
        rate.base_sell_price,
        rate.recorded_at AS latest_rate_recorded_at
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN product_categories parent ON parent.id = c.parent_id
      LEFT JOIN primary_images img ON img.product_id = p.id AND img.rn = 1
      LEFT JOIN product_pricing_configs pc ON pc.product_id = p.id
      LEFT JOIN inventory_summary inventory ON inventory.product_id = p.id
      LEFT JOIN latest_rates rate
        ON rate.material_type = p.material_type
        AND rate.rn = 1
      WHERE UPPER(ISNULL(p.status, '')) = 'ACTIVE'
    `);

    let products = result.recordset.map((item) => {
      const salePrice = computeSalePrice({
        baseSellPrice: item.base_sell_price,
        baseWeight: item.base_weight,
        laborCost: item.labor_cost,
        stoneCost: item.stone_cost,
        markupRate: item.markup_rate,
      });

      return {
        id: item.id,
        name: item.name,
        category: item.category_name || item.parent_category_name || "Trang suc",
        parentCategory: item.parent_category_name || null,
        price: formatCurrency(salePrice),
        salePrice,
        material: normalizeLabel(item.material_type),
        stockQuantity: Number(item.total_quantity || 0),
        badge: buildBadge(item.status),
        image:
          item.image_url ||
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ1xp79XGKoIg-gZeZiRg2G7mpp2A6kH-AWow&s",
        description: String(item.description || "").trim(),
      };
    });

    // Giữ nguyên toàn bộ danh mục khả dụng để thanh lọc trên frontend
    // không bị co lại sau khi người dùng chọn một danh mục cụ thể.
    const categories = [
      ...new Set(
        products.map((item) => String(item.category || "").trim()).filter(Boolean)
      ),
    ];

    if (search) {
      products = products.filter((item) => {
        const target = `${item.name} ${item.category} ${item.material} ${item.description}`.toLowerCase();
        return target.includes(search);
      });
    }

    if (category) {
      products = products.filter(
        (item) =>
          String(item.category || "").toLowerCase() === category ||
          String(item.parentCategory || "").toLowerCase() === category
      );
    }

    if (inStockOnly) {
      products = products.filter((item) => Number(item.stockQuantity || 0) > 0);
    }

    products.sort((left, right) => {
      if (sort === "price_asc") return left.salePrice - right.salePrice;
      if (sort === "price_desc") return right.salePrice - left.salePrice;
      if (sort === "name_asc") return String(left.name).localeCompare(String(right.name), "vi");
      if (sort === "name_desc") return String(right.name).localeCompare(String(left.name), "vi");
      return Number(right.id || 0) - Number(left.id || 0);
    });

    const totalItems = products.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const normalizedPage = Math.min(page, totalPages);
    const startIndex = (normalizedPage - 1) * limit;
    const pagedProducts = products.slice(startIndex, startIndex + limit);

    return res.status(200).json({
      success: true,
      products: pagedProducts,
      categories,
      filters: {
        search,
        category,
        sort,
        inStockOnly,
      },
      pagination: {
        page: normalizedPage,
        limit,
        totalItems,
        totalPages,
      },
    });
  } catch (error) {
    console.error("Get client products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy danh sách sản phẩm nổi bật hoặc mới nhất để hiển thị ở trang chủ.
const getFeaturedProducts = async (req, res) => {
  try {
    const pageSize = Math.min(Math.max(Number(req.query.limit) || 8, 1), 120);
    const pool = await poolPromise;

    const result = await pool.request().input("Limit", sql.Int, pageSize).query(`
      WITH latest_rates AS (
        SELECT
          material_type,
          base_sell_price,
          recorded_at,
          ROW_NUMBER() OVER (
            PARTITION BY material_type
            ORDER BY id DESC
          ) AS rn
        FROM gold_rate_history
      ),
      primary_images AS (
        SELECT
          product_id,
          url,
          ROW_NUMBER() OVER (
            PARTITION BY product_id
            ORDER BY
              CASE WHEN is_main = 1 THEN 0 ELSE 1 END,
              id ASC
          ) AS rn
        FROM product_images
      ),
      inventory_summary AS (
        SELECT
          pv.product_id,
          SUM(ISNULL(stock.quantity, 0)) AS total_quantity
        FROM product_variants pv
        LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
        GROUP BY pv.product_id
      )
      SELECT TOP (@Limit)
        p.id,
        p.name,
        p.description,
        p.material_type,
        p.base_weight,
        p.status,
        p.created_at,
        c.name AS category_name,
        parent.name AS parent_category_name,
        img.url AS image_url,
        pc.current_sale_price_cache,
        pc.labor_cost,
        pc.stone_cost,
        pc.markup_rate,
        inventory.total_quantity,
        rate.base_sell_price,
        rate.recorded_at AS latest_rate_recorded_at
      FROM products p
      LEFT JOIN product_categories c ON c.id = p.category_id
      LEFT JOIN product_categories parent ON parent.id = c.parent_id
      LEFT JOIN primary_images img ON img.product_id = p.id AND img.rn = 1
      LEFT JOIN product_pricing_configs pc ON pc.product_id = p.id
      LEFT JOIN inventory_summary inventory ON inventory.product_id = p.id
      LEFT JOIN latest_rates rate
        ON rate.material_type = p.material_type
        AND rate.rn = 1
      WHERE UPPER(ISNULL(p.status, '')) = 'ACTIVE'
        AND ISNULL(inventory.total_quantity, 0) > 0
      ORDER BY p.created_at DESC, p.id DESC
    `);

    const products = result.recordset.map((item) => {
      const salePrice = computeSalePrice({
        baseSellPrice: item.base_sell_price,
        baseWeight: item.base_weight,
        laborCost: item.labor_cost,
        stoneCost: item.stone_cost,
        markupRate: item.markup_rate,
      });

      return {
        id: item.id,
        name: item.name,
        category: item.category_name || item.parent_category_name || "Trang suc",
        parentCategory: item.parent_category_name || null,
        price: formatCurrency(salePrice),
        salePrice,
        material: normalizeLabel(item.material_type),
        stockQuantity: Number(item.total_quantity || 0),
        badge: buildBadge(item.status),
        image:
          item.image_url ||
          "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ1xp79XGKoIg-gZeZiRg2G7mpp2A6kH-AWow&s",
        description: String(item.description || "").trim(),
        pricing: {
          materialType: item.material_type,
          baseWeight: Number(item.base_weight || 0),
          baseSellPrice: Number(item.base_sell_price || 0),
          laborCost: Number(item.labor_cost || 0),
          stoneCost: Number(item.stone_cost || 0),
          markupRate: Number(item.markup_rate || 0),
          latestRateRecordedAt: item.latest_rate_recorded_at || null,
        },
      };
    });

    return res.status(200).json({
      success: true,
      products,
    });
  } catch (error) {
    console.error("Get featured products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy toàn bộ thông tin chi tiết của một sản phẩm công khai.
const getProductDetail = async (req, res) => {
  try {
    const productId = Number(req.params.id);

    if (Number.isNaN(productId)) {
      return res.status(400).json({
        success: false,
        message: "Product id is invalid.",
      });
    }

    const pool = await poolPromise;
    await ensureProductPriceTiersSchema(pool);

    const productResult = await pool.request().input("ProductId", sql.Int, productId)
      .query(`
        WITH latest_rates AS (
          SELECT
            material_type,
            base_sell_price,
            recorded_at,
            ROW_NUMBER() OVER (
              PARTITION BY material_type
              ORDER BY id DESC
            ) AS rn
          FROM gold_rate_history
        )
        SELECT
          p.id,
          p.name,
          p.description,
          p.material_type,
          p.base_weight,
          p.status,
          p.created_at,
          c.name AS category_name,
          c.id AS category_id,
          parent.name AS parent_category_name,
          parent.id AS parent_category_id,
          pc.labor_cost,
          pc.stone_cost,
          pc.markup_rate,
          pc.current_sale_price_cache,
          rate.base_sell_price,
          rate.recorded_at AS latest_rate_recorded_at
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN product_categories parent ON parent.id = c.parent_id
        LEFT JOIN product_pricing_configs pc ON pc.product_id = p.id
        LEFT JOIN latest_rates rate
          ON rate.material_type = p.material_type
          AND rate.rn = 1
        WHERE p.id = @ProductId
      `);

    const product = productResult.recordset[0];

    if (!product) {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    if (String(product.status || "").trim().toUpperCase() !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        message: "Product not found.",
      });
    }

    const [imagesResult, variantsResult, certificatesResult, priceTiersResult, reviewsResult] =
      await Promise.all([
        pool.request().input("ProductId", sql.Int, productId).query(`
          SELECT
            id,
            url,
            is_main
          FROM product_images
          WHERE product_id = @ProductId
          ORDER BY
            CASE WHEN is_main = 1 THEN 0 ELSE 1 END,
            id ASC
        `),
        pool.request().input("ProductId", sql.Int, productId).query(`
          SELECT
            pv.id,
            pv.sku,
            pv.size,
            pv.weight_modifier,
            stock.quantity,
            stock.warehouse_location
          FROM product_variants pv
          LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
          WHERE pv.product_id = @ProductId
          ORDER BY pv.id ASC
        `),
        pool.request().input("ProductId", sql.Int, productId).query(`
          SELECT
            id,
            cert_code,
            image_url,
            issued_by,
            is_verified,
            verified_at
          FROM product_certificates
          WHERE product_id = @ProductId
          ORDER BY id ASC
        `),
        pool.request().input("ProductId", sql.Int, productId).query(`
          SELECT
            id,
            min_quantity,
            max_quantity,
            tier_price,
            markup_rate
          FROM product_price_tiers
          WHERE product_id = @ProductId
          ORDER BY min_quantity ASC, id ASC
        `),
        pool.request().input("ProductId", sql.Int, productId).query(`
          SELECT
            r.id,
            r.user_id,
            r.parent_id,
            r.rating_star,
            r.comment,
            r.like_count,
            r.created_at,
            u.username,
            profile.full_name
          FROM reviews r
          INNER JOIN users u ON u.id = r.user_id
          LEFT JOIN user_profiles profile ON profile.user_id = u.id
          WHERE r.product_id = @ProductId
            AND ISNULL(r.is_approved, 0) = 1
          ORDER BY r.created_at DESC, r.id DESC
        `),
      ]);

    const defaultSalePrice = computeSalePrice({
      baseSellPrice: product.base_sell_price,
      baseWeight: product.base_weight,
      laborCost: product.labor_cost,
      stoneCost: product.stone_cost,
      markupRate: product.markup_rate,
    });
    const salePrice = defaultSalePrice;
    const priceTiers = priceTiersResult.recordset.map((item) =>
      mapPriceTier(item, {
        baseSellPrice: product.base_sell_price,
        baseWeight: product.base_weight,
        laborCost: product.labor_cost,
        stoneCost: product.stone_cost,
      })
    );
    const topLevelReviews = reviewsResult.recordset.filter(
      (item) => item.parent_id === null
    );
    const averageRating =
      topLevelReviews.length > 0
        ? topLevelReviews.reduce(
            (total, item) => total + Number(item.rating_star || 0),
            0
          ) / topLevelReviews.length
        : 0;
    const reviewItemsByParent = reviewsResult.recordset.reduce((acc, item) => {
      const parentKey = item.parent_id === null ? "root" : String(item.parent_id);
      if (!acc[parentKey]) {
        acc[parentKey] = [];
      }
      acc[parentKey].push(item);
      return acc;
    }, {});
    const mapReviewItem = (item) => ({
      id: item.id,
      userId: Number(item.user_id || 0),
      parentId: item.parent_id === null ? null : Number(item.parent_id),
      rating: Number(item.rating_star || 0),
      comment: item.comment || "Khach hang danh gia tot ve san pham nay.",
      likeCount: Number(item.like_count || 0),
      createdAt: item.created_at,
      createdAtLabel: formatDateTime(item.created_at),
      author:
        item.full_name ||
        item.username ||
        "Khach hang JewelryBook",
      replies: (reviewItemsByParent[String(item.id)] || []).map(mapReviewItem),
    });

    return res.status(200).json({
      success: true,
      product: {
        id: product.id,
        name: product.name,
        description: String(product.description || "").trim(),
        status: product.status,
        badge: buildBadge(product.status),
        category: {
          id: product.category_id,
          name: product.category_name || "Trang suc",
          parentId: product.parent_category_id,
          parentName: product.parent_category_name || null,
        },
        material: {
          type: product.material_type,
          label: normalizeLabel(product.material_type),
          baseWeight: Number(product.base_weight || 0),
        },
        pricing: {
          salePrice,
          formattedSalePrice: formatCurrency(salePrice),
          defaultSalePrice,
          formattedDefaultSalePrice: formatCurrency(defaultSalePrice),
          hasTierPricing: priceTiers.length > 0,
          priceTiers,
          baseSellPrice: Number(product.base_sell_price || 0),
          formattedBaseSellPrice: formatCurrency(product.base_sell_price || 0),
          laborCost: Number(product.labor_cost || 0),
          formattedLaborCost: formatCurrency(product.labor_cost || 0),
          stoneCost: Number(product.stone_cost || 0),
          formattedStoneCost: formatCurrency(product.stone_cost || 0),
          markupRate: Number(product.markup_rate || 0),
          latestRateRecordedAt: product.latest_rate_recorded_at || null,
          latestRateRecordedLabel: formatDateTime(product.latest_rate_recorded_at),
        },
        createdAt: product.created_at,
        createdAtLabel: formatDateTime(product.created_at),
        images:
          imagesResult.recordset.map((item) => ({
            id: item.id,
            url: item.url,
            isMain: Boolean(item.is_main),
          })) || [],
        variants: variantsResult.recordset.map((item) => ({
          id: item.id,
          sku: item.sku,
          size: item.size || "Chuan",
          weightModifier: Number(item.weight_modifier || 0),
          quantity: Number(item.quantity || 0),
          warehouseLocation: item.warehouse_location || "Kho trung tam",
        })),
        certificates: certificatesResult.recordset.map((item) => ({
          id: item.id,
          certCode: item.cert_code,
          imageUrl: item.image_url,
          issuedBy: item.issued_by || "Don vi kiem dinh",
          isVerified: Boolean(item.is_verified),
          verifiedAt: item.verified_at || null,
          verifiedAtLabel: formatDateTime(item.verified_at),
        })),
        reviews: {
          averageRating: Number(averageRating.toFixed(1)),
          total: topLevelReviews.length,
          items: (reviewItemsByParent.root || []).map(mapReviewItem),
        },
        summary: {
          variantCount: variantsResult.recordset.length,
          inStockQuantity: variantsResult.recordset.reduce(
            (total, item) => total + Number(item.quantity || 0),
            0
          ),
          certificateCount: certificatesResult.recordset.length,
        },
      },
    });
  } catch (error) {
    console.error("Get product detail error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getClientProducts,
  getFeaturedProducts,
  getProductDetail,
};
