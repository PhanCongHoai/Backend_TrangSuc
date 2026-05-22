const jwt = require("jsonwebtoken");
const { poolPromise, sql } = require("../../config/db");

const MAX_CHAT_IMAGE_DATA_URL_LENGTH = 6 * 1024 * 1024;

// Lấy JWT secret dùng cho các luồng xác thực trong chat.
const getJwtSecret = () =>
  process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;

// Tạo object lỗi xác thực chat có đầy đủ status và code nội bộ.
const createChatAuthError = (status, code, message) => {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
};

// Kiểm tra một error có phải lỗi xác thực chat để xử lý riêng hay không.
const isChatAuthError = (error) =>
  error?.code === "TOKEN_EXPIRED" ||
  error?.code === "INVALID_TOKEN" ||
  error?.code === "ACCOUNT_BLOCKED" ||
  error?.code === "USER_NOT_FOUND";

// Trả lỗi xác thực chat về client theo cấu trúc response thống nhất.
const sendChatAuthError = (res, error) =>
  res.status(error.status || 401).json({
    success: false,
    code: error.code || "INVALID_TOKEN",
    message: error.message || "Phiên đăng nhập không hợp lệ.",
  });

// Định dạng thời gian tin nhắn thành nhãn hiển thị ngắn gọn.
const formatDateTime = (value) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");

  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} ${pad(
    date.getUTCDate()
  )}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
};

// Kiểm tra và chuẩn hóa URL hoặc data URL ảnh gửi trong chat.
const normalizeChatImageUrl = (imageUrl) => {
  const normalizedImageUrl = String(imageUrl || "").trim();

  if (!normalizedImageUrl) {
    return null;
  }

  if (normalizedImageUrl.length > MAX_CHAT_IMAGE_DATA_URL_LENGTH) {
    throw new Error("Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn.");
  }

  const isAllowedDataImage = /^data:image\/(png|jpe?g|gif|webp);base64,/i.test(
    normalizedImageUrl
  );
  const isAllowedRemoteImage = /^https?:\/\/\S+/i.test(normalizedImageUrl);

  if (!isAllowedDataImage && !isAllowedRemoteImage) {
    throw new Error("Định dạng ảnh không hợp lệ.");
  }

  return normalizedImageUrl;
};

// Giải mã token và nạp người dùng hiện tại để dùng cho chat đã đăng nhập.
const resolveUserFromToken = async (token) => {
  if (!token) {
    return null;
  }

  const jwtSecret = getJwtSecret();

  if (!jwtSecret) {
    throw new Error("JWT secret is missing. Please set JWT_SECRET.");
  }

  let decoded;

  try {
    decoded = jwt.verify(token, jwtSecret);
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      throw createChatAuthError(
        401,
        "TOKEN_EXPIRED",
        "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục."
      );
    }

    throw createChatAuthError(
      401,
      "INVALID_TOKEN",
      "Phiên đăng nhập không hợp lệ. Vui lòng đăng nhập lại."
    );
  }

  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("UserId", sql.Int, Number(decoded.sub))
    .query(`
      SELECT
        u.id,
        u.username,
        u.email,
        u.is_active,
        u.block_reason,
        r.role_name,
        profile.full_name
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      WHERE u.id = @UserId
    `);

  const user = result.recordset[0];

  if (!user) {
    throw createChatAuthError(
      401,
      "USER_NOT_FOUND",
      "Tài khoản không còn tồn tại. Vui lòng đăng nhập lại."
    );
  }

  if (Number(user.is_active) !== 1) {
    const blockReason = String(user.block_reason || "").trim();
    throw createChatAuthError(
      403,
      "ACCOUNT_BLOCKED",
      blockReason
        ? `Tài khoản của bạn đã bị chặn. Lý do: ${blockReason}`
        : "Tài khoản của bạn đã bị chặn. Vui lòng liên hệ quản trị viên để được hỗ trợ."
    );
  }

  return {
    id: Number(user.id),
    role: String(user.role_name || ""),
    username: user.username,
    email: user.email,
    fullName: user.full_name || null,
  };
};

// Xác định actor chat từ request, hỗ trợ cả user đăng nhập và khách vãng lai.
const getActorFromRequest = async (req) => {
  const authorization = req.headers.authorization || "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  const queryToken = String(req.query.token || "").trim();
  const token = bearerToken || queryToken;

  const user = await resolveUserFromToken(token);

  if (user) {
    return {
      type: "user",
      user,
      guestKey: null,
      guestName: user.fullName || user.username || user.email || "Khách hàng",
    };
  }

  const guestKey = String(req.query.guestKey || req.body?.guestKey || "").trim();
  const guestName = String(req.query.guestName || req.body?.guestName || "").trim();

  if (!guestKey) {
    return null;
  }

  return {
    type: "guest",
    user: null,
    guestKey,
    guestName: guestName || "Khách hàng",
  };
};

module.exports = {
  formatDateTime,
  getActorFromRequest,
  isChatAuthError,
  normalizeChatImageUrl,
  sendChatAuthError,
};
