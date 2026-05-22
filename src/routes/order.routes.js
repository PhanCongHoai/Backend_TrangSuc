const express = require("express");
const {
  createCustomerOrder,
  getAdminOrders,
  getAdminRevenueReport,
  getMyOrders,
  getMyOrderPaymentStatus,
  getSepayWebhookHealth,
  handleSepayWebhook,
  streamAdminOrders,
  streamMyOrders,
  updateAdminOrderStatus,
} = require("../controllers/order.controller");
const {
  authenticateAccessTokenFlexible,
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route đặt hàng và xem đơn hàng của chính người dùng hiện tại.
router.get(
  "/admin/revenue-report",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminRevenueReport,
);
router.get(
  "/admin/list",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminOrders,
);
router.get(
  "/admin/stream",
  authenticateAccessTokenFlexible,
  authorizeRoles("admin"),
  streamAdminOrders,
);
router.patch(
  "/admin/:id/status",
  authenticateAccessToken,
  authorizeRoles("admin"),
  updateAdminOrderStatus,
);
router.get("/sepay/webhook/health", getSepayWebhookHealth);
router.post("/sepay/webhook", handleSepayWebhook);
router.get("/my/stream", authenticateAccessTokenFlexible, streamMyOrders);
router.get("/:id/payment-status", authenticateAccessToken, getMyOrderPaymentStatus);
router.get("/my", authenticateAccessToken, getMyOrders);
router.post("/", authenticateAccessToken, createCustomerOrder);

module.exports = router;
