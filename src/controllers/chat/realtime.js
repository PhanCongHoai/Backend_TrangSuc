const conversationSubscribers = new Map();
const adminSubscribers = new Set();

// Ghi một sự kiện SSE chuẩn ra response đang stream.
const writeSseEvent = (response, eventName, payload) => {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

// Đăng ký subscriber realtime cho một hội thoại cụ thể và trả hàm hủy đăng ký.
const registerConversationSubscriber = (conversationId, response) => {
  const key = String(conversationId);
  const listeners = conversationSubscribers.get(key) || new Set();
  listeners.add(response);
  conversationSubscribers.set(key, listeners);

  return () => {
    const currentListeners = conversationSubscribers.get(key);

    if (!currentListeners) {
      return;
    }

    currentListeners.delete(response);

    if (!currentListeners.size) {
      conversationSubscribers.delete(key);
    }
  };
};

// Phát sự kiện realtime tới toàn bộ subscriber của một hội thoại.
const notifyConversationSubscribers = (conversationId, payload) => {
  const listeners = conversationSubscribers.get(String(conversationId));

  if (!listeners?.size) {
    return;
  }

  listeners.forEach((response) => writeSseEvent(response, "message", payload));
};

// Đăng ký subscriber realtime cho luồng danh sách hội thoại phía admin.
const registerAdminSubscriber = (response) => {
  adminSubscribers.add(response);

  return () => {
    adminSubscribers.delete(response);
  };
};

// Phát sự kiện realtime tới tất cả subscriber admin.
const notifyAdminSubscribers = (payload) => {
  adminSubscribers.forEach((response) =>
    writeSseEvent(response, "conversation", payload)
  );
};

module.exports = {
  notifyAdminSubscribers,
  notifyConversationSubscribers,
  registerAdminSubscriber,
  registerConversationSubscriber,
  writeSseEvent,
};
