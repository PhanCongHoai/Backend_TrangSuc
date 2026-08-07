const express = require("express");
const { getAiRestockForecast, triggerEtlSync } = require("../controllers/forecast.controller");
const { authenticateAccessToken, authorizeRoles } = require("../middlewares/auth.middleware");

const router = express.Router();

// Tuyến đường API dự báo Restock (Chỉ dành cho Admin)
router.get("/ai-report", authenticateAccessToken, authorizeRoles("admin"), getAiRestockForecast);

// Tuyến đường kích hoạt ETL thủ công (Chỉ dành cho Admin)
router.post("/sync-etl", authenticateAccessToken, authorizeRoles("admin"), triggerEtlSync);

module.exports = router;
