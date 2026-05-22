const express = require("express");
const {
  calculateShippingFee,
  cancelShippingOrder,
  createShippingOrder,
  getShippingConfig,
  getShippingDistricts,
  getShippingOrderDetail,
  getShippingProvinces,
  getShippingWards,
} = require("../controllers/shipping.controller");

const router = express.Router();

// Nhóm route làm việc với dịch vụ vận chuyển GHN.
router.get("/config", getShippingConfig);
router.get("/provinces", getShippingProvinces);
router.get("/districts", getShippingDistricts);
router.get("/wards", getShippingWards);
router.post("/fee", calculateShippingFee);
router.post("/orders", createShippingOrder);
router.get("/orders/detail", getShippingOrderDetail);
router.post("/orders/cancel", cancelShippingOrder);

module.exports = router;
