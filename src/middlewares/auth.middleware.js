const jwt = require("jsonwebtoken");
const { poolPromise, sql } = require("../config/db");

// Lấy secret dùng để ký và xác thực access token.
const getJwtSecret = () =>
  process.env.JWT_SECRET || process.env.JWT_ACCESS_SECRET;

// Tạo thông báo tài khoản bị chặn nhất quán để trả về cho frontend.
const buildBlockedAccountMessage = (reason) => {
  const normalizedReason = String(reason || "").trim();

  if (!normalizedReason) {
    return "Tài khoản của bạn đã bị chặn. Vui lòng liên hệ quản trị viên để được hỗ trợ.";
  }

  return `Tài khoản của bạn đã bị chặn. Lý do: ${normalizedReason}`;
};

// Xác thực access token, nạp thông tin user hiện tại và gắn vào req.user.
const authenticateAccessToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Missing or invalid Authorization header.",
    });
  }

  const token = authHeader.slice(7);
  const jwtSecret = getJwtSecret();

  if (!jwtSecret) {
    return res.status(500).json({
      success: false,
      message: "JWT secret is missing. Please set JWT_SECRET.",
    });
  }

  try {
    const decoded = jwt.verify(token, jwtSecret);
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
          profile.full_name,
          profile.phone
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN user_profiles profile ON profile.user_id = u.id
        WHERE u.id = @UserId
      `);

    const user = result.recordset[0];

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User account no longer exists.",
      });
    }

    if (Number(user.is_active) !== 1) {
      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BLOCKED",
        message: buildBlockedAccountMessage(user.block_reason),
        reason: user.block_reason || null,
      });
    }

    req.user = {
      sub: user.id,
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.full_name || null,
      phone: user.phone || null,
      role: user.role_name,
      authProvider: "password",
    };
    return next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        code: "TOKEN_EXPIRED",
        message: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để tiếp tục.",
      });
    }

    return res.status(401).json({
      success: false,
      code: "INVALID_TOKEN",
      message: "Token is invalid or expired.",
    });
  }
};

// EventSource không gửi được Authorization header tùy biến nên cho phép
// truyền access token qua query string ở các route stream nội bộ.
const authenticateAccessTokenFlexible = async (req, res, next) => {
  if (!req.headers.authorization) {
    const queryToken = String(req.query?.access_token || "").trim();

    if (queryToken) {
      req.headers.authorization = `Bearer ${queryToken}`;
    }
  }

  return authenticateAccessToken(req, res, next);
};

// Tạo middleware kiểm tra vai trò truy cập cho từng nhóm route.
const authorizeRoles = (...allowedRoles) => (req, res, next) => {
  // Chuẩn hóa danh sách role được phép về chữ thường để so sánh nhất quán.
  const currentRole = String(req.user?.role || "").toLowerCase();
  const normalizedAllowedRoles = allowedRoles.map((r) => r.toLowerCase());

  if (!normalizedAllowedRoles.includes(currentRole)) {
    return res.status(403).json({
      success: false,
      message: "You do not have permission to access this resource.",
    });
  }

  return next();
};

module.exports = {
  authenticateAccessToken,
  authenticateAccessTokenFlexible,
  authorizeRoles,
};
