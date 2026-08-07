// Chuan hoa danh sach san pham tu request truoc khi dung de tao don hang.
const normalizeOrderItems = (items = []) =>
  Array.isArray(items)
    ? items
        .map((item) => ({
          productId: Number(item?.productId || 0),
          variantId: Number(item?.variantId || 0),
          name: String(item?.name || "").trim(),
          quantity: Math.max(1, Number(item?.quantity || 1)),
          unitPrice: Math.max(0, Number(item?.price ?? item?.unitPrice ?? 0)),
        }))
        .filter((item) => item.variantId > 0 && item.quantity > 0)
    : [];

// Parse chuỗi JSON an toàn và trả fallback nếu dữ liệu lỗi hoặc rỗng.
const parseJsonSafe = (value, fallback = null) => {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
};

// Sinh tiêu đề đơn hàng từ tên tường minh hoặc danh sách sản phẩm.
const buildOrderTitle = (items = [], explicitName = "") => {
  const normalizedName = String(explicitName || "").trim();

  if (normalizedName) {
    return normalizedName;
  }

  if (items.length === 1) {
    return items[0].name || "Đơn hàng trang sức";
  }

  if (items.length > 1) {
    return `Đơn hàng gồm ${items.length} sản phẩm`;
  }

  return "Đơn hàng trang sức";
};

// Ánh xạ mã phương thức thanh toán sang nhãn hiển thị cho người dùng.
const mapPaymentMethod = (value) => {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();

  if (normalized === "cod") return "Thanh toán khi nhận hàng";
  if (normalized === "prepaid") return "Thanh toán trước";
  if (normalized === "bank") return "Chuyển khoản";
  if (normalized === "wallet") return "Ví điện tử";
  return "Chưa xác định";
};

// Ánh xạ trạng thái đơn hàng nội bộ sang nhãn tiếng Việt.
const mapOrderStatus = (value) => {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();

  if (normalized === "PENDING") return "Đã ghi nhận";
  if (normalized === "PROCESSING") return "Đang xử lý";
  if (normalized === "SHIPPING") return "Đang giao hàng";
  if (normalized === "COMPLETED") return "Hoàn tất";
  if (normalized === "CANCELLED") return "Đã hủy";
  return "Đã ghi nhận";
};

// Giới hạn giá trị số trong một khoảng xác định và dùng fallback nếu dữ liệu lỗi.
const clampNumber = (value, min, max, fallback) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, Math.trunc(parsedValue)));
};

// Lấy năm và tháng hiện tại theo múi giờ Việt Nam để làm mặc định cho báo cáo.
const getVietnamNow = () => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const getPart = (type) => Number(parts.find((part) => part.type === type)?.value || 0);

  return {
    year: getPart("year"),
    month: getPart("month"),
  };
};

// Chuẩn hóa bộ lọc báo cáo doanh thu từ query string.
const normalizeReportFilters = (query = {}) => {
  const now = getVietnamNow();
  const period = ["day", "month", "year"].includes(String(query.period || "").toLowerCase())
    ? String(query.period || "").toLowerCase()
    : "day";
  const year = clampNumber(query.year, 2000, 2100, now.year);
  const month = clampNumber(query.month, 1, 12, now.month);

  return { period, year, month };
};

// Chuẩn hóa một dòng dữ liệu báo cáo SQL về cấu trúc frontend đang dùng.
const mapReportRow = (row) => ({
  bucket: String(row.bucket || ""),
  label: String(row.label || row.bucket || ""),
  revenue: Number(row.revenue || 0),
  completedRevenue: Number(row.completed_revenue || 0),
  orders: Number(row.order_count || 0),
  cancelledOrders: Number(row.cancelled_count || 0),
});

// Tính toán các chỉ số tổng quan từ danh sách dòng báo cáo đã chuẩn hóa.
const buildReportSummary = (rows = []) => {
  const totalRevenue = rows.reduce((sum, item) => sum + item.revenue, 0);
  const completedRevenue = rows.reduce((sum, item) => sum + item.completedRevenue, 0);
  const totalOrders = rows.reduce((sum, item) => sum + item.orders, 0);
  const cancelledOrders = rows.reduce((sum, item) => sum + item.cancelledOrders, 0);

  return {
    totalRevenue,
    completedRevenue,
    totalOrders,
    cancelledOrders,
    averageOrderValue: totalOrders ? Math.round(totalRevenue / totalOrders) : 0,
  };
};

const ADMIN_ORDER_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "SHIPPING",
  "COMPLETED",
  "CANCELLED",
]);

// Định dạng tiền tệ VND để hiển thị ở màn hình quản trị và lịch sử đơn.
const formatCurrency = (value) =>
  new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));

// Định dạng ngày giờ sang chuỗi dễ đọc theo locale Việt Nam.
const formatDateTime = (value) => {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hourCycle: "h23",
  }).format(new Date(value));
};

// Chuẩn hóa danh sách sản phẩm đã lưu để gửi tiếp cho GHN.
const buildStoredOrderGhnItems = (items = []) =>
  items
    .map((item) => ({
      name: String(item?.product_name || item?.name || "").trim(),
      code: String(item?.sku || item?.variant_id || item?.product_id || "").trim() || undefined,
      quantity: Math.max(1, Number(item?.quantity || 1)),
      price: Math.max(0, Number(item?.unit_price || item?.price || 0)),
      category: {
        level1: "Trang suc",
      },
    }))
    .filter((item) => item.name);

const PAYMENT_REFERENCE_PREFIX = String(process.env.SEPAY_ORDER_CODE_PREFIX || "DH")
  .trim()
  .toUpperCase();

// Sinh mã đơn nội bộ hiển thị trong hệ thống quản trị.
const buildInternalOrderCode = (orderId) => `OD${String(orderId).padStart(5, "0")}`;

// Sinh mã tham chiếu thanh toán dùng cho SePay và đối soát chuyển khoản.
const buildPaymentReference = (orderId) =>
  `${PAYMENT_REFERENCE_PREFIX || "DH"}${String(orderId).padStart(6, "0")}`;

// Làm tròn số tiền để so sánh và lưu trữ nhất quán.
const normalizeMoney = (value) => Math.round(Number(value || 0));

// Chuyển đầu vào về số nguyên dương, nếu không hợp lệ thì trả null.
const toPositiveIntegerOrNull = (value) => {
  const parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
};

// Đọc cấu hình SePay QR tĩnh từ biến môi trường để phục vụ luồng thanh toán trước.
const getSepayConfig = () => {
  const accountNumber = String(process.env.SEPAY_ACCOUNT_NUMBER || "").trim();
  const bankCode = String(process.env.SEPAY_BANK_CODE || "").trim();
  const bankName = String(process.env.SEPAY_BANK_NAME || bankCode).trim();
  const template = String(process.env.SEPAY_QR_TEMPLATE || "compact").trim();

  return {
    accountNumber,
    bankCode,
    bankName,
    template: template || "compact",
    enabled: Boolean(accountNumber && bankCode),
  };
};

// Tạo URL ảnh QR SePay từ thông tin tài khoản, số tiền và nội dung chuyển khoản.
const buildSepayQrUrl = ({ accountNumber, bankCode, amount, content, template }) => {
  if (!accountNumber || !bankCode || !content) {
    return null;
  }

  const searchParams = new URLSearchParams({
    acc: String(accountNumber),
    bank: String(bankCode),
    amount: String(normalizeMoney(amount)),
    des: String(content),
    template: String(template || "compact"),
  });

  return `https://qr.sepay.vn/img?${searchParams.toString()}`;
};

// Chuẩn hóa số tài khoản hoặc sub-account để đối chiếu không lệch định dạng.
const normalizeAccountIdentifier = (value) =>
  String(value || "")
    .replace(/\s+/g, "")
    .trim()
    .toUpperCase();

// Dựng payload thanh toán SePay theo chế độ QR tĩnh.
const buildStaticSepayPayment = ({ amount, paymentReference, sepayConfig, warning = null }) => {
  const qrCodeUrl = buildSepayQrUrl({
    accountNumber: sepayConfig.accountNumber,
    bankCode: sepayConfig.bankCode,
    amount,
    content: paymentReference,
    template: sepayConfig.template,
  });

  return {
    method: "prepaid",
    status: "UNPAID",
    amount,
    provider: "sepay",
    mode: "static_qr",
    isVirtualAccount: false,
    paymentReference,
    transferContent: paymentReference,
    qrCodeUrl,
    bankCode: sepayConfig.bankCode || null,
    bankName: sepayConfig.bankName || null,
    accountNumber: sepayConfig.accountNumber || null,
    accountHolderName: null,
    qrTemplate: sepayConfig.template || "compact",
    qrEnabled: Boolean(qrCodeUrl),
    expiresAt: null,
    warning: warning || null,
  };
};

// Dựng payload thanh toán SePay theo chế độ virtual account riêng.
const buildVirtualAccountPayment = ({
  amount,
  paymentReference,
  vaOrder,
  qrTemplate,
  warning = null,
}) => ({
  method: "prepaid",
  status: "UNPAID",
  amount,
  provider: "sepay",
  mode: "virtual_account",
  isVirtualAccount: true,
  paymentReference,
  transferContent: vaOrder.orderCode || paymentReference || "",
  qrCodeUrl: vaOrder.qrCodeUrl || null,
  bankCode: vaOrder.bankCode || String(process.env.SEPAY_BANK_CODE || "").trim() || null,
  bankName:
    vaOrder.bankName ||
    String(process.env.SEPAY_BANK_NAME || process.env.SEPAY_BANK_CODE || "").trim() ||
    null,
  accountNumber: vaOrder.vaNumber || null,
  accountHolderName: vaOrder.accountHolderName || vaOrder.vaHolderName || null,
  qrTemplate: qrTemplate || "compact",
  qrEnabled: Boolean(vaOrder.qrCodeUrl),
  expiresAt: vaOrder.expiredAt || null,
  warning: warning || null,
});

// Dựng payload thanh toán từ shared VA khi hệ thống dùng chung một tài khoản ảo.
const buildSharedVirtualAccountPayment = ({
  amount,
  paymentReference,
  sharedVaConfig,
  warning = null,
}) => {
  const qrCodeUrl = buildSepayQrUrl({
    accountNumber: sharedVaConfig.vaNumber,
    bankCode: sharedVaConfig.bankCode,
    amount,
    content: paymentReference,
    template: sharedVaConfig.qrTemplate,
  });

  return buildVirtualAccountPayment({
    amount,
    paymentReference,
    qrTemplate: sharedVaConfig.qrTemplate,
    warning,
    vaOrder: {
      orderCode: paymentReference,
      vaNumber: sharedVaConfig.vaNumber,
      bankCode: sharedVaConfig.bankCode,
      bankName: sharedVaConfig.bankName,
      accountHolderName: sharedVaConfig.accountHolderName || null,
      expiredAt: null,
      qrCodeUrl,
    },
  });
};

// Lấy các tài khoản đích khả dĩ từ webhook SePay để phục vụ đối soát.
const extractSepayAccountTargets = (sepayPayload = {}) => {
  const configuredAccount = normalizeAccountIdentifier(process.env.SEPAY_ACCOUNT_NUMBER || "");
  const identifiers = new Set();

  [sepayPayload.subAccount, sepayPayload.accountNumber].forEach((value) => {
    const normalizedValue = normalizeAccountIdentifier(value);

    if (!normalizedValue) {
      return;
    }

    if (configuredAccount && normalizedValue === configuredAccount) {
      return;
    }

    identifiers.add(normalizedValue);
  });

  return [...identifiers];
};

// Lấy các tài khoản thanh toán đã lưu trong payment log của đơn hàng.
const getStoredPaymentAccountTargets = (paymentLog = {}) => {
  const identifiers = new Set();

  [
    paymentLog?.virtualAccountNumber,
    paymentLog?.sepay?.vaNumber,
    paymentLog?.sepay?.virtualAccountNumber,
    paymentLog?.sepay?.subAccount,
  ].forEach((value) => {
    const normalizedValue = normalizeAccountIdentifier(value);

    if (normalizedValue) {
      identifiers.add(normalizedValue);
    }
  });

  return [...identifiers];
};

// Escape ký tự đặc biệt trước khi dùng giá trị trong biểu thức SQL LIKE.
const escapeLikePattern = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/\[/g, "\\[");

// Lấy giá trị header an toàn và chuẩn hóa về string.
const getHeaderValue = (headers = {}, key = "") => {
  const directValue = headers?.[key];

  if (Array.isArray(directValue)) {
    return String(directValue[0] || "").trim();
  }

  return String(directValue || "").trim();
};

// Tìm giá trị đầu tiên có ý nghĩa trong một danh sách key đồng nghĩa.
const pickFirstDefinedValue = (source = {}, keys = []) => {
  for (const key of keys) {
    const value = source?.[key];

    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return value;
    }
  }

  return null;
};

// Chuẩn hóa một giá trị tùy chọn về string hoặc null.
const toOptionalString = (value) => {
  if (value === undefined || value === null) {
    return null;
  }

  const normalizedValue = String(value).trim();
  return normalizedValue || null;
};

// Chuẩn hóa string tùy chọn về chữ thường để so sánh logic.
const toOptionalLowercaseString = (value) => {
  const normalizedValue = toOptionalString(value);
  return normalizedValue ? normalizedValue.toLowerCase() : "";
};

// Chuẩn hóa số tùy chọn, trả null nếu không phải number hợp lệ.
const toOptionalNumber = (value) => {
  const parsedValue = Number(value);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

// Parse biến môi trường boolean theo nhiều dạng nhập phổ biến.
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

// Đọc quy tắc bảo mật secret cho webhook SePay.
const getSepayWebhookSecurityConfig = () => {
  const expectedSecret = String(process.env.SEPAY_WEBHOOK_SECRET || "").trim();
  const requireSecret = parseEnvBoolean(
    process.env.SEPAY_WEBHOOK_REQUIRE_SECRET,
    Boolean(expectedSecret),
  );

  return {
    expectedSecret,
    requireSecret,
  };
};

// Kiểm tra request webhook SePay có thỏa secret hợp lệ hay không.
const isSepayWebhookAuthorized = (req) => {
  const { expectedSecret, requireSecret } = getSepayWebhookSecurityConfig();

  if (!requireSecret || !expectedSecret) {
    return true;
  }

  const authorizationHeader = getHeaderValue(req.headers, "authorization");
  const bearerToken = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice(7).trim()
    : "";
  const apiKeyToken = authorizationHeader.startsWith("Apikey ")
    ? authorizationHeader.slice(7).trim()
    : "";
  const headerSecret =
    getHeaderValue(req.headers, "x-secret-key") ||
    getHeaderValue(req.headers, "x-sepay-webhook-secret") ||
    getHeaderValue(req.headers, "x-webhook-secret");
  const querySecret = String(req.query?.secret || "").trim();

  return [bearerToken, apiKeyToken, headerSecret, querySecret].some(
    (value) => value && value === expectedSecret,
  );
};

// Chuẩn hóa nhiều biến thể payload SePay về một schema chung của backend.
const normalizeSepayPayload = (payload = {}) => {
  const transferAmount = toOptionalNumber(
    pickFirstDefinedValue(payload, [
      "transferAmount",
      "transfer_amount",
      "amount",
      "creditAmount",
      "credit_amount",
    ]),
  );
  const accumulated = toOptionalNumber(
    pickFirstDefinedValue(payload, ["accumulated", "balance", "runningBalance"]),
  );

  return {
    id: Math.max(
      0,
      Number(
        pickFirstDefinedValue(payload, ["id", "transactionId", "transaction_id"]) || 0,
      ),
    ),
    gateway: toOptionalString(pickFirstDefinedValue(payload, ["gateway", "bankCode", "bank_code"])),
    transactionDate: toOptionalString(
      pickFirstDefinedValue(payload, [
        "transactionDate",
        "transaction_date",
        "createdAt",
        "created_at",
      ]),
    ),
    accountNumber: toOptionalString(
      pickFirstDefinedValue(payload, ["accountNumber", "account_number", "account"]),
    ),
    code: toOptionalString(pickFirstDefinedValue(payload, ["code", "transactionCode"])),
    content: toOptionalString(pickFirstDefinedValue(payload, ["content", "description", "desc"])),
    transferType: toOptionalLowercaseString(
      pickFirstDefinedValue(payload, [
        "transferType",
        "transfer_type",
        "transactionType",
        "transaction_type",
        "type",
      ]),
    ),
    transferAmount: Math.max(0, transferAmount || 0),
    accumulated: accumulated ?? 0,
    subAccount: toOptionalString(
      pickFirstDefinedValue(payload, ["subAccount", "sub_account", "virtualAccount", "virtual_account"]),
    ),
    referenceCode: toOptionalString(
      pickFirstDefinedValue(payload, ["referenceCode", "reference_code", "reference"]),
    ),
    description: toOptionalString(
      pickFirstDefinedValue(payload, ["description", "detail", "note"]),
    ),
  };
};

// Tạo object debug ngắn gọn để log request webhook SePay.
const buildSepayWebhookDebugInfo = (req) => ({
  timestamp: new Date().toISOString(),
  method: req.method,
  path: req.originalUrl,
  ip:
    getHeaderValue(req.headers, "cf-connecting-ip") ||
    getHeaderValue(req.headers, "x-forwarded-for") ||
    req.ip ||
    "",
  userAgent: getHeaderValue(req.headers, "user-agent"),
  hasAuthorizationHeader: Boolean(getHeaderValue(req.headers, "authorization")),
  hasSecretHeader: Boolean(
    getHeaderValue(req.headers, "x-secret-key") ||
      getHeaderValue(req.headers, "x-sepay-webhook-secret") ||
      getHeaderValue(req.headers, "x-webhook-secret"),
  ),
  queryKeys: Object.keys(req.query || {}),
  bodyKeys:
    req.body && typeof req.body === "object" && !Array.isArray(req.body)
      ? Object.keys(req.body)
      : [],
  secretRequired: getSepayWebhookSecurityConfig().requireSecret,
});

// Trích xuất các mã tham chiếu đơn hàng có thể xuất hiện trong payload SePay.
const extractSepayReferences = (...values) => {
  const references = new Set();

  values
    .flat()
    .filter(Boolean)
    .forEach((value) => {
      const normalizedValue = String(value).trim().toUpperCase();

      if (!normalizedValue) {
        return;
      }

      if (/^[A-Z]{1,6}\d{1,12}$/.test(normalizedValue)) {
        references.add(normalizedValue);
      }

      const matches = normalizedValue.match(/\b(?:DH|OD)\d{1,12}\b/g) || [];
      matches.forEach((match) => references.add(match));
    });

  return [...references];
};

// Suy ra order id từ mã tham chiếu như DH000123 hoặc OD00123.
const extractOrderIdFromReference = (value) => {
  const normalizedValue = String(value || "").trim().toUpperCase();
  const prefixedMatch = normalizedValue.match(/^(?:DH|OD)(\d{1,12})$/);

  if (prefixedMatch) {
    return Number(prefixedMatch[1]);
  }

  if (/^\d{1,12}$/.test(normalizedValue)) {
    return Number(normalizedValue);
  }

  return 0;
};

// Chấm điểm và chọn đơn hàng phù hợp nhất để đối soát từ dữ liệu webhook SePay.
const pickSepayCandidateOrder = (
  orders = [],
  sepayPayload,
  candidateRefs = [],
  candidateOrderIds = [],
  candidateAccounts = [],
) => {
  const normalizedTexts = [
    sepayPayload.code,
    sepayPayload.content,
    sepayPayload.referenceCode,
    sepayPayload.description,
    sepayPayload.subAccount,
    sepayPayload.accountNumber,
  ]
    .filter(Boolean)
    .map((value) => String(value).toUpperCase());

  const scoredOrders = orders.map((order) => {
    const paymentLog = parseJsonSafe(order.payment_log, {});
    const paymentReference = String(paymentLog?.paymentReference || "")
      .trim()
      .toUpperCase();
    const internalOrderCode = buildInternalOrderCode(order.id).toUpperCase();
    const accountTargets = getStoredPaymentAccountTargets(paymentLog);
    const accountMatched = accountTargets.some((value) => candidateAccounts.includes(value));
    const referenceMatched = Boolean(paymentReference && candidateRefs.includes(paymentReference));
    const textMatched =
      paymentReference &&
      normalizedTexts.some((value) => value.includes(paymentReference));
    const amountExpected = Number(order.payment_amount || order.total_amount || 0);
    const amountMatched = normalizeMoney(amountExpected) === normalizeMoney(sepayPayload.transferAmount);

    let priority = 0;

    if (accountMatched && referenceMatched) {
      priority = 600;
    } else if (referenceMatched) {
      priority = 500;
    } else if (accountMatched) {
      priority = 150;
    } else if (candidateRefs.includes(internalOrderCode)) {
      priority = 400;
    } else if (candidateOrderIds.includes(Number(order.id))) {
      priority = 300;
    } else if (textMatched) {
      priority = 200;
    } else if (normalizedTexts.some((value) => value.includes(internalOrderCode))) {
      priority = 100;
    }

    if (String(order.payment_method || "").trim().toLowerCase() === "cod") {
      priority -= 1000;
    }

    return {
      ...order,
      amountExpected,
      amountMatched,
      accountTargets,
      paymentReference,
      internalOrderCode,
      priority,
    };
  });

  const exactMatch = scoredOrders
    .filter((order) => order.priority > 0 && order.amountMatched)
    .sort((left, right) => right.priority - left.priority || right.id - left.id)[0];

  if (exactMatch) {
    return { order: exactMatch, reason: "MATCHED" };
  }

  const referenceMatch = scoredOrders
    .filter((order) => order.priority > 0)
    .sort((left, right) => right.priority - left.priority || right.id - left.id)[0];

  if (referenceMatch) {
    return { order: referenceMatch, reason: "AMOUNT_MISMATCH" };
  }

  return { order: null, reason: "ORDER_NOT_FOUND" };
};

module.exports = {
  ADMIN_ORDER_STATUSES,
  buildInternalOrderCode,
  buildOrderTitle,
  buildPaymentReference,
  buildReportSummary,
  buildSepayQrUrl,
  buildSepayWebhookDebugInfo,
  buildSharedVirtualAccountPayment,
  buildStaticSepayPayment,
  buildStoredOrderGhnItems,
  escapeLikePattern,
  extractOrderIdFromReference,
  extractSepayAccountTargets,
  extractSepayReferences,
  formatCurrency,
  formatDateTime,
  getHeaderValue,
  getSepayConfig,
  getSepayWebhookSecurityConfig,
  getStoredPaymentAccountTargets,
  isSepayWebhookAuthorized,
  mapOrderStatus,
  mapPaymentMethod,
  mapReportRow,
  normalizeAccountIdentifier,
  normalizeMoney,
  normalizeOrderItems,
  normalizeReportFilters,
  normalizeSepayPayload,
  parseEnvBoolean,
  parseJsonSafe,
  pickFirstDefinedValue,
  pickSepayCandidateOrder,
  toOptionalLowercaseString,
  toOptionalNumber,
  toOptionalString,
  toPositiveIntegerOrNull,
};
