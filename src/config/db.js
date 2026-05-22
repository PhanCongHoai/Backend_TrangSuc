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

const baseConnectionConfig = {
  server: config.server,
  port: config.port,
  database: config.database,
  options: config.options,
  pool: config.pool,
};

const explicitAuthenticationConfig = {
  ...baseConnectionConfig,
  authentication: {
    type: "default",
    options: {
      userName: config.user,
      password: config.password,
    },
  },
};

const legacyAuthenticationConfig = {
  ...baseConnectionConfig,
  user: config.user,
  password: config.password,
};

console.log("Effective DB config:", {
  user: config.user,
  server: config.server,
  database: config.database,
  port: config.port,
  encrypt: config.options.encrypt,
  trustServerCertificate: config.options.trustServerCertificate,
  passwordLength: config.password.length,
});

const connectPool = async (connectionConfig, label) => {
  const pool = new sql.ConnectionPool(connectionConfig);
  await pool.connect();
  console.log(`Connected to SQL Server with ${label}`);
  return pool;
};

// Initialize one shared SQL Server pool for the whole backend.
const poolPromise = connectPool(explicitAuthenticationConfig, "explicit authentication")
  .catch(async (explicitAuthError) => {
    console.warn(
      "Explicit SQL authentication connection failed, retrying with legacy mssql config:",
      explicitAuthError.message
    );

    try {
      return await connectPool(legacyAuthenticationConfig, "legacy authentication");
    } catch (legacyAuthError) {
      console.error("DB connection error:", legacyAuthError);
      throw legacyAuthError;
    }
  });

module.exports = { sql, poolPromise };
