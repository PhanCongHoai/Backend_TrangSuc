const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { sql, poolPromise } = require("../../config/db");
const {
  PASSWORD_RESET_EXPIRES_MINUTES,
  sendPasswordResetEmail,
} = require("../../services/mail.service");
const { getFrontendUrl } = require("./shared");

// Băm token reset mật khẩu để chỉ lưu giá trị an toàn trong database.
const hashPasswordResetToken = (token) =>
  crypto.createHash("sha256").update(String(token || "")).digest("hex");

// Dựng URL reset mật khẩu hoàn chỉnh để gửi qua email cho người dùng.
const buildPasswordResetUrl = (token) => {
  const resetUrl = new URL("/reset-password", getFrontendUrl());
  resetUrl.searchParams.set("token", token);
  return resetUrl.toString();
};

// Bảo đảm bảng và index phục vụ luồng reset mật khẩu đã tồn tại trong SQL Server.
const ensurePasswordResetSchema = async () => {
  const pool = await poolPromise;
  await pool.request().query(`
    IF OBJECT_ID('dbo.password_reset_tokens', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.password_reset_tokens (
        id INT IDENTITY(1,1) PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        used_at DATETIME NULL,
        created_at DATETIME NOT NULL CONSTRAINT DF_password_reset_tokens_created_at DEFAULT GETDATE(),
        CONSTRAINT FK_password_reset_tokens_users
          FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
      );
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'UX_password_reset_tokens_token_hash'
        AND object_id = OBJECT_ID('dbo.password_reset_tokens')
    )
    BEGIN
      CREATE UNIQUE INDEX UX_password_reset_tokens_token_hash
      ON dbo.password_reset_tokens(token_hash);
    END;

    IF NOT EXISTS (
      SELECT 1
      FROM sys.indexes
      WHERE name = 'IX_password_reset_tokens_user_id'
        AND object_id = OBJECT_ID('dbo.password_reset_tokens')
    )
    BEGIN
      CREATE INDEX IX_password_reset_tokens_user_id
      ON dbo.password_reset_tokens(user_id, expires_at);
    END;
  `);
};

// Lấy bản ghi reset mật khẩu theo token gốc mà người dùng gửi lên.
const getPasswordResetRecord = async (token) => {
  const tokenHash = hashPasswordResetToken(token);
  const pool = await poolPromise;
  const result = await pool
    .request()
    .input("TokenHash", sql.Char(64), tokenHash)
    .query(`
      SELECT TOP 1
        reset.id,
        reset.user_id,
        reset.expires_at,
        reset.used_at,
        u.email,
        u.username,
        u.is_active,
        profile.full_name
      FROM password_reset_tokens reset
      INNER JOIN users u ON u.id = reset.user_id
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      WHERE reset.token_hash = @TokenHash
    `);

  return result.recordset[0] || null;
};

// Kiểm tra token reset còn hiệu lực, chưa dùng và thuộc tài khoản đang hoạt động.
const isPasswordResetRecordUsable = (record) =>
  Boolean(
    record &&
      !record.used_at &&
      Number(record.is_active) === 1 &&
      new Date(record.expires_at).getTime() > Date.now()
  );

// Tìm người dùng đang hoạt động theo email để phát hành link reset mật khẩu.
const findActiveUserByEmail = async (email) => {
  const pool = await poolPromise;
  const userResult = await pool
    .request()
    .input("Email", sql.VarChar(150), email)
    .query(`
      SELECT TOP 1
        u.id,
        u.username,
        u.email,
        u.is_active,
        profile.full_name
      FROM users u
      LEFT JOIN user_profiles profile ON profile.user_id = u.id
      WHERE LOWER(u.email) = @Email
    `);

  return userResult.recordset[0] || null;
};

// Phát hành token reset mới, vô hiệu token cũ và gửi email cho người dùng.
const issuePasswordReset = async (user) => {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashPasswordResetToken(rawToken);
  const pool = await poolPromise;

  await pool
    .request()
    .input("UserId", sql.Int, Number(user.id))
    .input("TokenHash", sql.Char(64), tokenHash)
    .input("ExpiresMinutes", sql.Int, PASSWORD_RESET_EXPIRES_MINUTES)
    .query(`
      UPDATE password_reset_tokens
      SET used_at = ISNULL(used_at, GETDATE())
      WHERE user_id = @UserId
        AND used_at IS NULL;

      INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
      VALUES (
        @UserId,
        @TokenHash,
        DATEADD(MINUTE, @ExpiresMinutes, GETDATE())
      );
    `);

  await sendPasswordResetEmail({
    to: user.email,
    displayName: user.full_name || user.username || user.email,
    resetUrl: buildPasswordResetUrl(rawToken),
  });
};

// Cập nhật mật khẩu mới từ bản ghi reset hợp lệ và đánh dấu token đã dùng.
const updatePasswordFromResetRecord = async ({ record, password }) => {
  const passwordHash = await bcrypt.hash(password, 10);
  const pool = await poolPromise;

  await pool
    .request()
    .input("UserId", sql.Int, Number(record.user_id))
    .input("ResetTokenId", sql.Int, Number(record.id))
    .input("PasswordHash", sql.VarChar(255), passwordHash)
    .query(`
      UPDATE users
      SET password_hash = @PasswordHash
      WHERE id = @UserId;

      UPDATE password_reset_tokens
      SET used_at = GETDATE()
      WHERE id = @ResetTokenId;
    `);
};

module.exports = {
  ensurePasswordResetSchema,
  findActiveUserByEmail,
  getPasswordResetRecord,
  isPasswordResetRecordUsable,
  issuePasswordReset,
  updatePasswordFromResetRecord,
};
