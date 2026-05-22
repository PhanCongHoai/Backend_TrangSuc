const { getMongoSepayConfig } = require("./config");

let mongoClientPromise = null;
let mongoDriverLoadAttempted = false;
let cachedMongoClientConstructor = null;
let lastMongoWarningKey = "";

// Ghi cảnh báo MongoDB theo từng khóa để tránh log lặp lại quá nhiều lần.
const logMongoWarningOnce = (key, message, details = null) => {
  if (lastMongoWarningKey === key) {
    return;
  }

  lastMongoWarningKey = key;

  if (details) {
    console.warn(message, details);
    return;
  }

  console.warn(message);
};

// Lazy-load MongoDB driver để backend vẫn chạy được ngay cả khi chưa cài package.
const loadMongoClientConstructor = () => {
  if (cachedMongoClientConstructor || mongoDriverLoadAttempted) {
    return cachedMongoClientConstructor;
  }

  mongoDriverLoadAttempted = true;

  try {
    ({ MongoClient: cachedMongoClientConstructor } = require("mongodb"));
  } catch (error) {
    logMongoWarningOnce(
      "mongodb-driver-missing",
      '[MongoDB] Chua co package "mongodb". Hay chay "npm install mongodb" de bat dong bo SePay.',
      error?.message ? { message: error.message } : null
    );
    cachedMongoClientConstructor = null;
  }

  return cachedMongoClientConstructor;
};

// Lấy database MongoDB đang dùng cho luồng đồng bộ SePay, tự tạo kết nối dùng chung khi cần.
const getMongoDatabase = async () => {
  const config = getMongoSepayConfig();

  if (!config.enabled) {
    return null;
  }

  if (!config.uri) {
    logMongoWarningOnce(
      "mongodb-uri-missing",
      "[MongoDB] Chua cau hinh MONGODB_URI nen bo qua dong bo SePay sang MongoDB."
    );
    return null;
  }

  const MongoClient = loadMongoClientConstructor();

  if (!MongoClient) {
    return null;
  }

  if (!mongoClientPromise) {
    mongoClientPromise = new MongoClient(config.uri).connect().catch((error) => {
      mongoClientPromise = null;
      throw error;
    });
  }

  const client = await mongoClientPromise;
  return client.db(config.dbName);
};

module.exports = {
  getMongoDatabase,
};
