const express = require("express");
const {
  createCategory,
  deleteCategory,
  getCategories,
  toggleCategoryVisibility,
} = require("../controllers/category.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route lấy, tạo và xóa danh mục sản phẩm.
router.get("/", getCategories);
router.post("/", authenticateAccessToken, authorizeRoles("admin"), createCategory);
router.delete("/:id", authenticateAccessToken, authorizeRoles("admin"), deleteCategory);
router.put("/:id/visibility", authenticateAccessToken, authorizeRoles("admin"), toggleCategoryVisibility);

module.exports = router;
