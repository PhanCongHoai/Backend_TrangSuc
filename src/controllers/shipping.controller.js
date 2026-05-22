const {
  GhnError,
  calculateFee,
  cancelOrder,
  createOrder,
  getDistricts,
  getOrderDetail,
  getProvinces,
  getPublicConfig,
  getWards,
} = require("../services/ghn.service");

// Chuyển dữ liệu đầu vào thành số nguyên dương hợp lệ.
const toPositiveInteger = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.floor(parsedValue);
};

// Trả lỗi theo chuẩn chung cho toàn bộ controller vận chuyển.
const handleError = (res, error) => {
  if (error instanceof GhnError) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      details: error.details || null,
    });
  }

  console.error("Shipping controller error:", error);

  return res.status(500).json({
    success: false,
    message: "Server error.",
  });
};

// Trả về cấu hình tích hợp GHN hiện tại.
const getShippingConfig = async (req, res) => {
  try {
    return res.status(200).json({
      success: true,
      data: getPublicConfig(),
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Lấy danh sách tỉnh/thành từ GHN.
const getShippingProvinces = async (req, res) => {
  try {
    const data = await getProvinces();

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Lấy danh sách quận/huyện theo tỉnh/thành từ GHN.
const getShippingDistricts = async (req, res) => {
  try {
    const provinceId = toPositiveInteger(req.query.province_id);

    if (!provinceId) {
      throw new GhnError("province_id la bat buoc.", { status: 400 });
    }

    const data = await getDistricts(provinceId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Lấy danh sách phường/xã theo quận/huyện từ GHN.
const getShippingWards = async (req, res) => {
  try {
    const districtId = toPositiveInteger(req.query.district_id);

    if (!districtId) {
      throw new GhnError("district_id la bat buoc.", { status: 400 });
    }

    const data = await getWards(districtId);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Tính phí giao hàng GHN dựa trên payload frontend gửi lên.
const calculateShippingFee = async (req, res) => {
  try {
    const data = await calculateFee(req.body || {});

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Tạo đơn vận chuyển GHN trực tiếp từ request hiện tại.
const createShippingOrder = async (req, res) => {
  try {
    const data = await createOrder(req.body || {});

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Lấy chi tiết đơn vận chuyển GHN theo mã đơn.
const getShippingOrderDetail = async (req, res) => {
  try {
    const orderCode = String(req.query.order_code || "").trim();
    const data = await getOrderDetail(orderCode);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Hủy một hoặc nhiều đơn vận chuyển GHN.
const cancelShippingOrder = async (req, res) => {
  try {
    const data = await cancelOrder(req.body?.order_codes || []);

    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    return handleError(res, error);
  }
};

module.exports = {
  calculateShippingFee,
  cancelShippingOrder,
  createShippingOrder,
  getShippingConfig,
  getShippingDistricts,
  getShippingOrderDetail,
  getShippingProvinces,
  getShippingWards,
};
