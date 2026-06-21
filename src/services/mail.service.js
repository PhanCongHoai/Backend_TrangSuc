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

// Tạo nội dung HTML cho email thông báo khóa tài khoản.
const buildAccountBlockedHtml = ({ displayName, blockReason }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeReason = escapeHtml(blockReason);

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Tài khoản JewelryBook bị khóa</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Thông báo quan trọng về tài khoản</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ff4d4d;">Tài khoản của bạn đã bị chặn / khóa</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Chúng tôi rất tiếc phải thông báo rằng tài khoản của bạn trên hệ thống <strong>JewelryBook</strong> đã bị chặn hoạt động tạm thời.</p>
                    <div style="margin:20px 0;padding:16px;background:rgba(255,77,77,0.1);border-left:4px solid #ff4d4d;border-radius:4px;">
                      <strong style="display:block;margin-bottom:8px;color:#ffffff;font-size:15px;">Lý do khóa:</strong>
                      <p style="margin:0;font-size:14px;line-height:1.6;color:#ded8c7;white-space:pre-wrap;">${safeReason}</p>
                    </div>
                    <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#ded8c7;">Nếu bạn tin rằng đây là một sự nhầm lẫn hoặc muốn được giải quyết để mở lại tài khoản, vui lòng phản hồi trực tiếp email này hoặc liên hệ bộ phận hỗ trợ khách hàng của chúng tôi.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

// Gửi email thông báo khóa tài khoản.
const sendAccountBlockedEmail = async ({ to, displayName, blockReason }) => {
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
    subject: "Thông báo khóa tài khoản JewelryBook",
    text: [
      `Xin chào ${displayName || "bạn"},`,
      "Tài khoản của bạn trên hệ thống JewelryBook đã bị chặn.",
      `Lý do: ${blockReason}`,
      "Vui lòng liên hệ quản trị viên để biết thêm chi tiết.",
    ].join("\n\n"),
    html: buildAccountBlockedHtml({ displayName, blockReason }),
  });
};

// Tạo nội dung HTML cho email thông báo mở khóa tài khoản.
const buildAccountUnblockedHtml = ({ displayName }) => {
  const safeName = escapeHtml(displayName || "bạn");

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Tài khoản JewelryBook đã được mở khóa</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Thông báo quan trọng về tài khoản</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#2ecc71;">Tài khoản của bạn đã được mở khóa</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Chúng tôi xin vui mừng thông báo rằng tài khoản của bạn trên hệ thống <strong>JewelryBook</strong> đã được mở khóa hoạt động trở lại.</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Giờ đây bạn đã có thể đăng nhập, đặt mua sản phẩm và sử dụng mọi dịch vụ của chúng tôi bình thường.</p>
                    <a href="${String(process.env.FRONTEND_URL || "http://localhost:3000").trim()}/login" style="display:inline-block;background:#2ecc71;color:#ffffff;text-decoration:none;font-weight:800;border-radius:6px;padding:12px 20px;margin-top:10px;">Đăng nhập ngay</a>
                    <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#ded8c7;">Nếu bạn gặp bất kỳ vấn đề gì khi đăng nhập lại, vui lòng phản hồi email này hoặc liên hệ bộ phận hỗ trợ khách hàng của chúng tôi để được xử lý nhanh chóng.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

// Gửi email thông báo mở khóa tài khoản.
const sendAccountUnblockedEmail = async ({ to, displayName }) => {
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
    subject: "Thông báo mở khóa tài khoản JewelryBook",
    text: [
      `Xin chào ${displayName || "bạn"},`,
      "Tài khoản của bạn trên hệ thống JewelryBook đã được mở khóa hoạt động trở lại.",
      "Bạn đã có thể đăng nhập bình thường.",
    ].join("\n\n"),
    html: buildAccountUnblockedHtml({ displayName }),
  });
};


// Tạo nội dung HTML cho email thông báo nhận phiếu khuyến mãi mới.
const buildPromotionNotificationHtml = ({ displayName, promoCode, promoName, minOrder, discountDesc }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeCode = escapeHtml(promoCode);
  const safePromoName = escapeHtml(promoName);
  const safeMinOrder = escapeHtml(minOrder);
  const safeDesc = escapeHtml(discountDesc);
  const loginUrl = `${String(process.env.FRONTEND_URL || "http://localhost:3000").trim()}/login`;

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bạn nhận được ưu đãi mới từ JewelryBook</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Phiếu quà tặng ưu đãi độc quyền</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ffffff;">Chúc mừng! Bạn nhận được một phiếu khuyến mãi mới</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Chúng tôi xin gửi tặng bạn một mã ưu đãi mua sắm trang sức đặc biệt từ <strong>JewelryBook</strong>:</p>
                    
                    <div style="margin:20px 0;padding:20px;background:#1a1711;border:1px dashed #d4af37;border-radius:8px;text-align:center;">
                      <div style="font-size:14px;color:#a9a18c;margin-bottom:8px;text-transform:uppercase;letter-spacing:1px;">Mã Khuyến Mãi</div>
                      <div style="font-size:28px;font-weight:800;color:#f2c84b;letter-spacing:2px;margin-bottom:10px;">${safeCode}</div>
                      <div style="font-size:16px;color:#ffffff;font-weight:bold;margin-bottom:6px;">${safePromoName}</div>
                      <div style="font-size:14px;color:#ded8c7;">Chi tiết: Giảm ${safeDesc} cho đơn hàng từ ${safeMinOrder}</div>
                    </div>

                    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#ff5b5b;font-weight:bold;">* Lưu ý quan trọng: Để sử dụng phiếu khuyến mãi này, bạn cần nhấn Nhận phiếu trong tài khoản để kích hoạt.</p>
                    
                    <a href="${loginUrl}" style="display:inline-block;background:#d4af37;color:#0f0f0d;text-decoration:none;font-weight:800;border-radius:6px;padding:12px 24px;margin-top:10px;">Vào nhận phiếu ngay</a>
                    
                    <p style="margin:24px 0 0;font-size:14px;line-height:1.7;color:#ded8c7;">Cảm ơn bạn đã đồng hành cùng JewelryBook. Chúc bạn có những trải nghiệm mua sắm tuyệt vời!</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

// Gửi email thông báo nhận phiếu khuyến mãi mới.
const sendPromotionNotificationEmail = async ({ to, displayName, promoCode, promoName, minOrder, discountDesc }) => {
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
    subject: `Bạn nhận được mã ưu đãi mới từ JewelryBook [${promoCode}]`,
    text: [
      `Xin chào ${displayName || "bạn"},`,
      `JewelryBook xin tặng bạn mã ưu đãi mới: ${promoCode}`,
      `Chương trình: ${promoName}`,
      `Chi tiết: Giảm ${discountDesc} cho đơn từ ${minOrder}`,
      `Vui lòng đăng nhập vào tài khoản và nhận phiếu khuyến mãi để kích hoạt sử dụng.`,
      `Trân trọng, Đội ngũ JewelryBook.`
    ].join("\n\n"),
    html: buildPromotionNotificationHtml({ displayName, promoCode, promoName, minOrder, discountDesc }),
  });
};

const buildOrderCancelledHtml = ({ displayName, internalCode }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeCode = escapeHtml(internalCode);

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hủy đơn hàng thành công tại JewelryBook</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Thông báo cập nhật đơn hàng</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ff5b5b;">Đơn hàng #${safeCode} đã được hủy</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Hệ thống xác nhận đơn hàng mang mã số <strong>${safeCode}</strong> của bạn đã được hủy thành công theo yêu cầu.</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Nếu đây là đơn hàng đã được thanh toán trước qua chuyển khoản ngân hàng, bộ phận chăm sóc khách hàng của chúng tôi sẽ liên hệ với bạn để thực hiện thủ tục hoàn tiền trong thời gian sớm nhất.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Cảm ơn bạn đã quan tâm đến JewelryBook. Hy vọng sẽ được phục vụ bạn tốt hơn ở những đơn hàng sau.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

const buildOrderRefundedHtml = ({ displayName, internalCode, amount, bankName, accountNumber }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeCode = escapeHtml(internalCode);
  const safeAmount = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount || 0));
  const safeBank = escapeHtml(bankName);
  const safeAccount = escapeHtml(accountNumber);

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Hoàn tiền thành công đơn hàng #${safeCode}</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Thông báo hoàn tiền đơn hàng</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#2ecc71;">Hoàn tiền thành công!</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Chúng tôi xin thông báo đã thực hiện hoàn tiền thành công cho yêu cầu hoàn trả đơn hàng <strong>#${safeCode}</strong> của bạn.</p>
                    
                    <div style="margin:20px 0;padding:20px;background:#1a1711;border:1px solid #2ecc71;border-radius:8px;">
                      <div style="font-size:14px;color:#a9a18c;margin-bottom:8px;text-transform:uppercase;">Thông tin giao dịch hoàn tiền</div>
                      <div style="font-size:15px;color:#ffffff;margin-bottom:6px;"><strong>Mã đơn hàng:</strong> #${safeCode}</div>
                      <div style="font-size:15px;color:#ffffff;margin-bottom:6px;"><strong>Số tiền hoàn trả:</strong> <span style="color:#f2c84b;font-weight:bold;">${safeAmount}</span></div>
                      <div style="font-size:15px;color:#ffffff;margin-bottom:6px;"><strong>Ngân hàng thụ hưởng:</strong> ${safeBank}</div>
                      <div style="font-size:15px;color:#ffffff;"><strong>Số tài khoản:</strong> ${safeAccount}</div>
                    </div>
                    
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Vui lòng kiểm tra tài khoản ngân hàng của bạn. Tiền hoàn trả thường sẽ được cập nhật ngay lập tức hoặc trong vòng 24-48 giờ tùy thuộc vào quy trình xử lý của từng ngân hàng.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Cảm ơn bạn đã luôn tin tưởng và đồng hành cùng JewelryBook.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

const sendOrderCancelledEmail = async ({ to, displayName, orderId, internalCode }) => {
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
    subject: `Thông báo hủy đơn hàng thành công #${internalCode}`,
    text: [
      `Xin chào ${displayName || "bạn"},`,
      `Đơn hàng #${internalCode} của bạn đã được hủy thành công trên hệ thống JewelryBook.`,
      `Nếu có bất kỳ thắc mắc nào, vui lòng liên hệ với chúng tôi để được giải đáp.`,
      `Trân trọng, Đội ngũ JewelryBook.`
    ].join("\n\n"),
    html: buildOrderCancelledHtml({ displayName, internalCode }),
  });
};

const sendOrderRefundedEmail = async ({ to, displayName, orderId, internalCode, amount, bankName, accountNumber }) => {
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

  const formattedAmount = new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount || 0));

  await transporter.sendMail({
    from: config.from,
    to,
    subject: `Xác nhận hoàn tiền thành công cho đơn hàng #${internalCode}`,
    text: [
      `Xin chào ${displayName || "bạn"},`,
      `Đơn hàng #${internalCode} của bạn đã được hoàn tiền thành công số tiền ${formattedAmount}.`,
      `Tài khoản nhận: ${bankName} - ${accountNumber}.`,
      `Trân trọng, Đội ngũ JewelryBook.`
    ].join("\n\n"),
    html: buildOrderRefundedHtml({ displayName, internalCode, amount, bankName, accountNumber }),
  });
};

const buildOrderRefundRejectedHtml = ({ displayName, internalCode, reason }) => {
  const safeName = escapeHtml(displayName || "bạn");
  const safeCode = escapeHtml(internalCode);
  const safeReason = escapeHtml(reason || "Không đáp ứng đủ điều kiện chính sách hoàn trả.");

  return `
    <!doctype html>
    <html lang="vi">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Yêu cầu hoàn trả đơn hàng #${safeCode} bị từ chối</title>
      </head>
      <body style="margin:0;background:#f4f0e6;font-family:Arial,Helvetica,sans-serif;color:#17140c;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f0e6;padding:28px 12px;">
          <tr>
            <td align="center">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#0f0f0d;border:1px solid #d4af37;border-radius:8px;overflow:hidden;">
                <tr>
                  <td style="padding:28px 30px;background:#17140c;border-bottom:1px solid rgba(212,175,55,.35);">
                    <div style="font-size:24px;font-weight:800;letter-spacing:2px;color:#f2c84b;">JEWELRYBOOK</div>
                    <div style="margin-top:6px;font-size:13px;color:#f7e7a3;">Thông báo từ chối hoàn trả đơn hàng</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:30px;">
                    <h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#ff5b5b;">Từ chối yêu cầu hoàn tiền</h1>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Xin chào ${safeName},</p>
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Chúng tôi rất tiếc phải thông báo rằng yêu cầu hoàn trả cho đơn hàng <strong>#${safeCode}</strong> của bạn không được chấp nhận.</p>
                    
                    <div style="margin:20px 0;padding:20px;background:#1a1711;border:1px solid #ff5b5b;border-radius:8px;">
                      <div style="font-size:14px;color:#a9a18c;margin-bottom:8px;text-transform:uppercase;">Chi tiết từ chối</div>
                      <div style="font-size:15px;color:#ffffff;margin-bottom:6px;"><strong>Mã đơn hàng:</strong> #${safeCode}</div>
                      <div style="font-size:15px;color:#ffffff;"><strong>Lý do từ chối:</strong> ${safeReason}</div>
                    </div>
                    
                    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;color:#ded8c7;">Nếu có bất kỳ thắc mắc nào hoặc muốn biết thêm chi tiết về quyết định này, vui lòng liên hệ bộ phận hỗ trợ khách hàng của chúng tôi bằng cách trả lời email này hoặc thông qua kênh chat trực tuyến trên hệ thống.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Cảm ơn bạn đã luôn đồng hành cùng JewelryBook.</p>
                    <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#a9a18c;">Trân trọng,<br/>Đội ngũ JewelryBook</p>
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

const sendOrderRefundRejectedEmail = async ({ to, displayName, orderId, internalCode, reason }) => {
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
    subject: `Từ chối yêu cầu hoàn tiền cho đơn hàng #${internalCode}`,
    text: [
      `Xin chào ${displayName || "bạn"},`,
      `Yêu cầu hoàn tiền cho đơn hàng #${internalCode} của bạn đã bị từ chối.`,
      `Lý do: ${reason || "Không đáp ứng đủ điều kiện chính sách hoàn trả."}`,
      `Trân trọng, Đội ngũ JewelryBook.`
    ].join("\n\n"),
    html: buildOrderRefundRejectedHtml({ displayName, internalCode, reason }),
  });
};

module.exports = {
  PASSWORD_RESET_EXPIRES_MINUTES,
  sendPasswordResetEmail,
  sendAccountBlockedEmail,
  sendAccountUnblockedEmail,
  sendPromotionNotificationEmail,
  sendOrderCancelledEmail,
  sendOrderRefundedEmail,
  sendOrderRefundRejectedEmail,
};
