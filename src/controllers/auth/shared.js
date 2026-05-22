const jwt = require("jsonwebtoken");

const ACCESS_TOKEN_EXPIRES_IN = "2h";
const MIN_PASSWORD_LENGTH = 6;
const DEFAULT_BLOCKED_ACCOUNT_MESSAGE =
  "Tài khoản của bạn đã bị chặn. Vui lòng liên hệ quản trị viên để được hỗ trợ.";

// Lấy secret dùng để ký và xác thực JWT của luồng đăng nhập mật khẩu.
const getJwtSecret = () =>
  process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;

// Trả về URL frontend chuẩn hóa để xây link điều hướng từ email hoặc API.
const getFrontendUrl = () =>
  String(process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/+$/, "");

// Kiểm tra chuỗi email có đúng định dạng cơ bản trước khi xử lý sâu hơn.
const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));

// Tạo thông báo tài khoản bị chặn, có đính kèm lý do nếu hệ thống đang lưu.
const buildBlockedAccountMessage = (reason) => {
  const normalizedReason = String(reason || "").trim();

  if (!normalizedReason) {
    return DEFAULT_BLOCKED_ACCOUNT_MESSAGE;
  }

  return `Tài khoản của bạn đã bị chặn. Lý do: ${normalizedReason}`;
};

// Validate cặp mật khẩu mới và xác nhận mật khẩu cho các luồng reset hoặc đổi mật khẩu.
const validatePasswordPayload = (password, confirmPassword) => {
  if (!password || !confirmPassword) {
    return "Vui lòng nhập mật khẩu mới và xác nhận mật khẩu.";
  }

  if (password !== confirmPassword) {
    return "Mật khẩu xác nhận không khớp.";
  }

  if (String(password).length < MIN_PASSWORD_LENGTH) {
    return `Mật khẩu phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  }

  return "";
};

// Tạo access token chuẩn cho người dùng sau khi đăng nhập thành công.
const buildAccessToken = (user, options = {}) => {
  const jwtSecret = getJwtSecret();
  const effectiveRole = options.roleName || user.role_name;

  if (!jwtSecret) {
    throw new Error("JWT secret is missing. Please set JWT_SECRET.");
  }

  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      email: user.email,
      role: effectiveRole,
      authProvider: "password",
    },
    jwtSecret,
    { expiresIn: ACCESS_TOKEN_EXPIRES_IN }
  );
};

// Ánh xạ dữ liệu người dùng sang response đăng nhập thống nhất cho frontend.
const mapAuthResponse = (
  user,
  accessToken,
  message = "Login successful.",
  options = {}
) => ({
  success: true,
  message,
  accessToken,
  tokenType: "Bearer",
  expiresIn: 7200,
  user: {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.full_name,
    phone: user.phone,
    roleName: options.roleName || user.role_name,
    authProvider: "password",
  },
});

module.exports = {
  buildAccessToken,
  buildBlockedAccountMessage,
  getFrontendUrl,
  getJwtSecret,
  isValidEmail,
  mapAuthResponse,
  validatePasswordPayload,
};
