const express = require("express");
const {
  createAdminProduct,
  createProductReview,
  deleteOwnProductReview,
  deleteAdminProduct,
  deleteAllAdminProducts,
  getAdminProducts,
  getClientProducts,
  getCompareConfig,
  getFeaturedProducts,
  getProductDetail,
  hideAllAdminProducts,
  hideAdminProduct,
  previewCompareProducts,
  showAdminProduct,
  updateAdminProduct,
} = require("../controllers/product.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route sản phẩm cho client và khu vực quản trị.
router.get("/admin/list", authenticateAccessToken, authorizeRoles("admin"), getAdminProducts);
router.post("/admin", authenticateAccessToken, authorizeRoles("admin"), createAdminProduct);
router.delete("/admin/all", authenticateAccessToken, authorizeRoles("admin"), deleteAllAdminProducts);
router.patch("/admin/all/hide", authenticateAccessToken, authorizeRoles("admin"), hideAllAdminProducts);
router.patch("/admin/:id", authenticateAccessToken, authorizeRoles("admin"), updateAdminProduct);
router.delete("/admin/:id", authenticateAccessToken, authorizeRoles("admin"), deleteAdminProduct);
router.patch(
  "/admin/:id/hide",
  authenticateAccessToken,
  authorizeRoles("admin"),
  hideAdminProduct
);
router.patch(
  "/admin/:id/show",
  authenticateAccessToken,
  authorizeRoles("admin"),
  showAdminProduct
);
router.get("/", getClientProducts);
router.get("/compare/config", getCompareConfig);
router.post("/compare/preview", previewCompareProducts);
router.get("/featured", getFeaturedProducts);
router.post("/:id/reviews", authenticateAccessToken, createProductReview);
router.delete("/:id/reviews/:reviewId", authenticateAccessToken, deleteOwnProductReview);
router.get("/:id", getProductDetail);

module.exports = router;
