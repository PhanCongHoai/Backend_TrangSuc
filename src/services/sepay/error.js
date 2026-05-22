class SepayVaError extends Error {
  constructor(message, { status = 500, details = null } = {}) {
    super(message);
    this.name = "SepayVaError";
    this.status = status;
    this.details = details;
  }
}

module.exports = {
  SepayVaError,
};
