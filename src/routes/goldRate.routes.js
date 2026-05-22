const express = require("express");
const {
  getGoldRates,
  getMaterialOptions,
  createGoldRate,
} = require("../controllers/goldRate.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route quản lý giá vàng và danh sách nguyên liệu.
router.get("/materials", authenticateAccessToken, authorizeRoles("admin"), getMaterialOptions);
router.get("/", authenticateAccessToken, authorizeRoles("admin"), getGoldRates);
router.post("/", authenticateAccessToken, authorizeRoles("admin"), createGoldRate);

module.exports = router;
