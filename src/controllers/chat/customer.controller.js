const {
  registerConversationSubscriber,
  writeSseEvent,
} = require("./realtime");
const { ensureChatSchema } = require("./schema");
const {
  deleteMyMessageByActor,
  ensureConversationForActor,
  getConversationMessages,
  postMessageToConversation,
} = require("./service");
const {
  getActorFromRequest,
  isChatAuthError,
  sendChatAuthError,
} = require("./shared");

// Xóa một tin nhắn do chính khách hiện tại gửi trong hội thoại chat.
const deleteMyMessage = async (req, res) => {
  try {
    await ensureChatSchema();
    const actor = await getActorFromRequest(req);
    const messageId = Number(req.params.messageId);

    if (!actor || Number.isNaN(messageId) || messageId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin để xóa tin nhắn.",
      });
    }

    const deleted = await deleteMyMessageByActor({ actor, messageId });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tin nhắn của bạn để xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa tin nhắn.",
      conversationId: deleted.conversationId,
    });
  } catch (error) {
    if (isChatAuthError(error)) {
      return sendChatAuthError(res, error);
    }

    console.error("Delete my chat message error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể xóa tin nhắn.",
    });
  }
};

// Lấy hội thoại hiện tại của khách hoặc người dùng đăng nhập.
const getMyConversation = async (req, res) => {
  try {
    await ensureChatSchema();
    const actor = await getActorFromRequest(req);

    if (!actor) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin người dùng chat.",
      });
    }

    const conversation = await ensureConversationForActor(actor);
    const messages = await getConversationMessages(conversation.id);

    return res.status(200).json({
      success: true,
      conversation: {
        id: Number(conversation.id),
        guestName: conversation.guest_name || actor.guestName,
        status: conversation.status || "OPEN",
      },
      messages,
    });
  } catch (error) {
    if (isChatAuthError(error)) {
      return sendChatAuthError(res, error);
    }

    console.error("Get my chat conversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể tải cuộc trò chuyện.",
    });
  }
};

// Gửi tin nhắn mới từ phía khách hàng vào hội thoại của họ.
const sendMyMessage = async (req, res) => {
  try {
    await ensureChatSchema();
    const actor = await getActorFromRequest(req);

    if (!actor) {
      return res.status(400).json({
        success: false,
        message: "Thiếu thông tin người dùng chat.",
      });
    }

    const conversation = await ensureConversationForActor(actor);
    const message = await postMessageToConversation({
      conversationId: conversation.id,
      actor,
      message: req.body?.message,
      imageUrl: req.body?.imageUrl,
    });

    return res.status(201).json({
      success: true,
      message: "Gửi tin nhắn thành công.",
      chatMessage: message,
      conversationId: Number(conversation.id),
    });
  } catch (error) {
    if (isChatAuthError(error)) {
      return sendChatAuthError(res, error);
    }

    if (!error.status || error.status >= 500) {
      console.error("Send my chat message error:", error);
    }

    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Không thể gửi tin nhắn.",
    });
  }
};

// Mở luồng SSE để khách nhận cập nhật realtime cho hội thoại của mình.
const streamMyConversation = async (req, res) => {
  try {
    await ensureChatSchema();
    const actor = await getActorFromRequest(req);

    if (!actor) {
      return res.status(400).end();
    }

    const conversation = await ensureConversationForActor(actor);

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    writeSseEvent(res, "ready", { conversationId: Number(conversation.id) });
    const unregister = registerConversationSubscriber(conversation.id, res);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unregister();
    });
  } catch (error) {
    if (isChatAuthError(error)) {
      return res.status(error.status || 401).end();
    }

    console.error("Stream my conversation error:", error);
    res.status(500).end();
  }
};

module.exports = {
  deleteMyMessage,
  getMyConversation,
  sendMyMessage,
  streamMyConversation,
};
