const { poolPromise, sql } = require("../../config/db");
const {
  getMongoSepayConfig,
  syncSepayWebhookToMongoSafe,
} = require("../../services/mongoSepaySync.service");
const { ensureGhnShippingForPaidOrderSafe } = require("./shippingFlow");
const { notifyOrderSubscribers } = require("./realtime");
const {
  buildPaymentReference,
  buildSepayWebhookDebugInfo,
  escapeLikePattern,
  extractOrderIdFromReference,
  extractSepayAccountTargets,
  extractSepayReferences,
  getSepayWebhookSecurityConfig,
  isSepayWebhookAuthorized,
  normalizeMoney,
  normalizeSepayPayload,
  parseJsonSafe,
  pickSepayCandidateOrder,
} = require("./shared");

// Trả về trạng thái health check và cấu hình hiện tại của webhook SePay.
const getSepayWebhookHealth = async (req, res) => {
  const webhookSecurity = getSepayWebhookSecurityConfig();
  const mongoSepayConfig = getMongoSepayConfig();

  return res.status(200).json({
    success: true,
    data: {
      service: "sepay-webhook",
      status: "ok",
      timestamp: new Date().toISOString(),
      route: "/api/orders/sepay/webhook",
      publicRequirement:
        "Webhook chỉ nhận được khi backend có URL public đang online (cloudflared/ngrok/server public).",
      auth: {
        secretConfigured: Boolean(webhookSecurity.expectedSecret),
        secretRequired: webhookSecurity.requireSecret,
        acceptedLocations: [
          "Authorization: Bearer <secret>",
          "Authorization: Apikey <secret>",
          "x-secret-key: <secret>",
          "x-sepay-webhook-secret: <secret>",
          "x-webhook-secret: <secret>",
          "query: ?secret=<secret>",
        ],
      },
      mongoSync: {
        enabled: mongoSepayConfig.enabled,
        dbName: mongoSepayConfig.dbName,
        transactionsCollection: mongoSepayConfig.transactionsCollection,
        ordersCollection: mongoSepayConfig.ordersCollection,
        hasMongoUri: Boolean(mongoSepayConfig.uri),
      },
      requestExample: {
        healthCheckUrl: `${req.protocol}://${req.get("host")}${req.originalUrl}`,
        webhookUrlExample: `${req.protocol}://${req.get("host")}/api/orders/sepay/webhook`,
      },
    },
  });
};

// Xử lý webhook SePay: xác thực secret, đối soát đơn, ghi nhận thanh toán và đồng bộ sau xử lý.
const handleSepayWebhook = async (req, res) => {
  console.log("[SePay webhook] Incoming request:", buildSepayWebhookDebugInfo(req));

  if (!isSepayWebhookAuthorized(req)) {
    console.warn("[SePay webhook] Rejected because secret is missing or invalid.");
    return res.status(401).json({
      success: false,
      message: "Webhook secret không hợp lệ.",
    });
  }

  const rawSepayPayload = req.body;
  const sepayPayload = normalizeSepayPayload(req.body);
  // Bọc lời gọi sync Mongo để tái sử dụng ở nhiều nhánh xử lý webhook.
  const syncSepayMongo = (options = {}) =>
    syncSepayWebhookToMongoSafe({
      sepayPayload,
      rawPayload: rawSepayPayload,
      ...options,
    });
  const missingFields = [];

  if (!sepayPayload.id) {
    missingFields.push("id");
  }

  if (!sepayPayload.transferAmount) {
    missingFields.push("transferAmount");
  }

  if (missingFields.length) {
    console.warn("[SePay webhook] Payload missing required fields:", {
      missingFields,
      debug: buildSepayWebhookDebugInfo(req),
    });
    await syncSepayMongo({
      syncStatus: "INVALID_PAYLOAD",
      syncMessage: `Missing fields: ${missingFields.join(", ")}`,
    });
    return res.status(400).json({
      success: false,
      message: `Payload SePay không hợp lệ hoặc thiếu: ${missingFields.join(", ")}.`,
      received: {
        id: sepayPayload.id || null,
        transferAmount: sepayPayload.transferAmount || null,
        transferType: sepayPayload.transferType || null,
        code: sepayPayload.code || null,
        content: sepayPayload.content || null,
      },
    });
  }

  if (!sepayPayload.id || !sepayPayload.transferAmount) {
    await syncSepayMongo({
      syncStatus: "INVALID_PAYLOAD",
      syncMessage: "Payload missing id or transferAmount after normalization.",
    });
    return res.status(400).json({
      success: false,
      message: "Payload SePay không hợp lệ hoặc thiếu id/transferAmount.",
    });
  }

  if (sepayPayload.transferType !== "in") {
    console.log("[SePay webhook] Ignored non-incoming transfer.", {
      id: sepayPayload.id,
      transferType: sepayPayload.transferType,
    });
    await syncSepayMongo({
      syncStatus: "IGNORED_TRANSFER_TYPE",
      syncMessage: "Transfer is not incoming.",
    });
    return res.status(200).json({
      success: true,
      accepted: false,
      message: "Bỏ qua giao dịch không phải tiền vào.",
    });
  }

  let transaction;

  try {
    const pool = await poolPromise;
    transaction = new sql.Transaction(pool);
    await transaction.begin();

    const duplicateResult = await new sql.Request(transaction)
      .input("TransactionId", sql.VarChar(100), String(sepayPayload.id))
      .query(`
        SELECT TOP 1
          payment.order_id,
          payment.transaction_id,
          orders.user_id
        FROM order_payments payment
        INNER JOIN orders ON orders.id = payment.order_id
        WHERE payment.transaction_id = @TransactionId
        ORDER BY payment.id DESC
      `);

    if (duplicateResult.recordset[0]) {
      await transaction.commit();
      const shippingResult = await ensureGhnShippingForPaidOrderSafe(
        Number(duplicateResult.recordset[0].order_id || 0),
      );
      await syncSepayMongo({
        matchedOrder: {
          id: Number(duplicateResult.recordset[0].order_id || 0),
          total_amount: sepayPayload.transferAmount,
          payment_amount: sepayPayload.transferAmount,
          payment_status: "PAID",
        },
        paymentStatus: "PAID",
        paymentReference: String(sepayPayload.code || "").trim(),
        syncStatus: "DUPLICATE_TRANSACTION",
        syncMessage: "Transaction was already processed before webhook retry.",
      });
      console.log("[SePay webhook] Duplicate transaction received.", {
        transactionId: sepayPayload.id,
        orderId: Number(duplicateResult.recordset[0].order_id || 0),
      });
      return res.status(200).json({
        success: true,
        accepted: true,
        duplicate: true,
        orderId: Number(duplicateResult.recordset[0].order_id || 0),
        shipping: shippingResult,
        message: "Giao dịch SePay này đã được xử lý trước đó.",
      });
    }

    const candidateRefs = extractSepayReferences(
      sepayPayload.code,
      sepayPayload.content,
      sepayPayload.referenceCode,
      sepayPayload.description,
    );
    const candidateAccounts = extractSepayAccountTargets(sepayPayload);
    const candidateOrderIds = [
      ...new Set(
        candidateRefs
          .map(extractOrderIdFromReference)
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
    const candidateRequest = new sql.Request(transaction);
    const whereClauses = [];

    if (candidateOrderIds.length) {
      const orderIdParams = candidateOrderIds.map((orderId, index) => {
        const key = `OrderId${index}`;
        candidateRequest.input(key, sql.Int, orderId);
        return `@${key}`;
      });
      whereClauses.push(`o.id IN (${orderIdParams.join(", ")})`);
    }

    if (candidateRefs.length) {
      const likeClauses = candidateRefs.map((reference, index) => {
        const key = `PaymentReference${index}`;
        candidateRequest.input(
          key,
          sql.NVarChar(100),
          `%${escapeLikePattern(reference)}%`,
        );
        return `payment.payment_log LIKE @${key} ESCAPE '\\'`;
      });
      whereClauses.push(`(${likeClauses.join(" OR ")})`);
    }

    if (candidateAccounts.length) {
      const accountClauses = candidateAccounts.map((accountValue, index) => {
        const key = `PaymentAccount${index}`;
        candidateRequest.input(
          key,
          sql.NVarChar(100),
          `%${escapeLikePattern(accountValue)}%`,
        );
        return `payment.payment_log LIKE @${key} ESCAPE '\\'`;
      });
      whereClauses.push(`(${accountClauses.join(" OR ")})`);
    }

    if (!whereClauses.length) {
      await transaction.commit();
      await syncSepayMongo({
        syncStatus: "ORDER_REFERENCE_NOT_FOUND",
        syncMessage: "No order reference was found in SePay payload.",
      });
      console.warn("[SePay webhook] No order reference found in payload.", {
        transactionId: sepayPayload.id,
      });
      return res.status(200).json({
        success: true,
        accepted: false,
        message: "Không tìm thấy mã đơn hàng trong payload SePay.",
      });
    }

    const candidatesResult = await candidateRequest.query(`
      SELECT
        o.id,
        o.user_id,
        o.status,
        o.payment_status,
        o.total_amount,
        payment.id AS payment_id,
        payment.method AS payment_method,
        payment.amount AS payment_amount,
        payment.status AS payment_row_status,
        payment.transaction_id,
        payment.payment_log
      FROM orders o
      OUTER APPLY (
        SELECT TOP 1 id, method, amount, status, transaction_id, payment_log
        FROM order_payments
        WHERE order_id = o.id
        ORDER BY created_at DESC, id DESC
      ) payment
      WHERE ${whereClauses.join(" OR ")}
      ORDER BY o.created_at DESC, o.id DESC
    `);

    const { order: matchedOrder, reason } = pickSepayCandidateOrder(
      candidatesResult.recordset,
      sepayPayload,
      candidateRefs,
      candidateOrderIds,
      candidateAccounts,
    );

    if (!matchedOrder) {
      await transaction.commit();
      await syncSepayMongo({
        syncStatus: "ORDER_NOT_FOUND",
        syncMessage: "Could not match any order from SePay payload.",
      });
      console.warn("[SePay webhook] Could not match order.", {
        transactionId: sepayPayload.id,
        references: candidateRefs,
      });
      return res.status(200).json({
        success: true,
        accepted: false,
        message: "Không tìm thấy đơn hàng phù hợp để đối soát.",
        references: candidateRefs,
      });
    }

    if (String(matchedOrder.status || "").trim().toUpperCase() === "CANCELLED") {
      await transaction.commit();
      await syncSepayMongo({
        matchedOrder,
        paymentStatus: "CANCELLED",
        paymentReference: String(sepayPayload.code || "").trim(),
        syncStatus: "ORDER_CANCELLED",
        syncMessage: "Matched order is cancelled so payment was not applied.",
      });
      console.warn("[SePay webhook] Matched order is cancelled.", {
        transactionId: sepayPayload.id,
        orderId: Number(matchedOrder.id),
      });
      return res.status(200).json({
        success: true,
        accepted: false,
        orderId: Number(matchedOrder.id),
        message: "Đơn hàng đã bị hủy nên webhook không cập nhật thanh toán.",
      });
    }

    if (
      ["PAID"].includes(String(matchedOrder.payment_status || "").trim().toUpperCase()) ||
      ["PAID"].includes(String(matchedOrder.payment_row_status || "").trim().toUpperCase())
    ) {
      await transaction.commit();
      const shippingResult = await ensureGhnShippingForPaidOrderSafe(Number(matchedOrder.id));
      await syncSepayMongo({
        matchedOrder,
        paymentStatus: "PAID",
        paymentReference: String(sepayPayload.code || "").trim(),
        syncStatus: "ALREADY_PAID",
        syncMessage: "Matched order was already marked as paid before this webhook.",
      });
      console.log("[SePay webhook] Order already marked paid.", {
        transactionId: sepayPayload.id,
        orderId: Number(matchedOrder.id),
      });
      return res.status(200).json({
        success: true,
        accepted: true,
        duplicate: true,
        orderId: Number(matchedOrder.id),
        shipping: shippingResult,
        message: "Đơn hàng này đã được ghi nhận thanh toán trước đó.",
      });
    }

    if (!matchedOrder.amountMatched || reason === "AMOUNT_MISMATCH") {
      await transaction.commit();
      await syncSepayMongo({
        matchedOrder,
        paymentStatus:
          matchedOrder.payment_status || matchedOrder.payment_row_status || "UNPAID",
        paymentReference: String(sepayPayload.code || "").trim(),
        syncStatus: "AMOUNT_MISMATCH",
        syncMessage: "Transfer amount does not match expected order amount.",
      });
      console.warn("[SePay webhook] Amount mismatch.", {
        transactionId: sepayPayload.id,
        orderId: Number(matchedOrder.id),
        expectedAmount: normalizeMoney(matchedOrder.amountExpected),
        transferAmount: normalizeMoney(sepayPayload.transferAmount),
      });
      return res.status(200).json({
        success: true,
        accepted: false,
        orderId: Number(matchedOrder.id),
        expectedAmount: normalizeMoney(matchedOrder.amountExpected),
        transferAmount: normalizeMoney(sepayPayload.transferAmount),
        message: "Số tiền giao dịch không khớp với đơn hàng.",
      });
    }

    if (!matchedOrder.payment_id) {
      await transaction.rollback();
      await syncSepayMongo({
        matchedOrder,
        paymentStatus:
          matchedOrder.payment_status || matchedOrder.payment_row_status || "UNPAID",
        paymentReference: String(sepayPayload.code || "").trim(),
        syncStatus: "PAYMENT_ROW_MISSING",
        syncMessage: "Order exists but payment row is missing in SQL Server.",
      });
      return res.status(500).json({
        success: false,
        message: "Đơn hàng chưa có bản ghi thanh toán để cập nhật.",
      });
    }

    const currentPaymentLog = parseJsonSafe(matchedOrder.payment_log, {}) || {};
    const nextPaymentLog = {
      ...currentPaymentLog,
      paymentReference:
        currentPaymentLog.paymentReference || buildPaymentReference(matchedOrder.id),
      paymentProvider: "sepay",
      sepayTransactionId: String(sepayPayload.id),
      paidAt: sepayPayload.transactionDate || new Date().toISOString(),
      lastWebhookAt: new Date().toISOString(),
      sepay: {
        ...(currentPaymentLog.sepay || {}),
        id: sepayPayload.id,
        gateway: sepayPayload.gateway,
        transactionDate: sepayPayload.transactionDate,
        accountNumber: sepayPayload.accountNumber,
        code: sepayPayload.code,
        content: sepayPayload.content,
        transferType: sepayPayload.transferType,
        transferAmount: sepayPayload.transferAmount,
        accumulated: sepayPayload.accumulated,
        subAccount: sepayPayload.subAccount,
        referenceCode: sepayPayload.referenceCode,
        description: sepayPayload.description,
      },
    };

    await new sql.Request(transaction)
      .input("PaymentId", sql.Int, Number(matchedOrder.payment_id))
      .input("TransactionId", sql.VarChar(100), String(sepayPayload.id))
      .input("Status", sql.VarChar(50), "PAID")
      .input("PaymentLog", sql.NVarChar(sql.MAX), JSON.stringify(nextPaymentLog))
      .query(`
        UPDATE order_payments
        SET
          transaction_id = @TransactionId,
          status = @Status,
          payment_log = @PaymentLog
        WHERE id = @PaymentId
      `);

    await new sql.Request(transaction)
      .input("OrderId", sql.Int, Number(matchedOrder.id))
      .input("PaymentStatus", sql.VarChar(50), "PAID")
      .input("NextStatus", sql.VarChar(50), "PROCESSING")
      .query(`
        UPDATE orders
        SET
          payment_status = @PaymentStatus,
          status = CASE
            WHEN UPPER(ISNULL(status, '')) = 'PENDING' THEN @NextStatus
            ELSE status
          END
        WHERE id = @OrderId
      `);

    await transaction.commit();
    const shippingResult = await ensureGhnShippingForPaidOrderSafe(Number(matchedOrder.id));
    notifyOrderSubscribers({
      orderId: Number(matchedOrder.id),
      userId: Number(matchedOrder.user_id || 0),
      reason: "payment-updated",
      paymentStatus: "PAID",
      shippingCode: shippingResult?.orderCode || null,
      shippingCreated: Boolean(shippingResult?.created),
    });
    await syncSepayMongo({
      matchedOrder: {
        ...matchedOrder,
        payment_status: "PAID",
      },
      paymentStatus: "PAID",
      paymentReference: nextPaymentLog.paymentReference,
      syncStatus: "PAID",
      syncMessage: "SePay payment was applied successfully.",
    });
    console.log("[SePay webhook] Payment marked as paid.", {
      transactionId: sepayPayload.id,
      orderId: Number(matchedOrder.id),
      paymentReference: nextPaymentLog.paymentReference,
    });

    return res.status(200).json({
      success: true,
      accepted: true,
      orderId: Number(matchedOrder.id),
      paymentReference: nextPaymentLog.paymentReference,
      paymentStatus: "PAID",
      shipping: shippingResult,
      message: "Đã ghi nhận thanh toán từ SePay.",
    });
  } catch (error) {
    if (transaction) {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        console.error("Rollback SePay webhook error:", rollbackError);
      }
    }

    console.error("Handle SePay webhook error:", error);
    await syncSepayMongo({
      syncStatus: "PROCESSING_ERROR",
      syncMessage: error?.message || "Unhandled SePay webhook processing error.",
    });
    return res.status(500).json({
      success: false,
      message: "Không thể xử lý webhook SePay.",
    });
  }
};

module.exports = {
  getSepayWebhookHealth,
  handleSepayWebhook,
};
