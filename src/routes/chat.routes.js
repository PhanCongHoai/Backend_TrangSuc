const express = require("express");
const {
  getMyConversation,
  sendMyMessage,
  deleteMyMessage,
  streamMyConversation,
  getAdminConversations,
  getAdminConversationMessages,
  sendAdminMessage,
  deleteAdminMessage,
  deleteAdminConversation,
  streamAdminConversations,
} = require("../controllers/chat.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route chat cho khách hàng/guest.
router.get("/me", getMyConversation);
router.post("/me/messages", sendMyMessage);
router.delete("/me/messages/:messageId", deleteMyMessage);
router.get("/me/stream", streamMyConversation);

// Nhóm route chat realtime và quản trị hội thoại cho admin.
router.get(
  "/admin/conversations",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminConversations
);
router.get(
  "/admin/conversations/stream",
  authenticateAccessToken,
  authorizeRoles("admin"),
  streamAdminConversations
);
router.get(
  "/admin/conversations/:id/messages",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminConversationMessages
);
router.post(
  "/admin/conversations/:id/messages",
  authenticateAccessToken,
  authorizeRoles("admin"),
  sendAdminMessage
);
router.delete(
  "/admin/conversations/:id/messages/:messageId",
  authenticateAccessToken,
  authorizeRoles("admin"),
  deleteAdminMessage
);
router.delete(
  "/admin/conversations/:id",
  authenticateAccessToken,
  authorizeRoles("admin"),
  deleteAdminConversation
);

module.exports = router;
