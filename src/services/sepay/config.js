const { normalizeBankCode, toPositiveInteger } = require("./shared");

const SUPPORTED_VA_BANKS = new Set(["BIDV", "SACOMBANK", "OCB"]);

const getSepayVaConfig = () => {
  const enabled =
    String(process.env.SEPAY_VA_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const apiToken = String(process.env.SEPAY_API_TOKEN || "").trim();
  const bankAccountXid = String(
    process.env.SEPAY_BANK_ACCOUNT_XID || "",
  ).trim();
  const bankCode = normalizeBankCode(process.env.SEPAY_BANK_CODE || "");
  const qrTemplate = String(
    process.env.SEPAY_VA_QR_TEMPLATE ||
      process.env.SEPAY_QR_TEMPLATE ||
      "compact",
  ).trim();
  const vaPrefix = String(process.env.SEPAY_VA_PREFIX || "").trim();
  const vaHolderName = String(process.env.SEPAY_VA_HOLDER_NAME || "").trim();
  const durationSeconds = toPositiveInteger(
    process.env.SEPAY_VA_DURATION_SECONDS,
  );
  const supportedBank = SUPPORTED_VA_BANKS.has(bankCode);
  const missingFields = [];

  if (!apiToken) {
    missingFields.push("SEPAY_API_TOKEN");
  }

  if (!bankAccountXid) {
    missingFields.push("SEPAY_BANK_ACCOUNT_XID");
  }

  if (!bankCode) {
    missingFields.push("SEPAY_BANK_CODE");
  }

  if (bankCode === "SACOMBANK" && !vaPrefix) {
    missingFields.push("SEPAY_VA_PREFIX");
  }

  return {
    enabled,
    apiToken,
    bankAccountXid,
    bankCode,
    qrTemplate: qrTemplate || "compact",
    vaPrefix,
    vaHolderName,
    durationSeconds,
    supportedBank,
    missingFields,
    ready: enabled && supportedBank && missingFields.length === 0,
  };
};

const getSepaySharedVaConfig = () => {
  const enabled =
    String(process.env.SEPAY_VA_ENABLED || "")
      .trim()
      .toLowerCase() === "true";
  const bankCode = normalizeBankCode(process.env.SEPAY_BANK_CODE || "");
  const bankName = String(
    process.env.SEPAY_BANK_NAME || process.env.SEPAY_BANK_CODE || "",
  ).trim();
  const qrTemplate = String(
    process.env.SEPAY_VA_QR_TEMPLATE ||
      process.env.SEPAY_QR_TEMPLATE ||
      "compact",
  ).trim();
  const vaNumber = String(
    process.env.SEPAY_STATIC_VA_NUMBER || process.env.SEPAY_VA_NUMBER || "",
  ).trim();
  const accountHolderName = String(
    process.env.SEPAY_STATIC_VA_HOLDER_NAME ||
      process.env.SEPAY_VA_HOLDER_NAME ||
      "",
  ).trim();
  const durationSeconds = toPositiveInteger(
    process.env.SEPAY_VA_DURATION_SECONDS,
  );
  const missingFields = [];

  if (!bankCode) {
    missingFields.push("SEPAY_BANK_CODE");
  }

  if (!vaNumber) {
    missingFields.push("SEPAY_STATIC_VA_NUMBER");
  }

  return {
    enabled,
    bankCode,
    bankName: bankName || bankCode,
    qrTemplate: qrTemplate || "compact",
    vaNumber,
    accountHolderName,
    durationSeconds,
    missingFields,
    ready: enabled && missingFields.length === 0,
  };
};

module.exports = {
  getSepaySharedVaConfig,
  getSepayVaConfig,
};
