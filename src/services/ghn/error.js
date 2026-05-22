class GhnError extends Error {
  constructor(message, { status = 500, details = null } = {}) {
    super(message);
    this.name = "GhnError";
    this.status = status;
    this.details = details;
  }
}

module.exports = {
  GhnError,
};
