const express = require("express");
const {
  deleteAdminHomeHeroBanner,
  getAdminHomeHeroBanner,
  getHomeHeroBanner,
  upsertAdminHomeHeroBanner,
} = require("../controllers/banner.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route quản lý banner trang chủ cho client và admin.
router.get("/home-hero", getHomeHeroBanner);
router.get(
  "/admin/home-hero",
  authenticateAccessToken,
  authorizeRoles("admin"),
  getAdminHomeHeroBanner
);
router.patch(
  "/admin/home-hero",
  authenticateAccessToken,
  authorizeRoles("admin"),
  upsertAdminHomeHeroBanner
);
router.delete(
  "/admin/home-hero/:id",
  authenticateAccessToken,
  authorizeRoles("admin"),
  deleteAdminHomeHeroBanner
);

module.exports = router;
