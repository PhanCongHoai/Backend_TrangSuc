const { notifyAdminSubscribers, registerAdminSubscriber, writeSseEvent } = require("./realtime");
const { ensureChatSchema } = require("./schema");
const {
  deleteAdminConversationById,
  deleteAdminMessageById,
  getAdminConversationSummaries,
  getConversationMessages,
  getConversationSummaryById,
  markConversationSeenByAdmin,
  postMessageToConversation,
} = require("./service");

// Lấy danh sách toàn bộ hội thoại cho giao diện quản trị chat.
const getAdminConversations = async (req, res) => {
  try {
    await ensureChatSchema();
    const conversations = await getAdminConversationSummaries();

    return res.status(200).json({
      success: true,
      conversations,
    });
  } catch (error) {
    console.error("Get admin conversations error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể tải danh sách hội thoại.",
    });
  }
};

// Lấy danh sách tin nhắn của một hội thoại và đánh dấu admin đã xem.
const getAdminConversationMessages = async (req, res) => {
  try {
    await ensureChatSchema();
    const conversationId = Number(req.params.id);

    if (Number.isNaN(conversationId) || conversationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Mã hội thoại không hợp lệ.",
      });
    }

    await markConversationSeenByAdmin(conversationId);

    const messages = await getConversationMessages(conversationId);
    const conversationSummary = await getConversationSummaryById(conversationId);

    notifyAdminSubscribers({
      conversation: conversationSummary,
      readConversationId: conversationId,
    });

    return res.status(200).json({
      success: true,
      messages,
      conversation: conversationSummary,
    });
  } catch (error) {
    console.error("Get admin conversation messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể tải tin nhắn.",
    });
  }
};

// Gửi phản hồi từ admin vào một hội thoại cụ thể.
const sendAdminMessage = async (req, res) => {
  try {
    await ensureChatSchema();
    const conversationId = Number(req.params.id);

    if (Number.isNaN(conversationId) || conversationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Mã hội thoại không hợp lệ.",
      });
    }

    const actor = {
      type: "user",
      user: req.user,
      guestName: req.user?.fullName || req.user?.username || "Tư vấn viên",
    };
    const message = await postMessageToConversation({
      conversationId,
      actor,
      message: req.body?.message,
      imageUrl: req.body?.imageUrl,
    });

    return res.status(201).json({
      success: true,
      chatMessage: message,
    });
  } catch (error) {
    console.error("Send admin chat message error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Không thể gửi phản hồi.",
    });
  }
};

// Xóa một tin nhắn trong hội thoại từ phía quản trị viên.
const deleteAdminMessage = async (req, res) => {
  try {
    await ensureChatSchema();
    const conversationId = Number(req.params.id);
    const messageId = Number(req.params.messageId);

    if (
      Number.isNaN(conversationId) ||
      conversationId <= 0 ||
      Number.isNaN(messageId) ||
      messageId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message: "Mã hội thoại hoặc mã tin nhắn không hợp lệ.",
      });
    }

    const deleted = await deleteAdminMessageById({ conversationId, messageId });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tin nhắn để xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa tin nhắn.",
    });
  } catch (error) {
    console.error("Delete admin chat message error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể xóa tin nhắn.",
    });
  }
};

// Xóa toàn bộ hội thoại khỏi hệ thống từ phía admin.
const deleteAdminConversation = async (req, res) => {
  try {
    await ensureChatSchema();
    const conversationId = Number(req.params.id);

    if (Number.isNaN(conversationId) || conversationId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Mã hội thoại không hợp lệ.",
      });
    }

    const deleted = await deleteAdminConversationById(conversationId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy hội thoại để xóa.",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Đã xóa cuộc hội thoại.",
    });
  } catch (error) {
    console.error("Delete admin conversation error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể xóa cuộc hội thoại.",
    });
  }
};

// Mở luồng SSE để admin nhận cập nhật realtime của toàn bộ hội thoại.
const streamAdminConversations = async (req, res) => {
  try {
    await ensureChatSchema();

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    writeSseEvent(res, "ready", { ok: true });
    const unregister = registerAdminSubscriber(res);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
      unregister();
    });
  } catch (error) {
    console.error("Stream admin conversations error:", error);
    res.status(500).end();
  }
};

module.exports = {
  deleteAdminConversation,
  deleteAdminMessage,
  getAdminConversationMessages,
  getAdminConversations,
  sendAdminMessage,
  streamAdminConversations,
};
