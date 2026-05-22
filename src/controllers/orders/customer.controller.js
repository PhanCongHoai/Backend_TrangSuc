const { poolPromise, sql } = require("../../config/db");
const {
  createOrder: createGhnOrder,
  getPublicConfig,
} = require("../../services/ghn.service");
const {
  getSepaySharedVaConfig,
} = require("../../services/sepay.service");
const {
  buildInternalOrderCode,
  buildOrderTitle,
  buildPaymentReference,
  buildSepayQrUrl,
  buildSharedVirtualAccountPayment,
  mapOrderStatus,
  mapPaymentMethod,
  normalizeMoney,
  normalizeOrderItems,
  parseJsonSafe,
  toPositiveIntegerOrNull,
} = require("./shared");
const { notifyOrderSubscribers } = require("./realtime");

// Tạo đơn hàng cho khách, đồng thời chuẩn bị thanh toán SePay hoặc tạo GHN nếu cần.
const createCustomerOrder = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const items = normalizeOrderItems(req.body?.items);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!items.length) {
      return res.status(400).json({
        success: false,
        message: "Đơn hàng phải có ít nhất một sản phẩm.",
      });
    }

    const subtotal = Math.max(0, Number(req.body?.subtotal || 0));
    const discountAmount = Math.max(0, Number(req.body?.discount_amount || 0));
    const shippingFee = Math.max(0, Number(req.body?.shipping_fee || 0));
    const totalAmount = Math.max(
      0,
      Number(req.body?.total_amount || subtotal + shippingFee - discountAmount),
    );
    const paymentMethod = String(req.body?.payment_method || "cod")
      .trim()
      .toLowerCase();
    const isPrepaid = paymentMethod === "prepaid";
    const paymentLabel = mapPaymentMethod(paymentMethod);
    const orderTitle = buildOrderTitle(items, req.body?.name);
    const parcelWeight = toPositiveIntegerOrNull(req.body?.weight);
    const parcelLength = toPositiveIntegerOrNull(req.body?.length);
    const parcelWidth = toPositiveIntegerOrNull(req.body?.width);
    const parcelHeight = toPositiveIntegerOrNull(req.body?.height);
    const shippingAddressPayload = {
      fullName: String(req.body?.to_name || "").trim(),
      phone: String(req.body?.to_phone || "").trim(),
      email: String(req.body?.email || "").trim(),
      streetAddress: String(req.body?.to_address || "").trim(),
      wardCode: String(req.body?.to_ward_code || "").trim(),
      districtCode: String(req.body?.to_district_id || "").trim(),
      wardName: String(req.body?.ward_name || "").trim(),
      districtName: String(req.body?.district_name || "").trim(),
      provinceName: String(req.body?.province_name || "").trim(),
      fullAddress: String(req.body?.full_address || "").trim(),
      note: String(req.body?.note || "").trim(),
      parcel: {
        weight: parcelWeight,
        length: parcelLength,
        width: parcelWidth,
        height: parcelHeight,
      },
    };

    if (
      !shippingAddressPayload.fullName ||
      !shippingAddressPayload.phone ||
      !shippingAddressPayload.streetAddress
    ) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin người nhận hoặc địa chỉ giao hàng.",
      });
    }

    if (!parcelWeight || !parcelLength || !parcelWidth || !parcelHeight) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin kiện hàng GHN: weight, length, width, height đều là bắt buộc.",
      });
    }

    const sharedVaConfig = getSepaySharedVaConfig();

    if (isPrepaid && !sharedVaConfig.enabled) {
      return res.status(400).json({
        success: false,
        message: "Thanh toán trước yêu cầu cấu hình VA SePay. Hãy bật SEPAY_VA_ENABLED=true.",
      });
    }

    if (isPrepaid && sharedVaConfig.missingFields.length) {
      return res.status(400).json({
        success: false,
        message: `Thiếu cấu hình SePay VA dùng chung: ${sharedVaConfig.missingFields.join(", ")}.`,
      });
    }

    let ghnOrder = null;
    const ghnConfig = getPublicConfig();

    if (ghnConfig.enabled && !isPrepaid) {
      ghnOrder = await createGhnOrder({
        ...req.body,
        name: orderTitle,
        items: (req.body?.items || []).map((item) => ({
          ...item,
          name: item?.name || orderTitle,
        })),
      });
    }

    const pool = await poolPromise;
    const transaction = new sql.Transaction(pool);
    await transaction.begin();

    try {
      const orderInsertResult = await new sql.Request(transaction)
        .input("UserId", sql.Int, userId)
        .input("SubTotal", sql.Decimal(15, 2), subtotal)
        .input(
          "PromotionCode",
          sql.VarChar(50),
          String(req.body?.promotion_code || "").trim() || null,
        )
        .input("DiscountAmount", sql.Decimal(15, 2), discountAmount)
        .input("TotalAmount", sql.Decimal(15, 2), totalAmount)
        .input("Status", sql.VarChar(50), ghnOrder ? "PROCESSING" : "PENDING")
        .input(
          "PaymentStatus",
          sql.VarChar(50),
          paymentMethod === "cod" ? "UNPAID" : "PENDING",
        )
        .input(
          "ShippingCode",
          sql.VarChar(100),
          String(ghnOrder?.order_code || "").trim() || null,
        )
        .input(
          "ShippingAddress",
          sql.NVarChar(sql.MAX),
          JSON.stringify(shippingAddressPayload),
        ).query(`
          INSERT INTO orders (
            user_id,
            sub_total,
            promotion_code,
            discount_amount,
            total_amount,
            status,
            payment_status,
            shipping_code,
            shipping_address
          )
          OUTPUT INSERTED.id, INSERTED.created_at
          VALUES (
            @UserId,
            @SubTotal,
            @PromotionCode,
            @DiscountAmount,
            @TotalAmount,
            @Status,
            @PaymentStatus,
            @ShippingCode,
            @ShippingAddress
          )
        `);

      const orderId = Number(orderInsertResult.recordset[0]?.id || 0);
      const createdAt =
        orderInsertResult.recordset[0]?.created_at || new Date().toISOString();
      const paymentReference =
        paymentMethod === "prepaid" ? buildPaymentReference(orderId) : null;
      const internalOrderCode = buildInternalOrderCode(orderId);
      const initialPaymentLog = {
        paymentLabel,
        shippingFee,
        paymentProvider: paymentMethod === "prepaid" ? "sepay" : null,
        paymentReference,
        internalOrderCode,
      };

      for (const item of items) {
        await new sql.Request(transaction)
          .input("OrderId", sql.Int, orderId)
          .input("VariantId", sql.Int, item.variantId)
          .input("Quantity", sql.Int, item.quantity)
          .input("UnitPrice", sql.Decimal(15, 2), item.unitPrice)
          .input(
            "TotalPrice",
            sql.Decimal(15, 2),
            item.unitPrice * item.quantity,
          ).query(`
            INSERT INTO order_items (order_id, variant_id, quantity, unit_price, total_price)
            VALUES (@OrderId, @VariantId, @Quantity, @UnitPrice, @TotalPrice)
          `);
      }

      const paymentInsertResult = await new sql.Request(transaction)
        .input("OrderId", sql.Int, orderId)
        .input("Method", sql.VarChar(50), paymentMethod)
        .input("Amount", sql.Decimal(15, 2), totalAmount)
        .input(
          "Status",
          sql.VarChar(50),
          paymentMethod === "cod" ? "UNPAID" : "PENDING",
        )
        .input(
          "PaymentLog",
          sql.NVarChar(sql.MAX),
          JSON.stringify(initialPaymentLog),
        ).query(`
          INSERT INTO order_payments (order_id, method, amount, status, payment_log)
          OUTPUT INSERTED.id
          VALUES (@OrderId, @Method, @Amount, @Status, @PaymentLog)
        `);
      const paymentId = Number(paymentInsertResult.recordset[0]?.id || 0);

      let paymentResponse = {
        method: paymentMethod,
        status: paymentMethod === "cod" ? "UNPAID" : "PENDING",
        amount: totalAmount,
        provider: null,
      };

      if (isPrepaid) {
        const nextPaymentLog = {
          ...initialPaymentLog,
          paymentMode: "virtual_account",
          virtualAccountNumber: sharedVaConfig.vaNumber || null,
          sepay: {
            mode: "virtual_account",
            allocation: "shared_static_va",
            isStatic: true,
            orderCode: paymentReference,
            vaNumber: sharedVaConfig.vaNumber || null,
            accountHolderName: sharedVaConfig.accountHolderName || null,
            bankCode: sharedVaConfig.bankCode || null,
            bankName: sharedVaConfig.bankName || null,
            amount: normalizeMoney(totalAmount),
            status: "Pending",
            expiredAt: null,
            qrCodeUrl: buildSepayQrUrl({
              accountNumber: sharedVaConfig.vaNumber,
              bankCode: sharedVaConfig.bankCode,
              amount: totalAmount,
              content: paymentReference,
              template: sharedVaConfig.qrTemplate,
            }),
          },
        };

        if (paymentId) {
          await new sql.Request(transaction)
            .input("PaymentId", sql.Int, paymentId)
            .input("PaymentLog", sql.NVarChar(sql.MAX), JSON.stringify(nextPaymentLog))
            .query(`
              UPDATE order_payments
              SET payment_log = @PaymentLog
              WHERE id = @PaymentId
            `);
        }

        paymentResponse = buildSharedVirtualAccountPayment({
          amount: totalAmount,
          paymentReference,
          sharedVaConfig,
        });
      }

      if (ghnOrder?.order_code) {
        await new sql.Request(transaction)
          .input("OrderId", sql.Int, orderId)
          .input("CarrierName", sql.VarChar(100), "GHN")
          .input("TrackingCode", sql.VarChar(100), ghnOrder.order_code)
          .input("Status", sql.VarChar(50), "READY_TO_PICK").query(`
            INSERT INTO shipping_orders (order_id, carrier_name, tracking_code, status, updated_at)
            VALUES (@OrderId, @CarrierName, @TrackingCode, @Status, GETDATE())
          `);
      }

      await transaction.commit();
      notifyOrderSubscribers({
        orderId,
        userId,
        reason: "created",
        status: ghnOrder?.order_code ? "PROCESSING" : "PENDING",
        paymentStatus: paymentMethod === "cod" ? "UNPAID" : "PENDING",
      });

      return res.status(201).json({
        success: true,
        data: {
          id: orderId,
          title: orderTitle,
          internalOrderCode,
          orderCode: ghnOrder?.order_code || null,
          status: ghnOrder?.order_code ? "Đã tạo đơn GHN" : "Đã ghi nhận",
          createdAt,
          payment: {
            ...paymentResponse,
          },
        },
      });
    } catch (dbError) {
      await transaction.rollback();
      throw dbError;
    }
  } catch (error) {
    console.error("Create customer order error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Server error.",
      details: error.details || null,
    });
  }
};

// Lấy lịch sử đơn hàng của người dùng hiện tại kèm thông tin thanh toán và giao hàng.
const getMyOrders = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    const pool = await poolPromise;
    const ordersResult = await pool.request().input("UserId", sql.Int, userId)
      .query(`
      SELECT
        o.id,
        o.sub_total,
        o.discount_amount,
        o.total_amount,
        o.status,
        o.payment_status,
        o.shipping_code,
        o.shipping_address,
        o.created_at,
        ship.tracking_code,
        ship.status AS shipping_status,
        payment.method AS payment_method,
        payment.transaction_id,
        payment.payment_log
      FROM orders o
      LEFT JOIN shipping_orders ship ON ship.order_id = o.id
      OUTER APPLY (
        SELECT TOP 1 method, transaction_id, payment_log
        FROM order_payments
        WHERE order_id = o.id
        ORDER BY created_at DESC, id DESC
      ) payment
      WHERE o.user_id = @UserId
      ORDER BY o.created_at DESC, o.id DESC
    `);

    const orders = ordersResult.recordset;

    if (!orders.length) {
      return res.status(200).json({
        success: true,
        data: [],
      });
    }

    const itemRequest = pool.request();
    const orderIdParams = orders.map((order, index) => {
      const key = `OrderId${index}`;
      itemRequest.input(key, sql.Int, Number(order.id));
      return `@${key}`;
    });

    const itemsResult = await itemRequest.query(`
      SELECT
        oi.order_id,
        oi.variant_id,
        oi.quantity,
        oi.unit_price,
        oi.total_price,
        pv.product_id,
        p.name AS product_name
      FROM order_items oi
      INNER JOIN product_variants pv ON pv.id = oi.variant_id
      INNER JOIN products p ON p.id = pv.product_id
      WHERE oi.order_id IN (${orderIdParams.join(", ")})
      ORDER BY oi.order_id DESC, oi.id ASC
    `);

    const itemsByOrderId = itemsResult.recordset.reduce((acc, item) => {
      const key = Number(item.order_id);
      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push({
        productId: Number(item.product_id || 0),
        variantId: Number(item.variant_id || 0),
        name: item.product_name,
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unit_price || 0),
        totalPrice: Number(item.total_price || 0),
      });

      return acc;
    }, {});

    const data = orders.map((order) => {
      const shippingAddress = parseJsonSafe(order.shipping_address, {});
      const paymentLog = parseJsonSafe(order.payment_log, {});
      const orderItems = itemsByOrderId[Number(order.id)] || [];
      const shippingFee = Math.max(
        0,
        Number(order.total_amount || 0) -
          Number(order.sub_total || 0) +
          Number(order.discount_amount || 0),
      );

      return {
        id: Number(order.id),
        title: buildOrderTitle(orderItems),
        orderCode: order.tracking_code || order.shipping_code || null,
        subtotal: Number(order.sub_total || 0),
        discount: Number(order.discount_amount || 0),
        shippingFee,
        total: Number(order.total_amount || 0),
        paymentMethod: order.payment_method || "",
        paymentStatus: order.payment_status || "",
        paymentLabel:
          paymentLog?.paymentLabel || mapPaymentMethod(order.payment_method),
        paymentReference: paymentLog?.paymentReference || "",
        paidAt: paymentLog?.paidAt || null,
        sepayTransactionId:
          paymentLog?.sepay?.id || paymentLog?.sepayTransactionId || order.transaction_id || "",
        shippingStatus: order.shipping_status || "",
        recipientName: shippingAddress?.fullName || "",
        recipientPhone: shippingAddress?.phone || "",
        recipientEmail: shippingAddress?.email || "",
        streetAddress: shippingAddress?.streetAddress || "",
        wardName: shippingAddress?.wardName || "",
        districtName: shippingAddress?.districtName || "",
        provinceName: shippingAddress?.provinceName || "",
        parcelWeight: Number(shippingAddress?.parcel?.weight || 0),
        parcelLength: Number(shippingAddress?.parcel?.length || 0),
        parcelWidth: Number(shippingAddress?.parcel?.width || 0),
        parcelHeight: Number(shippingAddress?.parcel?.height || 0),
        address:
          shippingAddress?.fullAddress || shippingAddress?.streetAddress || "",
        note: shippingAddress?.note || "",
        status: order.tracking_code
          ? "Đã tạo đơn GHN"
          : mapOrderStatus(order.status),
        createdAt: order.created_at,
        items: orderItems,
      };
    });

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("Get my orders error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy trạng thái thanh toán chi tiết của một đơn để frontend polling sau khi checkout.
const getMyOrderPaymentStatus = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const orderId = Number(req.params.id || 0);

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized.",
      });
    }

    if (!orderId) {
      return res.status(400).json({
        success: false,
        message: "Mã đơn hàng không hợp lệ.",
      });
    }

    const pool = await poolPromise;
    const orderResult = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .input("OrderId", sql.Int, orderId)
      .query(`
        SELECT TOP 1
          o.id,
          o.status,
          o.payment_status,
          o.total_amount,
          payment.method AS payment_method,
          payment.status AS payment_row_status,
          payment.transaction_id,
          payment.payment_log
        FROM orders o
        OUTER APPLY (
          SELECT TOP 1 method, status, transaction_id, payment_log
          FROM order_payments
          WHERE order_id = o.id
          ORDER BY created_at DESC, id DESC
        ) payment
        WHERE o.id = @OrderId
          AND o.user_id = @UserId
      `);

    const order = orderResult.recordset[0];

    if (!order) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy đơn hàng.",
      });
    }

    const paymentLog = parseJsonSafe(order.payment_log, {}) || {};
    const paymentStatus = String(
      order.payment_status || order.payment_row_status || "PENDING",
    ).trim().toUpperCase();
    const isPaid = paymentStatus === "PAID";

    return res.status(200).json({
      success: true,
      data: {
        orderId: Number(order.id),
        orderStatus: order.status || "",
        payment: {
          method: order.payment_method || "",
          amount: Number(order.total_amount || 0),
          status: paymentStatus,
          isPaid,
          mode: paymentLog?.paymentMode || paymentLog?.sepay?.mode || "",
          isVirtualAccount:
            String(paymentLog?.paymentMode || paymentLog?.sepay?.mode || "").trim() ===
            "virtual_account",
          paidAt: paymentLog?.paidAt || null,
          paymentReference: paymentLog?.paymentReference || "",
          transferContent:
            paymentLog?.sepay?.orderCode || paymentLog?.paymentReference || "",
          accountNumber:
            paymentLog?.virtualAccountNumber || paymentLog?.sepay?.vaNumber || "",
          accountHolderName:
            paymentLog?.sepay?.accountHolderName || paymentLog?.sepay?.vaHolderName || "",
          expiresAt: paymentLog?.sepay?.expiredAt || null,
          warning: paymentLog?.sepay?.warning || "",
          sepayTransactionId:
            paymentLog?.sepay?.id || paymentLog?.sepayTransactionId || order.transaction_id || "",
        },
      },
    });
  } catch (error) {
    console.error("Get my order payment status error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể kiểm tra trạng thái thanh toán.",
    });
  }
};

module.exports = {
  createCustomerOrder,
  getMyOrders,
  getMyOrderPaymentStatus,
};
