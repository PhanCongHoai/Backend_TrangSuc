const { poolPromise, sql } = require("../config/db");
const { computeSalePrice, mapPriceTier } = require("./products/shared");

// Hàm phụ trợ giải quyết giá bán lẻ/sỉ theo tiers
const resolveTierPrice = (priceTiers, quantity, fallbackPrice = 0) => {
  const normalizedQuantity = Math.max(1, Math.floor(Number(quantity || 1)));
  const matchedTier = priceTiers.find(
    (tier) =>
      normalizedQuantity >= tier.minQuantity &&
      (tier.maxQuantity === null || normalizedQuantity <= tier.maxQuantity)
  );
  return Number(matchedTier?.price ?? fallbackPrice ?? 0);
};

// Hàm lấy hoặc tạo giỏ hàng active cho người dùng
const getOrInitializeCart = async (pool, userId) => {
  let cartResult = await pool
    .request()
    .input("UserId", sql.Int, userId)
    .query(`SELECT id FROM carts WHERE user_id = @UserId AND status = 'active'`);
  
  if (cartResult.recordset.length === 0) {
    cartResult = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        INSERT INTO carts (user_id, status, created_at, updated_at)
        OUTPUT INSERTED.id
        VALUES (@UserId, 'active', GETDATE(), GETDATE())
      `);
  }
  return cartResult.recordset[0].id;
};

// Hàm lấy chi tiết các item trong giỏ hàng kèm tính toán giá
const fetchCartDetails = async (pool, cartId) => {
  const itemsResult = await pool
    .request()
    .input("CartId", sql.Int, cartId)
    .query(`
      SELECT 
        ci.id AS cart_item_id,
        ci.variant_id,
        ci.quantity,
        ci.unit_price,
        p.id AS product_id,
        p.name AS product_name,
        p.material_type,
        p.base_weight,
        pv.sku,
        pv.size,
        pv.weight_modifier,
        pc.labor_cost,
        pc.stone_cost,
        pc.markup_rate,
        stock.quantity AS stock_quantity,
        img.url AS image_url
      FROM cart_items ci
      INNER JOIN product_variants pv ON pv.id = ci.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      LEFT JOIN product_pricing_configs pc ON pc.product_id = p.id
      LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
      LEFT JOIN (
        SELECT product_id, url, 
               ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY CASE WHEN is_main = 1 THEN 0 ELSE 1 END, id ASC) as rn
        FROM product_images
      ) img ON img.product_id = p.id AND img.rn = 1
      WHERE ci.cart_id = @CartId
    `);

  const dbItems = itemsResult.recordset;
  if (dbItems.length === 0) {
    return [];
  }

  // Tải tỷ giá vàng mới nhất
  const rateResult = await pool.request().query(`
    WITH latest_rates AS (
      SELECT
        material_type,
        base_sell_price,
        ROW_NUMBER() OVER (PARTITION BY material_type ORDER BY id DESC) AS rn
      FROM gold_rate_history
    )
    SELECT material_type, base_sell_price
    FROM latest_rates
    WHERE rn = 1
  `);
  const rates = rateResult.recordset.reduce((acc, r) => {
    acc[r.material_type] = Number(r.base_sell_price || 0);
    return acc;
  }, {});

  // Tải price tiers
  const productIds = [...new Set(dbItems.map(item => item.product_id))];
  let priceTiersMap = {};
  if (productIds.length > 0) {
    const tiersResult = await pool.request().query(`
      SELECT id, product_id, min_quantity, max_quantity, tier_price, markup_rate
      FROM product_price_tiers
      WHERE product_id IN (${productIds.join(",")})
      ORDER BY min_quantity ASC
    `);
    
    priceTiersMap = tiersResult.recordset.reduce((acc, tier) => {
      if (!acc[tier.product_id]) {
        acc[tier.product_id] = [];
      }
      acc[tier.product_id].push(tier);
      return acc;
    }, {});
  }

  const formattedItems = [];
  for (const item of dbItems) {
    const goldRate = rates[item.material_type] || 0;
    const itemWeight = Number(item.base_weight || 0) + Number(item.weight_modifier || 0);
    
    const basePrice = computeSalePrice({
      baseSellPrice: goldRate,
      baseWeight: itemWeight,
      laborCost: item.labor_cost,
      stoneCost: item.stone_cost,
      markupRate: item.markup_rate,
    });

    const pricingContext = {
      baseSellPrice: goldRate,
      baseWeight: itemWeight,
      laborCost: item.labor_cost,
      stoneCost: item.stone_cost,
    };

    const rawTiers = priceTiersMap[item.product_id] || [];
    const mappedTiers = rawTiers.map(tier => mapPriceTier(tier, pricingContext));
    const currentPrice = resolveTierPrice(mappedTiers, item.quantity, basePrice);

    // Cập nhật lại unit_price trong DB nếu nó khác với giá tính toán hiện tại (đổi tỷ giá vàng, ...)
    if (Number(item.unit_price) !== currentPrice) {
      await pool.request()
        .input("ItemId", sql.Int, item.cart_item_id)
        .input("UnitPrice", sql.Decimal(18, 2), currentPrice)
        .query(`UPDATE cart_items SET unit_price = @UnitPrice, updated_at = GETDATE() WHERE id = @ItemId`);
    }

    formattedItems.push({
      id: item.cart_item_id,
      productId: item.product_id,
      variantId: item.variant_id,
      name: item.product_name,
      image: item.image_url || "",
      size: item.size || "Chuan",
      stockLabel: item.stock_quantity <= 0 ? "Hết hàng" : (item.stock_quantity < 5 ? `Chỉ còn ${item.stock_quantity} sp` : "Còn hàng"),
      quantity: item.quantity,
      maxQuantity: item.stock_quantity || 0,
      price: currentPrice,
      basePrice,
      baseSellPrice: goldRate,
      laborCost: Number(item.labor_cost || 0),
      stoneCost: Number(item.stone_cost || 0),
      baseWeight: Number(item.base_weight || 0),
      weightModifier: Number(item.weight_modifier || 0),
      shippingWeight: itemWeight,
      priceTiers: mappedTiers,
    });
  }

  return formattedItems;
};

// GET /api/cart - Lấy giỏ hàng hiện tại
const getCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const pool = await poolPromise;
    const cartId = await getOrInitializeCart(pool, userId);
    const items = await fetchCartDetails(pool, cartId);

    return res.status(200).json({
      success: true,
      cart: {
        id: cartId,
        items,
      },
    });
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// POST /api/cart - Thêm sản phẩm vào giỏ hàng
const addToCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { variantId, quantity } = req.body;

    const targetVariantId = Number(variantId);
    const targetQuantity = Math.max(1, Math.floor(Number(quantity || 1)));

    if (!targetVariantId || Number.isNaN(targetVariantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid variantId.",
      });
    }

    const pool = await poolPromise;

    // 1. Kiểm tra biến thể và số lượng tồn kho khả dụng
    const stockResult = await pool
      .request()
      .input("VariantId", sql.Int, targetVariantId)
      .query(`
        SELECT pv.id, stock.quantity AS stock_quantity
        FROM product_variants pv
        LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
        WHERE pv.id = @VariantId
      `);

    if (stockResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product variant not found.",
      });
    }

    const stockQty = stockResult.recordset[0].stock_quantity || 0;
    if (stockQty <= 0) {
      return res.status(400).json({
        success: false,
        message: "Sản phẩm đã hết hàng.",
      });
    }

    const cartId = await getOrInitializeCart(pool, userId);

    // 2. Kiểm tra xem item đã có trong giỏ hàng chưa
    const existResult = await pool
      .request()
      .input("CartId", sql.Int, cartId)
      .input("VariantId", sql.Int, targetVariantId)
      .query(`SELECT id, quantity FROM cart_items WHERE cart_id = @CartId AND variant_id = @VariantId`);

    let finalQuantity = targetQuantity;

    if (existResult.recordset.length > 0) {
      const existingItem = existResult.recordset[0];
      finalQuantity = Math.min(existingItem.quantity + targetQuantity, stockQty);

      await pool
        .request()
        .input("ItemId", sql.Int, existingItem.id)
        .input("Quantity", sql.Int, finalQuantity)
        .query(`UPDATE cart_items SET quantity = @Quantity, updated_at = GETDATE() WHERE id = @ItemId`);
    } else {
      finalQuantity = Math.min(targetQuantity, stockQty);
      await pool
        .request()
        .input("CartId", sql.Int, cartId)
        .input("VariantId", sql.Int, targetVariantId)
        .input("Quantity", sql.Int, finalQuantity)
        .query(`
          INSERT INTO cart_items (cart_id, variant_id, quantity, unit_price, created_at, updated_at)
          VALUES (@CartId, @VariantId, @Quantity, 0, GETDATE(), GETDATE())
        `);
    }

    // 3. Lấy lại chi tiết giỏ hàng sau khi cập nhật (fetchCartDetails sẽ tự động cập nhật unit_price)
    const items = await fetchCartDetails(pool, cartId);

    return res.status(200).json({
      success: true,
      message: "Đã thêm vào giỏ hàng.",
      cart: {
        id: cartId,
        items,
      },
    });
  } catch (error) {
    console.error("Add to cart error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// PUT /api/cart/items - Cập nhật số lượng
const updateCartQuantity = async (req, res) => {
  try {
    const userId = req.user.id;
    const { variantId, quantity } = req.body;

    const targetVariantId = Number(variantId);
    const targetQuantity = Math.floor(Number(quantity));

    if (!targetVariantId || Number.isNaN(targetVariantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid variantId.",
      });
    }

    const pool = await poolPromise;
    const cartId = await getOrInitializeCart(pool, userId);

    if (targetQuantity <= 0) {
      // Xóa khỏi giỏ hàng
      await pool
        .request()
        .input("CartId", sql.Int, cartId)
        .input("VariantId", sql.Int, targetVariantId)
        .query(`DELETE FROM cart_items WHERE cart_id = @CartId AND variant_id = @VariantId`);
    } else {
      // Kiểm tra tồn kho
      const stockResult = await pool
        .request()
        .input("VariantId", sql.Int, targetVariantId)
        .query(`
          SELECT pv.id, stock.quantity AS stock_quantity
          FROM product_variants pv
          LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
          WHERE pv.id = @VariantId
        `);

      if (stockResult.recordset.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Product variant not found.",
        });
      }

      const stockQty = stockResult.recordset[0].stock_quantity || 0;
      const finalQuantity = Math.min(targetQuantity, stockQty);

      await pool
        .request()
        .input("CartId", sql.Int, cartId)
        .input("VariantId", sql.Int, targetVariantId)
        .input("Quantity", sql.Int, finalQuantity)
        .query(`
          UPDATE cart_items 
          SET quantity = @Quantity, updated_at = GETDATE() 
          WHERE cart_id = @CartId AND variant_id = @VariantId
        `);
    }

    const items = await fetchCartDetails(pool, cartId);

    return res.status(200).json({
      success: true,
      message: "Cập nhật số lượng thành công.",
      cart: {
        id: cartId,
        items,
      },
    });
  } catch (error) {
    console.error("Update cart quantity error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// DELETE /api/cart/items/:variantId - Xóa item khỏi giỏ hàng
const removeCartItem = async (req, res) => {
  try {
    const userId = req.user.id;
    const targetVariantId = Number(req.params.variantId);

    if (!targetVariantId || Number.isNaN(targetVariantId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid variantId.",
      });
    }

    const pool = await poolPromise;
    const cartId = await getOrInitializeCart(pool, userId);

    await pool
      .request()
      .input("CartId", sql.Int, cartId)
      .input("VariantId", sql.Int, targetVariantId)
      .query(`DELETE FROM cart_items WHERE cart_id = @CartId AND variant_id = @VariantId`);

    const items = await fetchCartDetails(pool, cartId);

    return res.status(200).json({
      success: true,
      message: "Đã xóa sản phẩm khỏi giỏ hàng.",
      cart: {
        id: cartId,
        items,
      },
    });
  } catch (error) {
    console.error("Remove cart item error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// DELETE /api/cart - Xóa sạch giỏ hàng
const clearCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const pool = await poolPromise;
    const cartId = await getOrInitializeCart(pool, userId);

    await pool
      .request()
      .input("CartId", sql.Int, cartId)
      .query(`DELETE FROM cart_items WHERE cart_id = @CartId`);

    return res.status(200).json({
      success: true,
      message: "Đã xóa sạch giỏ hàng.",
      cart: {
        id: cartId,
        items: [],
      },
    });
  } catch (error) {
    console.error("Clear cart error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// POST /api/cart/sync - Đồng bộ giỏ hàng từ localStorage (dành cho login)
const syncCart = async (req, res) => {
  try {
    const userId = req.user.id;
    const { items: clientItems } = req.body;

    if (!Array.isArray(clientItems) || clientItems.length === 0) {
      return res.status(200).json({
        success: true,
        message: "Không có sản phẩm nào cần đồng bộ.",
      });
    }

    const pool = await poolPromise;
    const cartId = await getOrInitializeCart(pool, userId);

    for (const item of clientItems) {
      const variantId = Number(item.variantId);
      const quantity = Math.max(1, Math.floor(Number(item.quantity || 1)));

      if (!variantId || Number.isNaN(variantId)) continue;

      // Kiểm tra tồn kho
      const stockResult = await pool
        .request()
        .input("VariantId", sql.Int, variantId)
        .query(`
          SELECT pv.id, stock.quantity AS stock_quantity
          FROM product_variants pv
          LEFT JOIN inventory_stocks stock ON stock.variant_id = pv.id
          WHERE pv.id = @VariantId
        `);

      if (stockResult.recordset.length === 0) continue;

      const stockQty = stockResult.recordset[0].stock_quantity || 0;
      if (stockQty <= 0) continue;

      // Kiểm tra xem đã có trong giỏ hàng chưa
      const existResult = await pool
        .request()
        .input("CartId", sql.Int, cartId)
        .input("VariantId", sql.Int, variantId)
        .query(`SELECT id, quantity FROM cart_items WHERE cart_id = @CartId AND variant_id = @VariantId`);

      if (existResult.recordset.length > 0) {
        const existingItem = existResult.recordset[0];
        const finalQuantity = Math.min(existingItem.quantity + quantity, stockQty);

        await pool
          .request()
          .input("ItemId", sql.Int, existingItem.id)
          .input("Quantity", sql.Int, finalQuantity)
          .query(`UPDATE cart_items SET quantity = @Quantity, updated_at = GETDATE() WHERE id = @ItemId`);
      } else {
        const finalQuantity = Math.min(quantity, stockQty);
        await pool
          .request()
          .input("CartId", sql.Int, cartId)
          .input("VariantId", sql.Int, variantId)
          .input("Quantity", sql.Int, finalQuantity)
          .query(`
            INSERT INTO cart_items (cart_id, variant_id, quantity, unit_price, created_at, updated_at)
            VALUES (@CartId, @VariantId, @Quantity, 0, GETDATE(), GETDATE())
          `);
      }
    }

    const items = await fetchCartDetails(pool, cartId);

    return res.status(200).json({
      success: true,
      message: "Đồng bộ giỏ hàng thành công.",
      cart: {
        id: cartId,
        items,
      },
    });
  } catch (error) {
    console.error("Sync cart error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartQuantity,
  removeCartItem,
  clearCart,
  syncCart,
};
