const nodemailer = require("nodemailer");

const PASSWORD_RESET_EXPIRES_MINUTES = 30;

// Đọc và chuẩn hóa cấu hình SMTP từ biến môi trường để gửi email hệ thống.
const getMailConfig = () => {
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const host = String(process.env.SMTP_HOST || "smtp.gmail.com").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").trim().toLowerCase() === "true" ||
    port === 465;

  return {
    host,
    port,
    secure,
    user,
    pass,
    from:
      String(process.env.SMTP_FROM || "").trim() ||
      (user ? `"JewelryBook" <${user}>` : ""),
  };
};

// Kiểm tra cấu hình SMTP đã đủ trước khi tạo transporter gửi mail.
const assertMailConfigured = () => {
  const config = getMailConfig();

  if (!config.user || !config.pass || !config.from) {
    const error = new Error(
      "Chưa cấu hình SMTP Gmail. Hãy thêm SMTP_USER, SMTP_PASS và SMTP_FROM vào backend/.env."
    );
    error.status = 500;
    throw error;
  }

  return config;
};

// Escape các ký tự HTML đặc biệt trước khi chèn dữ liệu người dùng vào email.
const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

// Tạo nội dung HTML cho email đặt lại mật khẩu theo giao diện thương hiệu.
const buildPasswordResetHtml = ({ displayName, resetUrl }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeUrl = escapeHtml(resetUrl);

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Cập nhật mật khẩu JewelryBook</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Yêu cầu cập nhật mật khẩu</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:24px;line-height:1.3;color:#ffffff;">Cập nhật mật khẩu của bạn</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName}, JewelryBook vừa nhận yêu cầu đặt lại mật khẩu cho tài khoản này.</p>
                    <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#ded8c7;">Nhấn nút bên dưới để mở giao diện cập nhật mật khẩu. Liên kết có hiệu lực trong ${PASSWORD_RESET_EXPIRES_MINUTES} phút và chỉ dùng được một lần.</p>
                    <a href="${safeUrl}" style="display:inline-block;background:#d4af37;color:#0f0f0d;text-decoration:none;font-weight:800;border-radius:6px;padding:14px 20px;">Cập nhật mật khẩu</a>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Nếu nút không hoạt động, hãy mở liên kết này trong trình duyệt:</p>
                    <p style="word-break:break-all;margin:8px 0 0;font-size:13px;line-height:1.6;color:#f2c84b;">${safeUrl}</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Nếu bạn không yêu cầu đổi mật khẩu, hãy bỏ qua email này.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
};

// Gửi email đặt lại mật khẩu tới người dùng bằng cấu hình SMTP đã khai báo.
const sendPasswordResetEmail = async ({ to, displayName, resetUrl }) => {
  const config = assertMailConfigured();
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  await transporter.sendMail({
    from: config.from,
    to,
    subject: "Cập nhật mật khẩu JewelryBook",
    text: [
      `Xin chào ${displayName || "bạn"},`,
      "Bạn vừa yêu cầu cập nhật mật khẩu JewelryBook.",
      `Mở liên kết sau trong ${PASSWORD_RESET_EXPIRES_MINUTES} phút: ${resetUrl}`,
      "Nếu bạn không yêu cầu, hãy bỏ qua email này.",
    ].join("\n\n"),
    html: buildPasswordResetHtml({ displayName, resetUrl }),
  });
};

module.exports = {
  PASSWORD_RESET_EXPIRES_MINUTES,
  sendPasswordResetEmail,
};
