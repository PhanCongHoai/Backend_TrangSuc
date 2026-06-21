const express = require("express");
const {
  getPromotions,
  getAdminPromotions,
  createAdminPromotion,
  deleteAdminPromotion,
  distributeAdminPromotion,
  acceptPromotion,
} = require("../controllers/promotion.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Lấy danh sách mã khuyến mãi được cấp riêng cho người dùng đăng nhập
router.get("/", authenticateAccessToken, getPromotions);

// Khách nhận phiếu khuyến mãi
router.post("/accept", authenticateAccessToken, acceptPromotion);

// Nhóm router quản lý dành cho Admin
router.get(
  "/admin/list",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminPromotions
);

router.post(
  "/admin/create",
  authenticateAccessToken,
  authorizeRoles("admin"),
  createAdminPromotion
);

router.delete(
  "/admin/:id",
  authenticateAccessToken,
  authorizeRoles("admin"),
  deleteAdminPromotion
);

router.post(
  "/admin/distribute",
  authenticateAccessToken,
  authorizeRoles("admin"),
  distributeAdminPromotion
);

module.exports = router;

