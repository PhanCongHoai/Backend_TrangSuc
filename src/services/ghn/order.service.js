const { ghnRequest } = require("./client");
const { GhnError } = require("./error");
const {
  assertCreateOrderPayload,
  buildCalculateFeePayload,
  mergeCreateOrderPayload,
} = require("./payload");

// Tính phí vận chuyển GHN dựa trên địa chỉ và thông số kiện hàng.
const calculateFee = (payload = {}) =>
  ghnRequest({
    method: "POST",
    path: "/v2/shipping-order/fee",
    body: buildCalculateFeePayload(payload),
  });

// Tạo đơn vận chuyển GHN sau khi đã chuẩn hóa và kiểm tra payload đầu vào.
const createOrder = async (payload = {}) => {
  const requestBody = mergeCreateOrderPayload(payload);
  assertCreateOrderPayload(requestBody);

  return ghnRequest({
    method: "POST",
    path: "/v2/shipping-order/create",
    body: requestBody,
  });
};

// Lấy chi tiết một đơn GHN theo mã vận đơn.
const getOrderDetail = (orderCode) => {
  if (!String(orderCode || "").trim()) {
    throw new GhnError("order_code la bat buoc.", { status: 400 });
  }

  return ghnRequest({
    path: "/v2/shipping-order/detail",
    query: {
      order_code: orderCode,
    },
  });
};

// Hủy một hoặc nhiều đơn GHN theo danh sách mã vận đơn.
const cancelOrder = (orderCodes = []) => {
  if (!Array.isArray(orderCodes) || orderCodes.length === 0) {
    throw new GhnError("order_codes phai la mang khong rong.", { status: 400 });
  }

  return ghnRequest({
    method: "POST",
    path: "/v2/switch-status/cancel",
    body: {
      order_codes: orderCodes,
    },
  });
};

module.exports = {
  calculateFee,
  cancelOrder,
  createOrder,
  getOrderDetail,
};
