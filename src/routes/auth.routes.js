const express = require("express");
const router = express.Router();
const {
  register,
  login,
  requestPasswordReset,
  resetPassword,
  verifyPasswordResetToken,
} = require("../controllers/auth.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const disableAuthCache = (req, res, next) => {
  res.set({
    "Cache-Control": "no-store, no-cache, must-revalidate, private",
    Pragma: "no-cache",
    Expires: "0",
  });
  next();
};

// Nhóm route xác thực tài khoản và phiên đăng nhập.
router.post("/register", register);
router.post("/login", login);
router.post("/forgot-password", requestPasswordReset);
router.get("/reset-password/verify", verifyPasswordResetToken);
router.post("/reset-password", resetPassword);

// Trả về thông tin user hiện tại dựa trên access token.
router.get("/me", disableAuthCache, authenticateAccessToken, (req, res) => {
  return res.status(200).json({
    success: true,
    user: req.user,
  });
});

// Route kiểm tra nhanh quyền admin của phiên đăng nhập hiện tại.
router.get(
  "/admin-only",
  disableAuthCache,
  authenticateAccessToken,
  authorizeRoles("admin"),
  (req, res) => {
    return res.status(200).json({
      success: true,
      message: "You have admin access.",
      user: req.user,
    });
  }
);

module.exports = router;
