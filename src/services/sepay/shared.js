// Chuẩn hóa mã ngân hàng về chữ in hoa để so sánh cấu hình ổn định.
const normalizeBankCode = (value) => String(value || "").trim().toUpperCase();

// Chuyển giá trị đầu vào về số nguyên dương, trả về null nếu dữ liệu không hợp lệ.
const toPositiveInteger = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.trunc(parsedValue);
};

// Tách payload trả về từ HTTP response, ưu tiên JSON và fallback sang text thường.
const unwrapJsonPayload = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return {
    message: await response.text(),
  };
};

module.exports = {
  normalizeBankCode,
  toPositiveInteger,
  unwrapJsonPayload,
};
