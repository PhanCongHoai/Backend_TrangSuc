const { poolPromise, sql } = require("../../config/db");
const {
  createOrder: createGhnOrder,
  getPublicConfig,
} = require("../../services/ghn.service");
const {
  buildOrderTitle,
  buildStoredOrderGhnItems,
  parseJsonSafe,
  toPositiveIntegerOrNull,
} = require("./shared");
const { notifyOrderSubscribers } = require("./realtime");

// Tự động tạo đơn GHN cho đơn prepaid đã thanh toán nếu chưa có vận đơn.
const ensureGhnShippingForPaidOrder = async (orderId) => {
  const normalizedOrderId = Number(orderId || 0);

  if (!normalizedOrderId) {
    return {
      created: false,
      skipped: true,
      message: "Không có mã đơn hàng để tạo GHN.",
    };
  }

  const ghnConfig = getPublicConfig();

  if (!ghnConfig.enabled) {
    return {
      created: false,
      skipped: true,
      message: "GHN chưa được cấu hình đầy đủ.",
    };
  }

  const pool = await poolPromise;
  const orderResult = await pool
    .request()
    .input("OrderId", sql.Int, normalizedOrderId)
    .query(`
      SELECT TOP 1
        o.id,
        o.user_id,
        o.status,
        o.payment_status,
        o.total_amount,
        o.shipping_code,
        o.shipping_address,
        payment.method AS payment_method,
        payment.payment_log,
        ship.id AS shipping_order_id,
        ship.tracking_code
      FROM orders o
      OUTER APPLY (
        SELECT TOP 1 method, payment_log
        FROM order_payments
        WHERE order_id = o.id
        ORDER BY created_at DESC, id DESC
      ) payment
      LEFT JOIN shipping_orders ship ON ship.order_id = o.id
      WHERE o.id = @OrderId
      ORDER BY ship.id DESC
    `);

  const order = orderResult.recordset[0];

  if (!order) {
    return {
      created: false,
      skipped: true,
      message: "Không tìm thấy đơn hàng để tạo GHN.",
    };
  }

  if (String(order.payment_status || "").trim().toUpperCase() !== "PAID") {
    return {
      created: false,
      skipped: true,
      message: "Đơn hàng chưa thanh toán xong nên chưa tạo GHN.",
    };
  }

  if (String(order.payment_method || "").trim().toLowerCase() !== "prepaid") {
    return {
      created: false,
      skipped: true,
      message: "Chỉ tự động tạo GHN cho đơn thanh toán trước.",
    };
  }

  if (String(order.shipping_code || "").trim() || String(order.tracking_code || "").trim()) {
    return {
      created: false,
      skipped: true,
      orderCode: String(order.shipping_code || order.tracking_code || "").trim(),
      message: "Đơn hàng đã có vận đơn GHN trước đó.",
    };
  }

  const shippingAddress = parseJsonSafe(order.shipping_address, {}) || {};
  const districtId = Number(
    shippingAddress?.districtCode || shippingAddress?.toDistrictId || shippingAddress?.district_id || 0,
  );
  const wardCode = String(
    shippingAddress?.wardCode || shippingAddress?.toWardCode || shippingAddress?.ward_code || "",
  ).trim();
  const recipientName = String(shippingAddress?.fullName || "").trim();
  const recipientPhone = String(shippingAddress?.phone || "").trim();
  const recipientAddress = String(
    shippingAddress?.streetAddress || shippingAddress?.fullAddress || "",
  ).trim();
  const parcelWeight = toPositiveIntegerOrNull(
    shippingAddress?.parcel?.weight || shippingAddress?.parcelWeight,
  );
  const parcelLength = toPositiveIntegerOrNull(
    shippingAddress?.parcel?.length || shippingAddress?.parcelLength,
  );
  const parcelWidth = toPositiveIntegerOrNull(
    shippingAddress?.parcel?.width || shippingAddress?.parcelWidth,
  );
  const parcelHeight = toPositiveIntegerOrNull(
    shippingAddress?.parcel?.height || shippingAddress?.parcelHeight,
  );

  if (!recipientName || !recipientPhone || !recipientAddress || !districtId || !wardCode) {
    return {
      created: false,
      skipped: true,
      message:
        "Đơn hàng thiếu thông tin địa chỉ GHN (to_name, to_phone, to_address, to_district_id, to_ward_code).",
    };
  }

  const itemsResult = await pool
    .request()
    .input("OrderId", sql.Int, normalizedOrderId)
    .query(`
      SELECT
        oi.variant_id,
        oi.quantity,
        oi.unit_price,
        pv.product_id,
        pv.sku,
        p.name AS product_name
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id = @OrderId
      ORDER BY oi.id ASC
    `);

  const ghnItems = buildStoredOrderGhnItems(itemsResult.recordset);

  if (!ghnItems.length) {
    return {
      created: false,
      skipped: true,
      message: "Đơn hàng không có sản phẩm để tạo GHN.",
    };
  }

  const ghnOrder = await createGhnOrder({
    name: buildOrderTitle(ghnItems),
    payment_type_id: 1,
    required_note: "KHONGCHOXEMHANG",
    note: String(shippingAddress?.note || "").trim(),
    to_name: recipientName,
    to_phone: recipientPhone,
    to_address: recipientAddress,
    to_district_id: districtId,
    to_ward_code: wardCode,
    weight: parcelWeight || undefined,
    length: parcelLength || undefined,
    width: parcelWidth || undefined,
    height: parcelHeight || undefined,
    insurance_value: Math.max(0, Number(order.total_amount || 0)),
    cod_amount: 0,
    items: ghnItems,
  });

  if (!String(ghnOrder?.order_code || "").trim()) {
    return {
      created: false,
      skipped: true,
      message: "GHN không trả về mã vận đơn.",
    };
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    await new sql.Request(transaction)
      .input("OrderId", sql.Int, normalizedOrderId)
      .input("ShippingCode", sql.VarChar(100), String(ghnOrder.order_code).trim())
      .query(`
        UPDATE orders
        SET
          shipping_code = @ShippingCode,
          status = CASE
            WHEN UPPER(ISNULL(status, '')) = 'PENDING' THEN 'PROCESSING'
            ELSE status
          END
        WHERE id = @OrderId
      `);

    await new sql.Request(transaction)
      .input("OrderId", sql.Int, normalizedOrderId)
      .input("CarrierName", sql.VarChar(100), "GHN")
      .input("TrackingCode", sql.VarChar(100), String(ghnOrder.order_code).trim())
      .input("Status", sql.VarChar(50), "READY_TO_PICK")
      .query(`
        INSERT INTO shipping_orders (order_id, carrier_name, tracking_code, status, updated_at)
        VALUES (@OrderId, @CarrierName, @TrackingCode, @Status, GETDATE())
      `);

    await transaction.commit();
    notifyOrderSubscribers({
      orderId: normalizedOrderId,
      userId: Number(order.user_id || 0),
      reason: "shipping-created",
      shippingCode: String(ghnOrder.order_code).trim(),
      paymentStatus: String(order.payment_status || "").trim().toUpperCase(),
    });
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return {
    created: true,
    skipped: false,
    orderCode: String(ghnOrder.order_code).trim(),
    message: "Đã tự động tạo đơn GHN sau khi thanh toán.",
  };
};

// Bọc lỗi cho luồng tự tạo GHN để không làm gãy luồng gọi phía trên.
const ensureGhnShippingForPaidOrderSafe = async (orderId) => {
  try {
    return await ensureGhnShippingForPaidOrder(orderId);
  } catch (error) {
    console.error("Auto create GHN after SePay payment error:", error);
    return {
      created: false,
      skipped: true,
      message: error?.message || "Không thể tự động tạo GHN sau khi thanh toán.",
    };
  }
};

module.exports = {
  ensureGhnShippingForPaidOrder,
  ensureGhnShippingForPaidOrderSafe,
};
