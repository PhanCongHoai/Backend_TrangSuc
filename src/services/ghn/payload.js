const { getParcelDefaults, getSenderDefaults } = require("./config");
const { GhnError } = require("./error");
const { toPositiveNumber } = require("./shared");

// Rút ra các thông số kiện hàng bắt buộc để phục vụ validate tính phí GHN.
const getRequiredParcelFields = (payload = {}) => ({
  height: toPositiveNumber(payload.height),
  length: toPositiveNumber(payload.length),
  width: toPositiveNumber(payload.width),
  weight: toPositiveNumber(payload.weight),
});

// Chuẩn hóa danh sách sản phẩm đơn hàng về format item mà GHN chấp nhận.
const normalizeOrderItems = (items = []) =>
  items
    .map((item) => ({
      name: String(item?.name || "").trim(),
      code: String(item?.code || item?.sku || "").trim() || undefined,
      quantity: toPositiveNumber(item?.quantity) || 1,
      price: Math.max(0, Number(item?.price || 0)),
      length: toPositiveNumber(item?.length) || undefined,
      width: toPositiveNumber(item?.width) || undefined,
      height: toPositiveNumber(item?.height) || undefined,
      weight: toPositiveNumber(item?.weight) || undefined,
      category: {
        level1: String(item?.category?.level1 || item?.category || "Trang suc").trim(),
      },
    }))
    .filter((item) => item.name);

// Sinh tên đơn hàng gửi sang GHN từ tên tường minh hoặc danh sách sản phẩm.
const buildOrderName = (payload = {}, normalizedItems = []) => {
  const explicitName = String(payload.name || "").trim();

  if (explicitName) {
    return explicitName;
  }

  if (normalizedItems.length === 1) {
    return normalizedItems[0].name;
  }

  if (normalizedItems.length > 1) {
    return `Don hang gom ${normalizedItems.length} san pham`;
  }

  return "Trang suc";
};

// Gộp payload đầu vào với cấu hình mặc định để tạo request body tạo đơn GHN hoàn chỉnh.
const mergeCreateOrderPayload = (payload = {}) => {
  const senderDefaults = getSenderDefaults();
  const parcelDefaults = getParcelDefaults();
  const normalizedItems = Array.isArray(payload.items) ? normalizeOrderItems(payload.items) : [];
  const requestBody = {
    name: buildOrderName(payload, normalizedItems),
    payment_type_id: Number(payload.payment_type_id || 2),
    required_note: payload.required_note || "KHONGCHOXEMHANG",
    note: String(payload.note || "").trim(),
    from_name: payload.from_name || senderDefaults.from_name,
    from_phone: payload.from_phone || senderDefaults.from_phone,
    from_address: payload.from_address || senderDefaults.from_address,
    from_district_id:
      toPositiveNumber(payload.from_district_id) || senderDefaults.from_district_id,
    from_ward_code: payload.from_ward_code || senderDefaults.from_ward_code,
    to_name: String(payload.to_name || "").trim(),
    to_phone: String(payload.to_phone || "").trim(),
    to_address: String(payload.to_address || "").trim(),
    to_district_id: toPositiveNumber(payload.to_district_id),
    to_ward_code: String(payload.to_ward_code || "").trim(),
    service_type_id:
      toPositiveNumber(payload.service_type_id) || parcelDefaults.service_type_id,
    weight: toPositiveNumber(payload.weight) || parcelDefaults.weight,
    length: toPositiveNumber(payload.length) || parcelDefaults.length,
    width: toPositiveNumber(payload.width) || parcelDefaults.width,
    height: toPositiveNumber(payload.height) || parcelDefaults.height,
    insurance_value: Math.max(0, Number(payload.insurance_value || 0)),
    cod_amount: Math.max(0, Number(payload.cod_amount || 0)),
    coupon: payload.coupon ?? null,
  };

  if (normalizedItems.length > 0) {
    requestBody.items = normalizedItems;
  }

  return requestBody;
};

// Kiểm tra các trường bắt buộc của payload tạo đơn GHN trước khi gọi API.
const assertCreateOrderPayload = (payload) => {
  const requiredFields = [
    "from_name",
    "from_phone",
    "from_address",
    "from_district_id",
    "from_ward_code",
    "to_name",
    "to_phone",
    "to_address",
    "to_district_id",
    "to_ward_code",
  ];

  const missingFields = requiredFields.filter((fieldName) => !payload[fieldName]);

  if (missingFields.length > 0) {
    throw new GhnError(
      `Thieu truong bat buoc de tao don GHN: ${missingFields.join(", ")}.`,
      { status: 400 }
    );
  }
};

// Dựng payload tính phí GHN và xác thực đủ địa chỉ cùng thông số kiện hàng.
const buildCalculateFeePayload = (payload = {}) => {
  const senderDefaults = getSenderDefaults();
  const parcelDefaults = getParcelDefaults();
  const parcelFields = getRequiredParcelFields(payload);
  const missingParcelFields = Object.entries(parcelFields)
    .filter(([, value]) => !value)
    .map(([fieldName]) => fieldName);

  if (missingParcelFields.length > 0) {
    throw new GhnError(
      `Thieu thong so kien hang de tinh phi GHN: ${missingParcelFields.join(", ")}.`,
      { status: 400 }
    );
  }

  const requestBody = {
    service_type_id:
      toPositiveNumber(payload.service_type_id) || parcelDefaults.service_type_id,
    from_district_id:
      toPositiveNumber(payload.from_district_id) || senderDefaults.from_district_id,
    to_district_id: toPositiveNumber(payload.to_district_id),
    to_ward_code: String(payload.to_ward_code || "").trim(),
    height: parcelFields.height,
    length: parcelFields.length,
    weight: parcelFields.weight,
    width: parcelFields.width,
    insurance_value: Math.max(0, Number(payload.insurance_value || 0)),
    coupon: payload.coupon ?? null,
  };

  if (!requestBody.from_district_id || !requestBody.to_district_id || !requestBody.to_ward_code) {
    throw new GhnError(
      "Thieu district/ward de tinh phi GHN. Kiem tra GHN_FROM_DISTRICT_ID va dia chi nguoi nhan.",
      { status: 400 }
    );
  }

  return requestBody;
};

module.exports = {
  assertCreateOrderPayload,
  buildCalculateFeePayload,
  mergeCreateOrderPayload,
  normalizeOrderItems,
};
