const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const categoryRoutes = require("./routes/category.routes");
const bannerRoutes = require("./routes/banner.routes");
const goldRateRoutes = require("./routes/goldRate.routes");
const productRoutes = require("./routes/product.routes");
const customerRoutes = require("./routes/customer.routes");
const chatRoutes = require("./routes/chat.routes");
const aiChatRoutes = require("./routes/aiChat.routes");
const shippingRoutes = require("./routes/shipping.routes");
const orderRoutes = require("./routes/order.routes");

const app = express();
const DEFAULT_ALLOWED_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

const parseCsvEnv = (value = "") =>
  String(value || "")
    .split(",")
    .map((item) => item.trim().replace(/\/+$/, ""))
    .filter(Boolean);

const frontendUrl = String(process.env.FRONTEND_URL || "")
  .trim()
  .replace(/\/+$/, "");
const configuredOrigins = [
  ...new Set([
    ...parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS),
    ...(frontendUrl ? [frontendUrl] : []),
  ]),
];
const allowedOrigins = configuredOrigins.length ? configuredOrigins : DEFAULT_ALLOWED_ORIGINS;
const jsonBodyLimit = String(process.env.JSON_BODY_LIMIT || "10mb").trim() || "10mb";

app.disable("x-powered-by");
app.set("trust proxy", 1);

// middleware
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error("Origin is not allowed by CORS."));
    },
  })
);
app.use(express.json({ limit: jsonBodyLimit }));
app.use(express.urlencoded({ extended: true, limit: jsonBodyLimit }));
app.use("/uploads", express.static(path.resolve(__dirname, "../uploads")));

// Route kiểm tra nhanh backend đã khởi động thành công hay chưa.
app.get("/", (req, res) => {
  res.send("Backend running...");
});

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
  });
});

// Gắn toàn bộ router nghiệp vụ vào các tiền tố API tương ứng.
app.use("/api/auth", authRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/banners", bannerRoutes);
app.use("/api/gold-rates", goldRateRoutes);
app.use("/api/products", productRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/ai-chat", aiChatRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/orders", orderRoutes);

// start server
const PORT = process.env.PORT || 5000;
// Khởi động server Express trên cổng được cấu hình.
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
