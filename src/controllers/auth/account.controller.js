const bcrypt = require("bcrypt");
const { sql, poolPromise } = require("../../config/db");
const {
  buildAccessToken,
  buildBlockedAccountMessage,
  isValidEmail,
  mapAuthResponse,
} = require("./shared");

// Đăng ký tài khoản mới bằng email và mật khẩu thông qua stored procedure.
const register = async (req, res) => {
  try {
    const { fullName, email, password, confirmPassword } = req.body;

    if (!fullName || !email || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required fields.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Password confirmation does not match.",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format.",
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("FullName", sql.NVarChar(150), fullName.trim())
      .input("Email", sql.VarChar(150), email.trim())
      .input("PasswordHash", sql.VarChar(255), passwordHash)
      .execute("sp_RegisterUser");

    const data = result.recordset[0];

    if (!data.Success) {
      return res.status(400).json({
        success: false,
        message: data.Message,
      });
    }

    return res.status(201).json({
      success: true,
      message: data.Message,
      userId: data.UserId,
    });
  } catch (error) {
    console.error("Register error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Đăng nhập tài khoản mật khẩu, kiểm tra trạng thái hoạt động và trả về JWT.
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Please provide email and password.",
      });
    }

    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("Email", sql.VarChar(150), email.trim())
      .execute("sp_LoginUser");

    const user = result.recordset[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Email not found.",
      });
    }

    if (Number(user.is_active) !== 1) {
      let blockReason = user.block_reason || "";

      if (!blockReason && user.id) {
        const blockInfoResult = await pool
          .request()
          .input("UserId", sql.Int, Number(user.id))
          .query(`
            SELECT block_reason
            FROM users
            WHERE id = @UserId
          `);

        blockReason = blockInfoResult.recordset[0]?.block_reason || "";
      }

      return res.status(403).json({
        success: false,
        code: "ACCOUNT_BLOCKED",
        message: buildBlockedAccountMessage(blockReason),
        reason: blockReason || null,
      });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Incorrect password.",
      });
    }

    const accessToken = buildAccessToken(user);

    return res.status(200).json(mapAuthResponse(user, accessToken));
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  login,
  register,
};
