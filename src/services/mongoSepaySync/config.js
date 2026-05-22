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

const getMongoSepayConfig = () => /* The `(` in JavaScript is used to denote the start of a function or
method declaration. In the provided code snippet, the `(` is used
in defining the `parseEnvBoolean` and `getMongoSepayConfig`
functions. It indicates the beginning of the function parameters
list. */
({
  enabled: parseEnvBoolean(process.env.MONGODB_SEPAY_SYNC_ENABLED, false),
  uri: String(process.env.MONGODB_URI || "").trim(),
  dbName: String(process.env.MONGODB_DB_NAME || "host_sepay").trim() || "host_sepay",
  transactionsCollection:
    String(process.env.MONGODB_SEPAY_TRANSACTIONS_COLLECTION || "tb_transactions").trim() ||
    "tb_transactions",
  ordersCollection:
    String(process.env.MONGODB_SEPAY_ORDERS_COLLECTION || "tb_orders").trim() || "tb_orders",
});

module.exports = {
  getMongoSepayConfig,
  parseEnvBoolean,
};
