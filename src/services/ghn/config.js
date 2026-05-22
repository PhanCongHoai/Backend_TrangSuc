const { GhnError } = require("./error");
const { toPositiveNumber } = require("./shared");

const GHN_SANDBOX_BASE_URL = "https://dev-online-gateway.ghn.vn/shiip/public-api";
const GHN_PRODUCTION_BASE_URL = "https://online-gateway.ghn.vn/shiip/public-api";

// Chọn base URL GHN theo môi trường sandbox hoặc production.
const getBaseUrl = () =>
  String(process.env.GHN_USE_SANDBOX || "true").toLowerCase() === "false"
    ? GHN_PRODUCTION_BASE_URL
    : GHN_SANDBOX_BASE_URL;

// Lấy thông tin người gửi mặc định từ biến môi trường để tái sử dụng khi tạo đơn.
const getSenderDefaults = () => ({
  from_name: String(process.env.GHN_FROM_NAME || "").trim(),
  from_phone: String(process.env.GHN_FROM_PHONE || "").trim(),
  from_address: String(process.env.GHN_FROM_ADDRESS || "").trim(),
  from_district_id: toPositiveNumber(process.env.GHN_FROM_DISTRICT_ID),
  from_ward_code: String(process.env.GHN_FROM_WARD_CODE || "").trim(),
});

// Lấy bộ thông số kiện hàng mặc định cho các luồng tính phí và tạo đơn GHN.
const getParcelDefaults = () => ({
  height: toPositiveNumber(process.env.GHN_DEFAULT_HEIGHT) || 10,
  length: toPositiveNumber(process.env.GHN_DEFAULT_LENGTH) || 20,
  width: toPositiveNumber(process.env.GHN_DEFAULT_WIDTH) || 15,
  weight: toPositiveNumber(process.env.GHN_DEFAULT_WEIGHT) || 500,
  service_type_id: toPositiveNumber(process.env.GHN_DEFAULT_SERVICE_TYPE_ID) || 2,
});

// Đọc cấu hình GHN công khai và gom các trường còn thiếu để báo lỗi rõ ràng.
const getPublicConfig = () => {
  const token = String(process.env.GHN_TOKEN || "").trim();
  const shopId = String(process.env.GHN_SHOP_ID || "").trim();
  const senderDefaults = getSenderDefaults();
  const missingFields = [];

  if (!token) {
    missingFields.push("GHN_TOKEN");
  }

  if (!shopId) {
    missingFields.push("GHN_SHOP_ID");
  }

  if (!senderDefaults.from_name) {
    missingFields.push("GHN_FROM_NAME");
  }

  if (!senderDefaults.from_phone) {
    missingFields.push("GHN_FROM_PHONE");
  }

  if (!senderDefaults.from_address) {
    missingFields.push("GHN_FROM_ADDRESS");
  }

  if (!senderDefaults.from_district_id) {
    missingFields.push("GHN_FROM_DISTRICT_ID");
  }

  if (!senderDefaults.from_ward_code) {
    missingFields.push("GHN_FROM_WARD_CODE");
  }

  return {
    enabled: missingFields.length === 0,
    useSandbox:
      String(process.env.GHN_USE_SANDBOX || "true").toLowerCase() !== "false",
    baseUrl: getBaseUrl(),
    shopId: shopId || null,
    missingFields,
  };
};

// Ép kiểm tra cấu hình GHN trước khi gọi API thật.
const assertConfigured = () => {
  const config = getPublicConfig();

  if (!config.enabled) {
    throw new GhnError(
      "GHN chua duoc cau hinh. Hay them GHN_TOKEN va GHN_SHOP_ID vao backend/.env.",
      { status: 503 }
    );
  }

  return config;
};

// Tạo header chuẩn để gọi GHN API, có thể bật hoặc tắt ShopId theo endpoint.
const buildHeaders = ({ includeShopId = true } = {}) => {
  const config = assertConfigured();
  const headers = {
    Token: String(process.env.GHN_TOKEN || "").trim(),
    "Content-Type": "application/json",
  };

  if (includeShopId) {
    headers.ShopId = config.shopId;
  }

  return headers;
};

module.exports = {
  assertConfigured,
  buildHeaders,
  getBaseUrl,
  getParcelDefaults,
  getPublicConfig,
  getSenderDefaults,
};
