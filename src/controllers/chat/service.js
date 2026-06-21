const { poolPromise, sql } = require("../../config/db");
const {
  notifyAdminSubscribers,
  notifyConversationSubscribers,
} = require("./realtime");
const { formatDateTime, normalizeChatImageUrl } = require("./shared");

// Hàm thử lại khi gặp lỗi deadlock của SQL Server (mã lỗi 1205).
const withDeadlockRetry = async (fn, maxRetries = 3, delayMs = 100) => {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      const isDeadlock =
        error.number === 1205 ||
        error.originalError?.info?.number === 1205 ||
        String(error.message || "").toLowerCase().includes("deadlock");

      if (isDeadlock && attempt <= maxRetries) {
        console.warn(`[SQL Server Deadlock] Thử lại lần thứ ${attempt} sau ${delayMs * attempt}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
        continue;
      }
      throw error;
    }
  }
};

// Ánh xạ bản ghi chat_messages thành object message dùng chung trong API.
const mapMessage = (item) => ({
  id: Number(item.id),
  conversationId: Number(item.conversation_id),
  senderType: item.sender_type,
  senderUserId: item.sender_user_id ? Number(item.sender_user_id) : null,
  senderName: item.sender_name,
  message: item.message || "",
  imageUrl: item.image_url || null,
  createdAt: item.created_at,
  createdAtLabel: formatDateTime(item.created_at),
});

// Ánh xạ dữ liệu hội thoại thành summary cho danh sách hội thoại.
const mapConversationSummary = (item) => ({
  id: Number(item.id),
  guestName: item.guest_name || "Khách hàng",
  userId: item.user_id ? Number(item.user_id) : null,
  lastMessage: item.last_message || "",
  lastMessageAt: item.last_message_at,
  lastMessageAtLabel: formatDateTime(item.last_message_at),
  unreadCount: Number(item.unread_count || 0),
  status: item.status || "OPEN",
});

// Sinh truy vấn SQL chuẩn để lấy summary hội thoại theo điều kiện truyền vào.
const getConversationSummaryQuery = (whereClause) => `
  SELECT
    c.id,
    c.user_id,
    c.guest_name,
    c.status,
    c.last_message_at,
    latest.message AS last_message,
    unread.unread_count
  FROM chat_conversations c
  OUTER APPLY (
    SELECT TOP 1
      CASE
        WHEN NULLIF(LTRIM(RTRIM(ISNULL(message, N''))), N'') IS NOT NULL THEN message
        WHEN NULLIF(LTRIM(RTRIM(ISNULL(image_url, N''))), N'') IS NOT NULL THEN N'[Hình ảnh]'
        ELSE N''
      END AS message
    FROM chat_messages
    WHERE conversation_id = c.id
    ORDER BY created_at DESC, id DESC
  ) latest
  OUTER APPLY (
    SELECT COUNT(1) AS unread_count
    FROM chat_messages unread_message
    WHERE unread_message.conversation_id = c.id
      AND unread_message.sender_type IN ('user', 'guest')
      AND unread_message.created_at > ISNULL(c.admin_seen_at, CONVERT(DATETIME, '19000101', 112))
  ) unread
  ${whereClause}
`;

// Tìm hội thoại hiện có theo actor người dùng hoặc khách vãng lai.
const getConversationByActor = async (actor) => {
  const pool = await poolPromise;
  const request = pool.request();

  if (actor.type === "user") {
    request.input("UserId", sql.Int, actor.user.id);
    const result = await request.query(`
      SELECT TOP 1 *
      FROM chat_conversations
      WHERE user_id = @UserId
      ORDER BY updated_at DESC, id DESC
    `);

    return result.recordset[0] || null;
  }

  request.input("GuestKey", sql.VarChar(120), actor.guestKey);
  const result = await request.query(`
    SELECT TOP 1 *
    FROM chat_conversations
    WHERE guest_key = @GuestKey
    ORDER BY updated_at DESC, id DESC
  `);

  return result.recordset[0] || null;
};

// Tạo hội thoại mới cho actor khi chưa có thread chat trước đó.
const createConversationForActor = async (actor) => {
  const pool = await poolPromise;
  const request = pool.request();

  request.input("UserId", sql.Int, actor.user?.id || null);
  request.input("GuestKey", sql.VarChar(120), actor.guestKey || null);
  request.input("GuestName", sql.NVarChar(120), actor.guestName || "Khách hàng");

  const result = await request.query(`
    INSERT INTO chat_conversations (user_id, guest_key, guest_name)
    OUTPUT INSERTED.*
    VALUES (@UserId, @GuestKey, @GuestName)
  `);

  return result.recordset[0];
};

// Bảo đảm mỗi actor luôn có một hội thoại để đọc hoặc gửi tin nhắn.
const ensureConversationForActor = async (actor) => {
  return withDeadlockRetry(async () => {
    let conversation = await getConversationByActor(actor);

    if (!conversation) {
      conversation = await createConversationForActor(actor);
    }

    return conversation;
  });
};

// Lấy toàn bộ tin nhắn của một hội thoại theo thứ tự thời gian.
const getConversationMessages = async (conversationId) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ConversationId", sql.Int, Number(conversationId))
      .query(`
        SELECT id, conversation_id, sender_type, sender_user_id, sender_name, message, image_url, created_at
        FROM chat_messages
        WHERE conversation_id = @ConversationId
        ORDER BY created_at ASC, id ASC
      `);

    return result.recordset.map(mapMessage);
  });
};

// Lấy summary của một hội thoại cụ thể theo id.
const getConversationSummaryById = async (conversationId) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ConversationId", sql.Int, Number(conversationId))
      .query(getConversationSummaryQuery("WHERE c.id = @ConversationId"));

    return result.recordset[0] ? mapConversationSummary(result.recordset[0]) : null;
  });
};

// Lấy danh sách summary hội thoại dành cho màn hình admin.
const getAdminConversationSummaries = async () => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .query(
        `${getConversationSummaryQuery("")} ORDER BY c.last_message_at DESC, c.id DESC`
      );

    return result.recordset.map(mapConversationSummary);
  });
};

// Cập nhật metadata thời gian hoạt động cuối của một hội thoại.
const refreshConversationMeta = async (conversationId) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    await pool.request().input("ConversationId", sql.Int, Number(conversationId)).query(`
      UPDATE c
      SET
        updated_at = GETDATE(),
        last_message_at = ISNULL(latest.created_at, c.created_at)
      FROM chat_conversations c
      OUTER APPLY (
        SELECT TOP 1 created_at
        FROM chat_messages
        WHERE conversation_id = c.id
        ORDER BY created_at DESC, id DESC
      ) latest
      WHERE c.id = @ConversationId
    `);
  });
};

// Gửi một tin nhắn mới vào hội thoại, đồng thời phát sự kiện realtime.
const postMessageToConversation = async ({
  conversationId,
  actor,
  message,
  imageUrl,
}) => {
  const normalizedMessage = String(message || "").trim();
  const normalizedImageUrl = normalizeChatImageUrl(imageUrl);

  if (actor.type === "guest" && normalizedImageUrl) {
    const error = new Error("Vui lòng đăng nhập để gửi ảnh trong tin nhắn.");
    error.status = 403;
    throw error;
  }

  if (normalizedMessage.length < 1 && !normalizedImageUrl) {
    throw new Error("Vui lòng nhập nội dung tin nhắn hoặc chọn ảnh.");
  }

  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const senderType =
      actor.type === "user"
        ? String(actor.user.role || "").toLowerCase() === "admin"
          ? "admin"
          : "user"
        : "guest";
    const senderName =
      senderType === "admin"
        ? actor.user.fullName ||
          actor.user.username ||
          actor.user.email ||
          "Tư vấn viên"
        : actor.guestName;

    const result = await pool
      .request()
      .input("ConversationId", sql.Int, Number(conversationId))
      .input("SenderType", sql.VarChar(20), senderType)
      .input("SenderUserId", sql.Int, actor.user?.id || null)
      .input("SenderName", sql.NVarChar(120), senderName)
      .input("Message", sql.NVarChar(sql.MAX), normalizedMessage)
      .input("ImageUrl", sql.NVarChar(sql.MAX), normalizedImageUrl)
      .query(`
        INSERT INTO chat_messages (conversation_id, sender_type, sender_user_id, sender_name, message, image_url)
        OUTPUT INSERTED.id, INSERTED.conversation_id, INSERTED.sender_type, INSERTED.sender_user_id,
               INSERTED.sender_name, INSERTED.message, INSERTED.image_url, INSERTED.created_at
        VALUES (@ConversationId, @SenderType, @SenderUserId, @SenderName, @Message, @ImageUrl);

        UPDATE chat_conversations
        SET
          updated_at = GETDATE(),
          last_message_at = GETDATE(),
          admin_seen_at = CASE
            WHEN @SenderType = 'admin' THEN GETDATE()
            ELSE admin_seen_at
          END
        WHERE id = @ConversationId;
      `);

    const savedMessage = mapMessage(result.recordset[0]);
    const [messages, conversationSummary] = await Promise.all([
      getConversationMessages(conversationId),
      getConversationSummaryById(conversationId),
    ]);

    notifyConversationSubscribers(conversationId, {
      conversationId: Number(conversationId),
      message: savedMessage,
      messages,
    });
    notifyAdminSubscribers({
      conversation: conversationSummary,
      message: savedMessage,
    });

    return savedMessage;
  });
};

// Xóa tin nhắn do chính actor hiện tại tạo ra và phát cập nhật realtime.
const deleteMyMessageByActor = async ({ actor, messageId }) => {
  return withDeadlockRetry(async () => {
    const conversation = await ensureConversationForActor(actor);
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("MessageId", sql.Int, Number(messageId))
      .input("ConversationId", sql.Int, Number(conversation.id))
      .input("SenderUserId", sql.Int, actor.user?.id || null)
      .input("SenderType", sql.VarChar(20), actor.type === "user" ? "user" : "guest")
      .query(`
        DELETE FROM chat_messages
        OUTPUT DELETED.conversation_id
        WHERE id = @MessageId
          AND conversation_id = @ConversationId
          AND (
            (sender_type = 'guest' AND @SenderType = 'guest')
            OR (sender_type = 'user' AND sender_user_id = @SenderUserId AND @SenderType = 'user')
          )
      `);

    if (!result.recordset[0]) {
      return null;
    }

    await refreshConversationMeta(conversation.id);
    const [messages, conversationSummary] = await Promise.all([
      getConversationMessages(conversation.id),
      getConversationSummaryById(conversation.id),
    ]);

    notifyConversationSubscribers(conversation.id, {
      conversationId: Number(conversation.id),
      deletedMessageId: Number(messageId),
      messages,
    });
    notifyAdminSubscribers({
      conversation: conversationSummary,
      deletedMessageId: Number(messageId),
    });

    return {
      conversationId: Number(conversation.id),
    };
  });
};

// Đánh dấu một hội thoại là đã được admin xem đến thời điểm hiện tại.
const markConversationSeenByAdmin = async (conversationId) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    await pool.request().input("ConversationId", sql.Int, Number(conversationId)).query(`
      UPDATE chat_conversations
      SET admin_seen_at = GETDATE()
      WHERE id = @ConversationId
    `);
  });
};

// Xóa tin nhắn bất kỳ trong hội thoại từ phía admin và đồng bộ realtime.
const deleteAdminMessageById = async ({ conversationId, messageId }) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ConversationId", sql.Int, Number(conversationId))
      .input("MessageId", sql.Int, Number(messageId))
      .query(`
        DELETE FROM chat_messages
        OUTPUT DELETED.conversation_id
        WHERE id = @MessageId
          AND conversation_id = @ConversationId
      `);

    if (!result.recordset[0]) {
      return false;
    }

    await refreshConversationMeta(conversationId);
    const [messages, conversationSummary] = await Promise.all([
      getConversationMessages(conversationId),
      getConversationSummaryById(conversationId),
    ]);

    notifyConversationSubscribers(conversationId, {
      conversationId: Number(conversationId),
      deletedMessageId: Number(messageId),
      messages,
    });
    notifyAdminSubscribers({
      conversation: conversationSummary,
      deletedMessageId: Number(messageId),
    });

    return true;
  });
};

// Xóa toàn bộ hội thoại từ phía admin và phát sự kiện cho các subscriber.
const deleteAdminConversationById = async (conversationId) => {
  return withDeadlockRetry(async () => {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .input("ConversationId", sql.Int, Number(conversationId))
      .query(`
        DELETE FROM chat_conversations
        OUTPUT DELETED.id
        WHERE id = @ConversationId
      `);

    if (!result.recordset[0]) {
      return false;
    }

    notifyConversationSubscribers(conversationId, {
      conversationId: Number(conversationId),
      deletedConversationId: Number(conversationId),
      messages: [],
    });
    notifyAdminSubscribers({
      deletedConversationId: Number(conversationId),
    });

    return true;
  });
};

module.exports = {
  deleteAdminConversationById,
  deleteAdminMessageById,
  deleteMyMessageByActor,
  ensureConversationForActor,
  getAdminConversationSummaries,
  getConversationMessages,
  getConversationSummaryById,
  markConversationSeenByAdmin,
  postMessageToConversation,
};
