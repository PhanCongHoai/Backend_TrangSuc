const express = require("express");
const {
  askAiAdvisor,
  getAiChatHistory,
  clearAiChatHistory,
  askSmartReport,
  getSmartReportHistory,
  clearSmartReportHistory,
} = require("../controllers/aiChat.controller");
const { authenticateAccessToken, authorizeRoles } = require("../middlewares/auth.middleware");

const router = express.Router();

router.post("/ask", authenticateAccessToken, askAiAdvisor);
router.get("/history", authenticateAccessToken, getAiChatHistory);
router.delete("/history", authenticateAccessToken, clearAiChatHistory);

router.post("/smart-report", authenticateAccessToken, authorizeRoles("admin"), askSmartReport);
router.get("/smart-report/history", authenticateAccessToken, authorizeRoles("admin"), getSmartReportHistory);
router.delete("/smart-report/history", authenticateAccessToken, authorizeRoles("admin"), clearSmartReportHistory);

module.exports = router;

