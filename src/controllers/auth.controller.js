const { login, register } = require("./auth/account.controller");
const {
  requestPasswordReset,
  resetPassword,
  verifyPasswordResetToken,
} = require("./auth/password.controller");

module.exports = {
  login,
  register,
  requestPasswordReset,
  resetPassword,
  verifyPasswordResetToken,
};
