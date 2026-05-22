const express = require("express");
const {
  getAdminCustomers,
  updateCustomerStatus,
} = require("../controllers/customer.controller");
const {
  authenticateAccessToken,
  authorizeRoles,
} = require("../middlewares/auth.middleware");

const router = express.Router();

// Nhóm route quản trị khách hàng.
router.get("/", authenticateAccessToken, authorizeRoles("admin"), getAdminCustomers);
router.patch(
  "/:id/status",
  authenticateAccessToken,
  authorizeRoles("admin"),
  updateCustomerStatus
);

module.exports = router;
