const express = require("express");
const { askAiAdvisor } = require("../controllers/aiChat.controller");

const router = express.Router();

router.post("/ask", askAiAdvisor);

module.exports = router;

