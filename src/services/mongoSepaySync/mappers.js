// Chuyển giá trị ngày sang Date hợp lệ, nếu lỗi thì fallback về thời điểm hiện tại.
const toDateOrNow = (value) => {
  const parsedDate = value ? new Date(value) : new Date();
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
};

// Chuẩn hóa tiền tệ về number để lưu MongoDB nhất quán.
const toMoneyNumber = (value) => {
  const parsedValue = Number(value || 0);
  return Number.isFinite(parsedValue) ? parsedValue : 0;
};

// Ánh xạ trạng thái thanh toán nội bộ sang nhãn đang dùng trong MongoDB.
const mapInternalPaymentStatusToMongo = (value, fallback = "Unpaid") => {
  const normalizedValue = String(value || "").trim().toUpperCase();

  if (normalizedValue === "PAID") return "Paid";
  if (normalizedValue === "CANCELLED") return "Cancelled";
  if (normalizedValue === "REFUNDED") return "Refunded";
  if (["UNPAID", "PENDING", "PROCESSING"].includes(normalizedValue)) return "Unpaid";

  return fallback;
};

// Dựng document giao dịch webhook SePay để upsert vào collection giao dịch.
const buildTransactionDocument = ({
  sepayPayload,
  rawPayload,
  matchedOrder = null,
  paymentReference = "",
  syncStatus = "",
  syncMessage = "",
}) => {
  const transferType = String(sepayPayload?.transferType || "").trim().toLowerCase();
  const amountValue = toMoneyNumber(sepayPayload?.transferAmount);

  return {
    id: Number(sepayPayload?.id || 0) || null,
    gateway: String(sepayPayload?.gateway || "").trim(),
    transaction_date: toDateOrNow(sepayPayload?.transactionDate),
    account_number: String(sepayPayload?.accountNumber || "").trim() || null,
    sub_account: String(sepayPayload?.subAccount || "").trim() || null,
    amount_in: transferType === "in" ? amountValue : 0,
    amount_out: transferType === "out" ? amountValue : 0,
    accumulated: toMoneyNumber(sepayPayload?.accumulated),
    code: String(sepayPayload?.code || "").trim() || null,
    transaction_content: String(sepayPayload?.content || "").trim() || null,
    reference_number: String(sepayPayload?.referenceCode || "").trim() || null,
    body: JSON.stringify(rawPayload || {}),
    created_at: new Date(),
    updated_at: new Date(),
    transfer_type: transferType || null,
    description: String(sepayPayload?.description || "").trim() || null,
    payment_reference: String(paymentReference || "").trim() || null,
    order_id: Number(matchedOrder?.id || 0) || null,
    webhook_status: String(syncStatus || "").trim() || null,
    webhook_message: String(syncMessage || "").trim() || null,
  };
};

// Dựng document đơn hàng liên quan đến thanh toán SePay để lưu snapshot sang MongoDB.
const buildOrderDocument = ({
  matchedOrder,
  paymentReference = "",
  paymentStatus = "",
  sepayPayload,
}) => {
  const orderId = Number(matchedOrder?.id || 0);
  const normalizedPaymentStatus = mapInternalPaymentStatusToMongo(
    paymentStatus || matchedOrder?.payment_status || matchedOrder?.payment_row_status
  );
  const orderName =
    String(paymentReference || "").trim() ||
    String(sepayPayload?.code || "").trim() ||
    `ORDER-${orderId}`;

  return {
    id: orderId,
    total: toMoneyNumber(matchedOrder?.total_amount || matchedOrder?.payment_amount || 0),
    payment_status: normalizedPaymentStatus,
    name: orderName,
    created_at: new Date(),
    updated_at: new Date(),
    gateway: String(sepayPayload?.gateway || "").trim() || null,
    account_number: String(sepayPayload?.accountNumber || "").trim() || null,
    sub_account: String(sepayPayload?.subAccount || "").trim() || null,
    payment_reference: String(paymentReference || "").trim() || null,
    sepay_transaction_id: Number(sepayPayload?.id || 0) || null,
    transaction_date: toDateOrNow(sepayPayload?.transactionDate),
  };
};

// Tạo payload upsert chuẩn, giữ nguyên created_at cho bản ghi đã tồn tại.
const buildMongoUpsertPayload = (document = {}) => {
  const createdAt = document.created_at || new Date();
  const nextDocument = { ...document };

  delete nextDocument.created_at;

  return {
    $set: nextDocument,
    $setOnInsert: {
      created_at: createdAt,
    },
  };
};

module.exports = {
  buildMongoUpsertPayload,
  buildOrderDocument,
  buildTransactionDocument,
};
