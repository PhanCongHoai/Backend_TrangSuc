const { GhnError } = require("./error");

// Chuyển dữ liệu sang số dương hợp lệ, trả null nếu không dùng được.
const toPositiveNumber = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
};

// Ghép object query thành query string cho các API GET của GHN.
const buildQueryString = (query = {}) => {
  const searchParams = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") {
      return;
    }

    searchParams.set(key, String(value));
  });

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : "";
};

// Tách payload từ response GHN, hỗ trợ cả JSON lẫn text thường.
const unwrapGhnPayload = async (response) => {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return {
    code: response.status,
    message: await response.text(),
  };
};

// Chuẩn hóa lỗi mạng khi gọi GHN thành GhnError dễ xử lý ở tầng trên.
const normalizeGhnNetworkError = (error) => {
  const code = error?.cause?.code || error?.code || "";
  const message = String(error?.message || "");
  const isTimeout =
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "ETIMEDOUT" ||
    message.toLowerCase().includes("timeout");

  return new GhnError(
    isTimeout
      ? "Khong the ket noi GHN do qua thoi gian cho. Vui long thu lai sau hoac tat GHN neu chi tao don noi bo."
      : "Khong the ket noi dich vu GHN. Vui long kiem tra mang hoac cau hinh GHN.",
    {
      status: 503,
      details: {
        code: code || "GHN_NETWORK_ERROR",
      },
    }
  );
};

module.exports = {
  buildQueryString,
  normalizeGhnNetworkError,
  toPositiveNumber,
  unwrapGhnPayload,
};
