const { getSepayVaConfig } = require("./config");
const { SepayVaError } = require("./error");
const { unwrapJsonPayload } = require("./shared");

const SEPAY_VA_API_BASE_URL = "https://userapi.sepay.vn/v2";

// Tạo header xác thực để gọi SePay API từ token đã cấu hình trong env.
const buildHeaders = () => {
  const config = getSepayVaConfig();

  if (!config.apiToken) {
    throw new SepayVaError("Thieu SEPAY_API_TOKEN de tao VA theo don hang.", {
      status: 500,
    });
  }

  return {
    Authorization: `Bearer ${config.apiToken}`,
    "Content-Type": "application/json",
  };
};

// Gọi API SePay để tạo VA theo đơn và trả lại cả response gốc lẫn payload đã parse.
const postSepayOrderVa = async ({ bankAccountXid, body }) => {
  const response = await fetch(
    `${SEPAY_VA_API_BASE_URL}/bank-accounts/${bankAccountXid}/orders`,
    {
      method: "POST",
      headers: buildHeaders(),
      body: JSON.stringify(body),
    }
  );

  return {
    response,
    payload: await unwrapJsonPayload(response),
  };
};

module.exports = {
  postSepayOrderVa,
};
