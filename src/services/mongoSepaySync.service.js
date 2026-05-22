const { getMongoSepayConfig } = require("./mongoSepaySync/config");
const { syncSepayWebhookToMongoSafe } = require("./mongoSepaySync/sync");

module.exports = {
  getMongoSepayConfig,
  syncSepayWebhookToMongoSafe,
};
