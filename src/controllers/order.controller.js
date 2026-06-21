const {
  getAdminDashboardSummary,
  getAdminOrders,
  getAdminRevenueReport,
  updateAdminOrderStatus,
} = require("./orders/admin.controller");
const {
  createCustomerOrder,
  getMyOrders,
  getMyOrderPaymentStatus,
  cancelCustomerOrder,
} = require("./orders/customer.controller");
const {
  createReturnRequest,
  getMyReturnRequests,
  getAdminReturnRequests,
  confirmAdminReturnRequest,
  rejectAdminReturnRequest,
} = require("./orders/return.controller");
const {
  streamAdminOrders,
  streamMyOrders,
} = require("./orders/realtime.controller");
const {
  getSepayWebhookHealth,
  handleSepayWebhook,
} = require("./orders/sepay.controller");

module.exports = {
  getAdminDashboardSummary,
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
  cancelCustomerOrder,
  createReturnRequest,
  getMyReturnRequests,
  getAdminReturnRequests,
  confirmAdminReturnRequest,
  rejectAdminReturnRequest,
};
