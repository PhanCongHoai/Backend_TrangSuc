const { poolPromise, sql } = require("../../config/db");
const {
  computeSalePrice,
  formatCurrency,
  normalizeLabel,
  resolveCompareMaxItems,
} = require("./shared");

// Trả về cấu hình số lượng sản phẩm bắt buộc cho tính năng so sánh.
const getCompareConfig = async (req, res) => {
  const maxItems = resolveCompareMaxItems();

  return res.status(200).json({
    success: true,
    config: {
      maxItems,
      requiredItems: maxItems,
      mode: "exact",
    },
  });
};

// Lấy dữ liệu xem trước cho màn hình so sánh sản phẩm.
const previewCompareProducts = async (req, res) => {
  try {
    const maxItems = resolveCompareMaxItems();
    const inputIds = Array.isArray(req.body?.productIds) ? req.body.productIds : [];
    const normalizedIds = [...new Set(inputIds.map((item) => Number(item)).filter((item) => item > 0))];

    if (normalizedIds.length !== maxItems) {
      return res.status(400).json({
        success: false,
        message: `Compare requires exactly ${maxItems} products.`,
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ProductId1", sql.Int, normalizedIds[0])
      .input("ProductId2", sql.Int, normalizedIds[1])
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
          c.name AS category_name,
          parent.name AS parent_category_name,
          img.url AS image_url,
          pc.labor_cost,
          pc.stone_cost,
          pc.markup_rate,
          rate.base_sell_price,
          inventory.total_quantity
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        LEFT JOIN product_categories parent ON parent.id = c.parent_id
        LEFT JOIN primary_images img ON img.product_id = p.id AND img.rn = 1
        LEFT JOIN product_pricing_configs pc ON pc.product_id = p.id
        LEFT JOIN latest_rates rate
          ON rate.material_type = p.material_type
          AND rate.rn = 1
        LEFT JOIN inventory_summary inventory ON inventory.product_id = p.id
        WHERE p.id IN (@ProductId1, @ProductId2)
          AND UPPER(ISNULL(p.status, '')) = 'ACTIVE'
      `);

    const productsById = new Map(
      result.recordset.map((item) => {
        const salePrice = computeSalePrice({
          baseSellPrice: item.base_sell_price,
          baseWeight: item.base_weight,
          laborCost: item.labor_cost,
          stoneCost: item.stone_cost,
          markupRate: item.markup_rate,
        });

        return [
          Number(item.id),
          {
            id: Number(item.id),
            name: item.name,
            description: String(item.description || "").trim(),
            image:
              item.image_url ||
              "https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQ1xp79XGKoIg-gZeZiRg2G7mpp2A6kH-AWow&s",
            category: item.category_name || item.parent_category_name || "Trang suc",
            materialType: item.material_type || "",
            materialLabel: normalizeLabel(item.material_type),
            baseWeight: Number(item.base_weight || 0),
            stockQuantity: Number(item.total_quantity || 0),
            salePrice,
            formattedSalePrice: formatCurrency(salePrice),
          },
        ];
      })
    );

    const comparedProducts = normalizedIds
      .map((productId) => productsById.get(productId))
      .filter(Boolean);

    if (comparedProducts.length !== maxItems) {
      return res.status(404).json({
        success: false,
        message: "Some products are unavailable for comparison.",
      });
    }

    return res.status(200).json({
      success: true,
      config: {
        maxItems,
        requiredItems: maxItems,
        mode: "exact",
      },
      comparedProducts,
    });
  } catch (error) {
    console.error("Preview compare products error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Tạo đánh giá hoặc trả lời đánh giá cho một sản phẩm.
const createProductReview = async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const userId = Number(req.user?.id || req.user?.sub);
    const parentId =
      req.body?.parentId === null || req.body?.parentId === undefined || req.body?.parentId === ""
        ? null
        : Number(req.body.parentId);
    const normalizedRating =
      parentId === null ? Number(req.body?.rating) : null;
    const normalizedComment = String(req.body?.comment || "").trim();

    if (Number.isNaN(productId) || productId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Product id is invalid.",
      });
    }

    if (
      parentId === null &&
      (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5)
    ) {
      return res.status(400).json({
        success: false,
        message: "So sao danh gia phai nam trong khoang 1 den 5.",
      });
    }

    if (parentId !== null && (Number.isNaN(parentId) || parentId <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Binh luan cha khong hop le.",
      });
    }

    if (normalizedComment.length < 3) {
      return res.status(400).json({
        success: false,
        message: "Noi dung danh gia can it nhat 3 ky tu.",
      });
    }

    const pool = await poolPromise;
    const productResult = await pool.request().input("ProductId", sql.Int, productId).query(`
      SELECT TOP 1 id, status
      FROM products
      WHERE id = @ProductId
    `);

    const product = productResult.recordset[0];

    if (!product || String(product.status || "").trim().toUpperCase() !== "ACTIVE") {
      return res.status(404).json({
        success: false,
        message: "San pham khong ton tai hoac khong con hien thi.",
      });
    }

    if (parentId !== null) {
      const parentReviewResult = await pool
        .request()
        .input("ProductId", sql.Int, productId)
        .input("ParentId", sql.Int, parentId)
        .query(`
          SELECT TOP 1 id
          FROM reviews
          WHERE id = @ParentId
            AND product_id = @ProductId
            AND ISNULL(is_approved, 0) = 1
        `);

      if (!parentReviewResult.recordset.length) {
        return res.status(404).json({
          success: false,
          message: "Khong tim thay binh luan de tra loi.",
        });
      }
    }

    await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .input("UserId", sql.Int, userId)
      .input("ParentId", sql.Int, parentId)
      .input("RatingStar", sql.Int, normalizedRating)
      .input("Comment", sql.NVarChar(sql.MAX), normalizedComment)
      .query(`
        INSERT INTO reviews (
          product_id,
          user_id,
          parent_id,
          rating_star,
          comment,
          is_approved
        )
        VALUES (
          @ProductId,
          @UserId,
          @ParentId,
          @RatingStar,
          @Comment,
          1
        )
      `);

    return res.status(200).json({
      success: true,
      message: parentId === null
        ? "Danh gia da duoc gui thanh cong."
        : "Tra loi binh luan da duoc gui thanh cong.",
    });
  } catch (error) {
    console.error("Create product review error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Xóa đánh giá hoặc bình luận do chính người dùng hiện tại tạo ra.
const deleteOwnProductReview = async (req, res) => {
  try {
    const productId = Number(req.params.id);
    const reviewId = Number(req.params.reviewId);
    const userId = Number(req.user?.id || req.user?.sub);

    if (
      Number.isNaN(productId) ||
      productId <= 0 ||
      Number.isNaN(reviewId) ||
      reviewId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Product id hoac review id khong hop le.",
      });
    }

    const pool = await poolPromise;
    const deleteResult = await pool
      .request()
      .input("ProductId", sql.Int, productId)
      .input("ReviewId", sql.Int, reviewId)
      .input("UserId", sql.Int, userId)
      .query(`
        DELETE FROM reviews
        OUTPUT DELETED.id
        WHERE id = @ReviewId
          AND product_id = @ProductId
          AND user_id = @UserId
      `);

    if (!deleteResult.recordset.length) {
      return res.status(404).json({
        success: false,
        message: "Khong tim thay binh luan cua ban de xoa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Da xoa binh luan cua ban.",
    });
  } catch (error) {
    console.error("Delete own product review error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  createProductReview,
  deleteOwnProductReview,
  getCompareConfig,
  previewCompareProducts,
};
