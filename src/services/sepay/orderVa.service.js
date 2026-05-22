const { getSepayVaConfig } = require("./config");
const { postSepayOrderVa } = require("./client");
const { SepayVaError } = require("./error");
const { toPositiveInteger } = require("./shared");

// Điều phối toàn bộ luồng tạo virtual account SePay cho một đơn hàng cụ thể.
const createSepayOrderVa = async ({ orderCode, amount, vaHolderName = "" }) => {
  const config = getSepayVaConfig();

  if (!config.enabled) {
    throw new SepayVaError("Chua bat SePay VA. Hay dat SEPAY_VA_ENABLED=true.", {
      status: 400,
    });
  }

  if (!config.supportedBank) {
    throw new SepayVaError(
      `SePay VA theo don hien chua ho tro ngan hang ${
        config.bankCode || "chua cau hinh"
      } trong cau hinh backend.`,
      { status: 400 }
    );
  }

  if (config.missingFields.length) {
    throw new SepayVaError(
      `Thieu cau hinh SePay VA: ${config.missingFields.join(", ")}.`,
      { status: 500 }
    );
  }

  const normalizedOrderCode = String(orderCode || "").trim();
  const normalizedAmount = toPositiveInteger(amount);
  // Dựng request body tối thiểu theo format SePay yêu cầu.
  const requestBody = {
    order_code: normalizedOrderCode || undefined,
    with_qrcode: "1",
    qrcode_template: config.qrTemplate,
  };

  if (config.bankCode === "SACOMBANK") {
    requestBody.va_prefix = config.vaPrefix;
    requestBody.amount = normalizedAmount || 1;
  } else if (normalizedAmount) {
    requestBody.amount = normalizedAmount;
  }

  const resolvedVaHolderName = String(vaHolderName || config.vaHolderName || "").trim();

  // Cho phép ưu tiên tên chủ tài khoản truyền từ đơn hàng hơn cấu hình mặc định.
  if (resolvedVaHolderName) {
    requestBody.va_holder_name = resolvedVaHolderName;
  }

  if (config.durationSeconds) {
    requestBody.duration = config.durationSeconds;
  }

  const { response, payload } = await postSepayOrderVa({
    bankAccountXid: config.bankAccountXid,
    body: requestBody,
  });

  if (!response.ok || String(payload?.status || "").toLowerCase() !== "success") {
    throw new SepayVaError(
      payload?.message || "SePay khong tao duoc tai khoan ao theo don hang.",
      {
        status: response.status || 502,
        details: payload,
      }
    );
  }

  // Chuẩn hóa response SePay thành object gọn để controller lưu và trả về frontend.
  return {
    id: String(payload?.data?.id || "").trim(),
    orderCode: String(payload?.data?.order_code || normalizedOrderCode).trim(),
    vaNumber: String(payload?.data?.va_number || "").trim(),
    vaHolderName: String(payload?.data?.va_holder_name || "").trim(),
    amount: Number(payload?.data?.amount || normalizedAmount || 0),
    status: String(payload?.data?.status || "Pending").trim(),
    bankCode: config.bankCode,
    bankName: String(payload?.data?.bank_name || config.bankCode).trim(),
    accountHolderName: String(payload?.data?.account_holder_name || "").trim(),
    accountNumber: String(payload?.data?.account_number || "").trim(),
    expiredAt: String(payload?.data?.expired_at || "").trim() || null,
    qrCode: String(payload?.data?.qr_code || "").trim() || null,
    qrCodeUrl: String(payload?.data?.qr_code_url || "").trim() || null,
  };
};

module.exports = {
  createSepayOrderVa,
};
