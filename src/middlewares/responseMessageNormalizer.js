const EXACT_MESSAGE_MAP = new Map([
  ["Server error.", "Có lỗi máy chủ. Vui lòng thử lại sau."],
  ["Product not found.", "Không tìm thấy sản phẩm."],
  ["Invalid product id.", "ID sản phẩm không hợp lệ."],
  ["Product name is required.", "Vui lòng nhập tên sản phẩm."],
  ["material_type is required.", "Vui lòng chọn chất liệu."],
  ["category_id is invalid.", "Danh mục sản phẩm không hợp lệ."],
  ["Customer not found.", "Không tìm thấy khách hàng."],
  ["Email not found.", "Không tìm thấy email."],
  ["Category name is required.", "Vui lòng nhập tên danh mục."],
  ["Category already exists.", "Danh mục đã tồn tại."],
  ["Category created successfully.", "Tạo danh mục thành công."],
  ["Category deleted successfully.", "Xóa danh mục thành công."],
  ["Category not found.", "Không tìm thấy danh mục."],
  [
    "Cannot delete a parent category that still has child categories.",
    "Không thể xóa danh mục cha khi vẫn còn danh mục con.",
  ],
  ["Gold rate created successfully.", "Tạo giá vàng thành công."],
  ["Product created successfully.", "Thêm sản phẩm thành công."],
  ["Product updated successfully.", "Cập nhật sản phẩm thành công."],
  ["Product deleted successfully.", "Xóa sản phẩm thành công."],
  ["All products deleted successfully.", "Xóa toàn bộ sản phẩm thành công."],
  ["No products to delete.", "Không có sản phẩm nào để xóa."],
  ["No products to hide.", "Không có sản phẩm nào để ẩn."],
  ["All products hidden successfully.", "Ẩn toàn bộ sản phẩm thành công."],
  ["Product hidden successfully.", "Ẩn sản phẩm thành công."],
  ["Product shown successfully.", "Hiển thị sản phẩm thành công."],
  ["Product id is invalid.", "ID sản phẩm không hợp lệ."],
  ["Compare config loaded successfully.", "Tải cấu hình so sánh thành công."],
  ["Cannot load compare config.", "Không thể tải cấu hình so sánh."],
  [
    "Khong tim thay gia vang hien hanh cho chat lieu da chon.",
    "Không tìm thấy giá vàng hiện hành cho chất liệu đã chọn.",
  ],
  [
    "Vui long nhap it nhat mot bien the co SKU.",
    "Vui lòng nhập ít nhất một biến thể có SKU.",
  ],
  [
    "San pham da phat sinh giao dich hoac lich su kho, hay an san pham thay vi xoa.",
    "Sản phẩm đã phát sinh giao dịch hoặc lịch sử kho, hãy ẩn sản phẩm thay vì xóa.",
  ],
  [
    "Khong the xoa tat ca vi da co giao dich hoac lich su kho. Hay an san pham thay vi xoa.",
    "Không thể xóa tất cả vì đã có giao dịch hoặc lịch sử kho. Hãy ẩn sản phẩm thay vì xóa.",
  ],
]);

const REGEX_MESSAGE_MAP = [
  {
    pattern: /^SKU\s+(.+)\s+already exists\.$/i,
    resolve: ([, sku]) => `SKU ${sku} đã tồn tại.`,
  },
  {
    pattern: /^SKU\s+(.+)\s+bi trung trong danh sach bien the\.$/i,
    resolve: ([, sku]) => `SKU ${sku} bị trùng trong danh sách biến thể.`,
  },
  {
    pattern: /^Compare requires exactly\s+(\d+)\s+products\.$/i,
    resolve: ([, count]) => `Cần chọn đúng ${count} sản phẩm để so sánh.`,
  },
  {
    pattern: /^CÃ¡c trÆ°á»ng sá»‘ khÃ´ng há»£p lá»‡:\s*(.+)\.$/i,
    resolve: ([, fields]) => `Các trường số không hợp lệ: ${fields}.`,
  },
];

function maybeFixMojibake(value) {
  const normalizedValue = String(value || "");

  if (!/[ÃÂÆÐ]/.test(normalizedValue)) {
    return normalizedValue;
  }

  try {
    const decoded = Buffer.from(normalizedValue, "latin1").toString("utf8");
    return decoded.includes("�") ? normalizedValue : decoded;
  } catch (error) {
    return normalizedValue;
  }
}

function normalizeMessageValue(value) {
  const normalizedValue = maybeFixMojibake(String(value || "").trim());

  if (!normalizedValue) {
    return normalizedValue;
  }

  if (EXACT_MESSAGE_MAP.has(normalizedValue)) {
    return EXACT_MESSAGE_MAP.get(normalizedValue);
  }

  for (const entry of REGEX_MESSAGE_MAP) {
    const matches = normalizedValue.match(entry.pattern);

    if (matches) {
      return entry.resolve(matches);
    }
  }

  return normalizedValue;
}

function normalizePayloadMessages(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  if (payload instanceof Date) {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map(normalizePayloadMessages);
  }

  const nextPayload = { ...payload };

  for (const [key, value] of Object.entries(nextPayload)) {
    if (typeof value === "string" && key === "message") {
      nextPayload[key] = normalizeMessageValue(value);
      continue;
    }

    if (value && typeof value === "object") {
      nextPayload[key] = normalizePayloadMessages(value);
    }
  }

  return nextPayload;
}

function responseMessageNormalizer(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (payload) => originalJson(normalizePayloadMessages(payload));

  next();
}

module.exports = {
  normalizeMessageValue,
  responseMessageNormalizer,
};
