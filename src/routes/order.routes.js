const express = require("express");
const {
  createCustomerOrder,
  getAdminDashboardSummary,
  getAdminOrders,
  getAdminRevenueReport,
  getMyOrders,
  getMyOrderPaymentStatus,
  getSepayWebhookHealth,
  handleSepayWebhook,
  streamAdminOrders,
  streamMyOrders,
  updateAdminOrderStatus,
  cancelCustomerOrder,
  createReturnRequest,
  getMyReturnRequests,
  getAdminReturnRequests,
  confirmAdminReturnRequest,
  rejectAdminReturnRequest,
} = require("../controllers/order.controller");
const {
  authenticateAccessTokenFlexible,
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route đặt hàng và xem đơn hàng của chính người dùng hiện tại.
router.get(
  "/admin/dashboard-summary",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminDashboardSummary,
);
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

// Admin return routes
router.get(
  "/admin/returns",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminReturnRequests,
);
router.patch(
  "/admin/returns/:id/confirm",
  authenticateAccessToken,
  authorizeRoles("admin"),
  confirmAdminReturnRequest,
);
router.patch(
  "/admin/returns/:id/reject",
  authenticateAccessToken,
  authorizeRoles("admin"),
  rejectAdminReturnRequest,
);

router.get("/sepay/webhook/health", getSepayWebhookHealth);
router.post("/sepay/webhook", handleSepayWebhook);
router.get("/my/stream", authenticateAccessTokenFlexible, streamMyOrders);
router.get("/:id/payment-status", authenticateAccessToken, getMyOrderPaymentStatus);

// Customer return and cancellation routes
router.patch("/my/:id/cancel", authenticateAccessToken, cancelCustomerOrder);
router.post("/my/returns", authenticateAccessToken, createReturnRequest);
router.get("/my/returns", authenticateAccessToken, getMyReturnRequests);

router.get("/my", authenticateAccessToken, getMyOrders);
router.post("/", authenticateAccessToken, createCustomerOrder);

module.exports = router;
