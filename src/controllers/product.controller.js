const {
  createAdminProduct,
  deleteAdminProduct,
  deleteAllAdminProducts,
  getAdminProducts,
  hideAdminProduct,
  hideAllAdminProducts,
  showAdminProduct,
  updateAdminProduct,
} = require("./products/admin.controller");
const {
  getClientProducts,
  getFeaturedProducts,
  getProductDetail,
} = require("./products/client.controller");
const {
  createProductReview,
  deleteOwnProductReview,
  getCompareConfig,
  previewCompareProducts,
} = require("./products/engagement.controller");

module.exports = {
  getAdminProducts,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  deleteAllAdminProducts,
  hideAllAdminProducts,
  hideAdminProduct,
  showAdminProduct,
  getClientProducts,
  getFeaturedProducts,
  getProductDetail,
  getCompareConfig,
  previewCompareProducts,
  createProductReview,
  deleteOwnProductReview,
};
