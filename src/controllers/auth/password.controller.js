const {
  ensurePasswordResetSchema,
  findActiveUserByEmail,
  getPasswordResetRecord,
  isPasswordResetRecordUsable,
  issuePasswordReset,
  updatePasswordFromResetRecord,
} = require("./passwordReset.service");
const { isValidEmail, validatePasswordPayload } = require("./shared");

const PASSWORD_RESET_GENERIC_MESSAGE =
  "Nếu email tồn tại trong hệ thống, JewelryBook sẽ gửi liên kết cập nhật mật khẩu.";
const INVALID_PASSWORD_RESET_TOKEN_MESSAGE =
  "Liên kết cập nhật mật khẩu không hợp lệ hoặc đã hết hạn.";

// Nhận yêu cầu quên mật khẩu, phát hành token reset và gửi email nếu tài khoản hợp lệ.
const requestPasswordReset = async (req, res) => {
  try {
    await ensurePasswordResetSchema();

    const email = String(req.body?.email || "").trim().toLowerCase();

    if (!isValidEmail(email)) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập email hợp lệ.",
      });
    }

    const user = await findActiveUserByEmail(email);

    if (!user || Number(user.is_active) !== 1) {
      return res.status(200).json({
        success: true,
        message: PASSWORD_RESET_GENERIC_MESSAGE,
      });
    }

    await issuePasswordReset(user);

    return res.status(200).json({
      success: true,
      message: PASSWORD_RESET_GENERIC_MESSAGE,
    });
  } catch (error) {
    console.error("Request password reset error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Không thể gửi email cập nhật mật khẩu.",
    });
  }
};

// Kiểm tra token reset mật khẩu để frontend biết có thể mở form đặt lại hay không.
const verifyPasswordResetToken = async (req, res) => {
  try {
    await ensurePasswordResetSchema();

    const token = String(req.query?.token || "").trim();

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã cập nhật mật khẩu.",
      });
    }

    const record = await getPasswordResetRecord(token);

    if (!isPasswordResetRecordUsable(record)) {
      return res.status(400).json({
        success: false,
        message: INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
      });
    }

    return res.status(200).json({
      success: true,
      email: record.email,
      message: "Mã cập nhật mật khẩu hợp lệ.",
    });
  } catch (error) {
    console.error("Verify password reset token error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể kiểm tra mã cập nhật mật khẩu.",
    });
  }
};

// Đặt lại mật khẩu mới từ token hợp lệ và kết thúc vòng đời token đó.
const resetPassword = async (req, res) => {
  try {
    await ensurePasswordResetSchema();

    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");
    const confirmPassword = String(req.body?.confirmPassword || "");
    const passwordError = validatePasswordPayload(password, confirmPassword);

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Thiếu mã cập nhật mật khẩu.",
      });
    }

    if (passwordError) {
      return res.status(400).json({
        success: false,
        message: passwordError,
      });
    }

    const record = await getPasswordResetRecord(token);

    if (!isPasswordResetRecordUsable(record)) {
      return res.status(400).json({
        success: false,
        message: INVALID_PASSWORD_RESET_TOKEN_MESSAGE,
      });
    }

    await updatePasswordFromResetRecord({ record, password });

    return res.status(200).json({
      success: true,
      message: "Cập nhật mật khẩu thành công. Bạn có thể đăng nhập lại.",
    });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể cập nhật mật khẩu.",
    });
  }
};

module.exports = {
  requestPasswordReset,
  resetPassword,
  verifyPasswordResetToken,
};
