const { poolPromise, sql } = require("../config/db");
const { sendPromotionNotificationEmail } = require("../services/mail.service");

// Helper to format currency inside backend log/notification
const formatCurrencyVnd = (value) => {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
};

const sendPromotionChatNotification = async (userId, userFullName, promo) => {
  try {
    const { ensureChatSchema } = require("./chat/schema");
    await ensureChatSchema();

    const { ensureConversationForActor, postMessageToConversation } = require("./chat/service");

    const customerActor = {
      type: "user",
      user: {
        id: userId,
        role: "customer",
        fullName: userFullName || "Khách hàng",
      },
      guestKey: null,
      guestName: userFullName || "Khách hàng",
    };

    const conversation = await ensureConversationForActor(customerActor);

    const adminActor = {
      type: "user",
      user: {
        id: null,
        role: "admin",
        fullName: "Hệ thống",
      },
    };

    let discountDesc = "";
    if (promo.type === "percentage") {
      discountDesc = `${promo.discount_percent}%`;
    } else if (promo.type === "fixed") {
      discountDesc = formatCurrencyVnd(promo.discount_amount);
    } else {
      discountDesc = "Miễn phí vận chuyển";
    }

    const messageText = `🎁 Chúc mừng! Bạn đã nhận được một phiếu khuyến mãi mới từ cửa hàng:\n` +
      `• Mã ưu đãi: **${promo.code}**\n` +
      `• Nội dung: ${promo.name} (Giảm ${discountDesc})\n` +
      `• Đơn tối thiểu: ${formatCurrencyVnd(promo.min_order)}\n\n` +
      `👉 Hãy truy cập màn hình Thanh toán để bấm "Nhận phiếu" kích hoạt và áp dụng ưu đãi cho đơn hàng nhé!`;

    await postMessageToConversation({
      conversationId: conversation.id,
      actor: adminActor,
      message: messageText,
    });

    console.log(`Chat notification sent to customer ID ${userId} about promotion ${promo.code}`);
  } catch (err) {
    console.error(`Failed to send chat notification for promotion to user ${userId}:`, err);
  }
};

const notifyUsersAboutNewPromotion = async (usersList, promo) => {
  let discountDesc = "";
  if (promo.type === "percentage") {
    discountDesc = `${promo.discount_percent}%`;
  } else if (promo.type === "fixed") {
    discountDesc = formatCurrencyVnd(promo.discount_amount);
  } else {
    discountDesc = "Miễn phí vận chuyển";
  }
  const minOrderStr = formatCurrencyVnd(promo.min_order);

  for (const user of usersList) {
    // 1. Send Chat Notification (Instant local DB operation)
    try {
      if (user.id) {
        await sendPromotionChatNotification(user.id, user.full_name || user.username, promo);
      }
    } catch (chatErr) {
      console.error(`Failed to send promotion chat message to user ID ${user.id}:`, chatErr);
    }

    // 2. Send Email Notification (Slower network operation)
    try {
      if (user.email) {
        await sendPromotionNotificationEmail({
          to: user.email,
          displayName: user.full_name || user.username || "Khách hàng",
          promoCode: promo.code,
          promoName: promo.name,
          minOrder: minOrderStr,
          discountDesc: discountDesc,
        });
      }
    } catch (emailErr) {
      console.error(`Failed to send promotion email to ${user.email}:`, emailErr);
    }
  }
};

let isPromotionsSchemaReady = false;
let promotionsSchemaPromise = null;

const ensurePromotionsSchema = async () => {
  if (isPromotionsSchemaReady) return;
  if (promotionsSchemaPromise) return promotionsSchemaPromise;

  promotionsSchemaPromise = (async () => {
    try {
      const pool = await poolPromise;
      // 1. Tự động kiểm tra và tạo bảng user_promotions nếu chưa có
      await pool.request().query(`
        IF NOT EXISTS (SELECT * FROM sys.objects WHERE object_id = OBJECT_ID(N'[dbo].[user_promotions]') AND type in (N'U'))
        BEGIN
            CREATE TABLE [dbo].[user_promotions] (
                [id] INT IDENTITY(1,1) PRIMARY KEY,
                [user_id] INT NOT NULL,
                [promotion_id] INT NOT NULL,
                [is_used] BIT DEFAULT 0,
                [is_accepted] BIT DEFAULT 0,
                [assigned_at] DATETIME DEFAULT GETDATE(),
                [used_at] DATETIME NULL,
                CONSTRAINT [FK_user_promotions_users] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE,
                CONSTRAINT [FK_user_promotions_promotions] FOREIGN KEY ([promotion_id]) REFERENCES [dbo].[promotions]([id]) ON DELETE CASCADE
            );
        END
        ELSE
        BEGIN
            IF COL_LENGTH('[dbo].[user_promotions]', 'is_accepted') IS NULL
            BEGIN
                ALTER TABLE [dbo].[user_promotions] ADD [is_accepted] BIT DEFAULT 0;
                EXEC('UPDATE [dbo].[user_promotions] SET [is_accepted] = 1');
            END
        END
      `);

      // 2. Tự động seed các ưu đãi mẫu vào bảng promotions nếu bảng trống
      const promoCheck = await pool.request().query("SELECT COUNT(*) AS cnt FROM promotions");
      if (promoCheck.recordset[0]?.cnt === 0) {
        console.log("No promotions in DB, seeding default promotions...");
        await pool.request().query(`
          INSERT INTO promotions (code, name, type, min_order, discount_percent, discount_amount, free_shipping, is_active)
          VALUES 
          ('TIKTOK10', N'Giảm 10% đơn hàng', 'percentage', 0, 10.00, 0, 0, 1),
          ('DISCOUNT50', N'Giảm 50k cho đơn từ 200k', 'fixed', 200000, 0, 50000, 0, 1),
          ('FREESHIP', N'Miễn phí vận chuyển đơn từ 500k', 'free_shipping', 500000, 0, 0, 1, 1)
        `);
      }

      isPromotionsSchemaReady = true;
    } catch (err) {
      console.error("Failed to ensure promotions schema:", err);
      promotionsSchemaPromise = null;
      throw err;
    }
  })();

  return promotionsSchemaPromise;
};

// Lấy danh sách mã ưu đãi được gán riêng cho người dùng hiện tại và chưa sử dụng.
// Tự động khởi tạo bảng user_promotions và seed mã giảm giá mẫu nếu chưa có dữ liệu.
const getPromotions = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Bạn cần đăng nhập để lấy danh sách ưu đãi.",
      });
    }

    const pool = await poolPromise;
    await ensurePromotionsSchema();

    // 3. Tự động gán mã giảm giá mẫu cho user hiện tại nếu user chưa được gán mã nào
    const userPromoCheck = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query("SELECT COUNT(*) AS cnt FROM user_promotions WHERE user_id = @UserId");

    if (userPromoCheck.recordset[0]?.cnt === 0) {
      console.log(`User ${userId} has no assigned promotions. Seeding default assignments...`);
      await pool
        .request()
        .input("UserId", sql.Int, userId)
        .query(`
          INSERT INTO user_promotions (user_id, promotion_id, is_used, is_accepted)
          SELECT @UserId, id, 0, 1 FROM promotions WHERE is_active = 1
        `);
    }

    // 4. Truy vấn danh sách ưu đãi của user hiện tại
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT 
          p.id, 
          p.code, 
          p.name, 
          p.type, 
          p.min_order, 
          p.discount_percent, 
          p.discount_amount, 
          p.free_shipping, 
          p.is_active,
          up.is_used,
          up.is_accepted,
          up.assigned_at
        FROM user_promotions up
        INNER JOIN promotions p ON up.promotion_id = p.id
        WHERE up.user_id = @UserId
          AND up.is_used = 0
          AND p.is_active = 1
        ORDER BY up.assigned_at DESC
      `);

    return res.status(200).json({
      success: true,
      data: result.recordset,
    });
  } catch (error) {
    console.error("Get promotions controller error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi lấy danh sách mã ưu đãi của khách hàng.",
    });
  }
};
// Lấy toàn bộ mã khuyến mãi cho Admin
const getAdminPromotions = async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query(`
      SELECT * FROM promotions 
      ORDER BY created_at DESC, id DESC
    `);
    return res.status(200).json({
      success: true,
      data: result.recordset,
    });
  } catch (error) {
    console.error("Get admin promotions error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi lấy danh sách mã khuyến mãi.",
    });
  }
};

// Tạo mã khuyến mãi mới
const createAdminPromotion = async (req, res) => {
  try {
    const {
      code,
      name,
      type,
      min_order,
      discount_percent,
      discount_amount,
      free_shipping,
      is_active,
    } = req.body;

    if (!code || !name || !type) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng điền đầy đủ các thông tin bắt buộc: Mã, Tên, Loại.",
      });
    }

    const pool = await poolPromise;

    // Kiểm tra xem mã code đã tồn tại chưa
    const codeCheck = await pool
      .request()
      .input("Code", sql.VarChar, String(code).trim().toUpperCase())
      .query("SELECT COUNT(*) AS cnt FROM promotions WHERE code = @Code");

    if (codeCheck.recordset[0]?.cnt > 0) {
      return res.status(400).json({
        success: false,
        message: "Mã khuyến mãi này đã tồn tại trên hệ thống.",
      });
    }

    // Chuẩn hóa tham số
    const normalizedCode = String(code).trim().toUpperCase();
    const normalizedName = String(name).trim();
    const normalizedType = String(type).trim().toLowerCase();
    const minOrderVal = Number(min_order || 0);

    let discountPercentVal = 0;
    let discountAmountVal = 0;
    let freeShippingVal = 0;

    if (normalizedType === "percentage") {
      discountPercentVal = Number(discount_percent || 0);
    } else if (normalizedType === "fixed") {
      discountAmountVal = Number(discount_amount || 0);
    } else if (normalizedType === "free_shipping") {
      freeShippingVal = 1;
    } else {
      return res.status(400).json({
        success: false,
        message: "Loại ưu đãi không hợp lệ. Chọn 'percentage', 'fixed' hoặc 'free_shipping'.",
      });
    }

    const isActiveVal = is_active !== undefined ? (is_active ? 1 : 0) : 1;

    await pool
      .request()
      .input("Code", sql.VarChar, normalizedCode)
      .input("Name", sql.NVarChar, normalizedName)
      .input("Type", sql.VarChar, normalizedType)
      .input("MinOrder", sql.Decimal(18, 2), minOrderVal)
      .input("DiscountPercent", sql.Decimal(5, 2), discountPercentVal)
      .input("DiscountAmount", sql.Decimal(18, 2), discountAmountVal)
      .input("FreeShipping", sql.Bit, freeShippingVal)
      .input("IsActive", sql.Bit, isActiveVal)
      .query(`
        INSERT INTO promotions (code, name, type, min_order, discount_percent, discount_amount, free_shipping, is_active, created_at)
        VALUES (@Code, @Name, @Type, @MinOrder, @DiscountPercent, @DiscountAmount, @FreeShipping, @IsActive, GETDATE())
      `);

    return res.status(201).json({
      success: true,
      message: "Tạo mã khuyến mãi thành công.",
    });
  } catch (error) {
    console.error("Create admin promotion error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi tạo mã khuyến mãi.",
    });
  }
};

// Xóa mã khuyến mãi
const deleteAdminPromotion = async (req, res) => {
  try {
    const { id } = req.params;
    const pool = await poolPromise;

    const result = await pool
      .request()
      .input("Id", sql.Int, Number(id))
      .query("DELETE FROM promotions WHERE id = @Id");

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy mã khuyến mãi cần xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Xóa mã khuyến mãi thành công.",
    });
  } catch (error) {
    console.error("Delete admin promotion error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi xóa mã khuyến mãi.",
    });
  }
};

// Phát mã khuyến mãi cho khách hàng
const distributeAdminPromotion = async (req, res) => {
  try {
    const { promotionId, targetType, userIds } = req.body;

    if (!promotionId || !targetType) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng chọn mã khuyến mãi và đối tượng nhận.",
      });
    }

    const pool = await poolPromise;
    await ensurePromotionsSchema();

    // Kiểm tra xem promotion có tồn tại và đang active không
    const promoCheck = await pool
      .request()
      .input("PromoId", sql.Int, Number(promotionId))
      .query("SELECT id, code, name, type, min_order, discount_percent, discount_amount, free_shipping, is_active FROM promotions WHERE id = @PromoId");

    const promo = promoCheck.recordset[0];
    if (!promo) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy chương trình khuyến mãi tương ứng.",
      });
    }

    if (targetType === "all") {
      // Gán cho tất cả khách hàng (role_id = 1) chưa nhận mã này
      const result = await pool
        .request()
        .input("PromoId", sql.Int, Number(promotionId))
        .query(`
          INSERT INTO user_promotions (user_id, promotion_id, is_used, is_accepted, assigned_at)
          SELECT u.id, @PromoId, 0, 0, GETDATE()
          FROM users u
          WHERE u.role_id = 1 AND u.is_active = 1
            AND NOT EXISTS (
              SELECT 1 FROM user_promotions up 
              WHERE up.user_id = u.id AND up.promotion_id = @PromoId AND up.is_used = 0
            )
        `);

      // Gửi email thông báo trong background cho tất cả khách hàng đang hoạt động
      const usersRes = await pool.request().query(`
        SELECT u.id, u.email, u.username, profile.full_name
        FROM users u
        LEFT JOIN user_profiles profile ON profile.user_id = u.id
        WHERE u.role_id = 1 AND u.is_active = 1
      `);
      notifyUsersAboutNewPromotion(usersRes.recordset, promo).catch((err) => {
        console.error("Background promotion notification error:", err);
      });

      return res.status(200).json({
        success: true,
        message: `Đã phát mã khuyến mãi thành công cho ${result.rowsAffected[0]} khách hàng. Hệ thống đang gửi email thông báo.`,
      });
    } else if (targetType === "selected") {
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Vui lòng cung cấp danh sách khách hàng được chọn.",
        });
      }

      let count = 0;
      const transaction = new sql.Transaction(pool);
      await transaction.begin();
      try {
        for (const uId of userIds) {
          const request = new sql.Request(transaction);
          const result = await request
            .input("UserId", sql.Int, Number(uId))
            .input("PromoId", sql.Int, Number(promotionId))
            .query(`
              IF NOT EXISTS (
                SELECT 1 FROM user_promotions 
                WHERE user_id = @UserId AND promotion_id = @PromoId AND is_used = 0
              )
              BEGIN
                INSERT INTO user_promotions (user_id, promotion_id, is_used, is_accepted, assigned_at)
                VALUES (@UserId, @PromoId, 0, 0, GETDATE())
                SELECT 1 AS inserted;
              END
              ELSE
              BEGIN
                SELECT 0 AS inserted;
              END
            `);
          if (result.recordset[0]?.inserted === 1) {
            count++;
          }
        }
        await transaction.commit();
      } catch (err) {
        await transaction.rollback();
        throw err;
      }

      // Gửi email thông báo cho các khách hàng được chọn
      const userRequest = pool.request();
      const userIdParams = userIds.map((id, index) => {
        const key = `UserId${index}`;
        userRequest.input(key, sql.Int, Number(id));
        return `@${key}`;
      });

      const usersRes = await userRequest.query(`
        SELECT u.id, u.email, u.username, profile.full_name
        FROM users u
        LEFT JOIN user_profiles profile ON profile.user_id = u.id
        WHERE u.id IN (${userIdParams.join(", ")})
      `);
      notifyUsersAboutNewPromotion(usersRes.recordset, promo).catch((err) => {
        console.error("Background promotion notification error:", err);
      });

      return res.status(200).json({
        success: true,
        message: `Đã phát mã khuyến mãi thành công cho ${count} khách hàng được chọn. Hệ thống đang gửi email thông báo.`,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Cơ chế phát khuyến mãi không hợp lệ.",
      });
    }
  } catch (error) {
    console.error("Distribute promotion error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi phát mã khuyến mãi.",
    });
  }
};

// Khách hàng nhấn "Xác nhận nhận phiếu" để kích hoạt mã
const acceptPromotion = async (req, res) => {
  try {
    const userId = Number(req.user?.id || 0);
    const { promotionId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Bạn cần đăng nhập để thực hiện.",
      });
    }

    if (!promotionId) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng cung cấp mã khuyến mãi.",
      });
    }

    const pool = await poolPromise;
    await ensurePromotionsSchema();
    const result = await pool
      .request()
      .input("UserId", sql.Int, userId)
      .input("PromoId", sql.Int, Number(promotionId))
      .query(`
        UPDATE user_promotions 
        SET is_accepted = 1 
        WHERE user_id = @UserId AND promotion_id = @PromoId AND is_used = 0
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(400).json({
        success: false,
        message: "Không thể nhận mã này hoặc bạn đã nhận trước đó.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Nhận mã khuyến mãi thành công!",
    });
  } catch (error) {
    console.error("Accept promotion error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error khi nhận mã khuyến mãi.",
    });
  }
};

module.exports = {
  getPromotions,
  getAdminPromotions,
  createAdminPromotion,
  deleteAdminPromotion,
  distributeAdminPromotion,
  acceptPromotion,
};
