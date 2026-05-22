const sql = require("mssql");

const parseEnvBoolean = (value, fallback = false) => {
  const normalizedValue = String(value || "").trim().toLowerCase();

  if (!normalizedValue) {
    return fallback;
  }

  if (["true", "1", "yes", "y", "on"].includes(normalizedValue)) {
    return true;
  }

  if (["false", "0", "no", "n", "off"].includes(normalizedValue)) {
    return false;
  }

  return fallback;
};

const parseEnvInteger = (value, fallback) => {
  const parsedValue = Number(value);
  return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
};

const requiredDbEnv = [
  ["DB_USER", process.env.DB_USER],
  ["DB_PASSWORD", process.env.DB_PASSWORD],
  ["DB_SERVER", process.env.DB_SERVER],
  ["DB_NAME", process.env.DB_NAME],
].filter(([, value]) => !String(value || "").trim());

if (requiredDbEnv.length) {
  throw new Error(
    `Missing required database environment variables: ${requiredDbEnv
      .map(([name]) => name)
      .join(", ")}`
  );
}

const config = {
  user: String(process.env.DB_USER || "").trim(),
  password: String(process.env.DB_PASSWORD || "").trim(),
  server: String(process.env.DB_SERVER || "localhost").trim(),
  port: parseEnvInteger(process.env.DB_PORT, 1433),
  database: String(process.env.DB_NAME || "JewelryStoreDB").trim(),
  options: {
    encrypt: parseEnvBoolean(process.env.DB_ENCRYPT, false),
    trustServerCertificate: parseEnvBoolean(
      process.env.DB_TRUST_SERVER_CERTIFICATE,
      true
    ),
  },
  pool: {
    max: parseEnvInteger(process.env.DB_POOL_MAX, 10),
    min: parseEnvInteger(process.env.DB_POOL_MIN, 0),
    idleTimeoutMillis: parseEnvInteger(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30000),
  },
};

// Khởi tạo kết nối dùng chung tới SQL Server cho toàn bộ backend.
const poolPromise = new sql.ConnectionPool(config)
  .connect()
  // Trả về pool để các module khác tái sử dụng khi truy vấn DB.
  .then((pool) => {
    console.log("Connected to SQL Server");
    return pool;
  })
  // Ghi log lỗi kết nối và ném lỗi ra ngoài để quá trình khởi động biết sự cố.
  .catch((err) => {
    console.error("DB connection error:", err);
    throw err;
  });

module.exports = { sql, poolPromise };
