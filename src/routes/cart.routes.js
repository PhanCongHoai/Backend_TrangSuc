const express = require("express");
const router = express.Router();
const cartController = require("../controllers/cart.controller");
const { authenticateAccessToken } = require("../middlewares/auth.middleware");

// Tất cả các route giỏ hàng đều yêu cầu người dùng đăng nhập
router.use(authenticateAccessToken);

router.get("/", cartController.getCart);
router.post("/", cartController.addToCart);
router.put("/items", cartController.updateCartQuantity);
router.delete("/items/:variantId", cartController.removeCartItem);
router.delete("/", cartController.clearCart);
router.post("/sync", cartController.syncCart);

module.exports = router;
