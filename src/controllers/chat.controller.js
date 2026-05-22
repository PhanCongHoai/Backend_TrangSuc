const {
  getAdminConversations,
  getAdminConversationMessages,
  sendAdminMessage,
  deleteAdminMessage,
  deleteAdminConversation,
  streamAdminConversations,
} = require("./chat/admin.controller");
const {
  getMyConversation,
  sendMyMessage,
  deleteMyMessage,
  streamMyConversation,
} = require("./chat/customer.controller");

module.exports = {
  deleteAdminConversation,
  deleteAdminMessage,
  deleteMyMessage,
  getAdminConversationMessages,
  getAdminConversations,
  getMyConversation,
  sendAdminMessage,
  sendMyMessage,
  streamAdminConversations,
  streamMyConversation,
};
