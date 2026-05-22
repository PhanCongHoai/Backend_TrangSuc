const {
  getAdminOrders,
  getAdminRevenueReport,
  updateAdminOrderStatus,
} = require("./orders/admin.controller");
const {
  createCustomerOrder,
  getMyOrders,
  getMyOrderPaymentStatus,
} = require("./orders/customer.controller");
const {
  streamAdminOrders,
  streamMyOrders,
} = require("./orders/realtime.controller");
const {
  getSepayWebhookHealth,
  handleSepayWebhook,
} = require("./orders/sepay.controller");

module.exports = {
  createCustomerOrder,
  getAdminOrders,
  getMyOrders,
  getMyOrderPaymentStatus,
  getAdminRevenueReport,
  getSepayWebhookHealth,
  handleSepayWebhook,
  streamAdminOrders,
  streamMyOrders,
  updateAdminOrderStatus,
};
