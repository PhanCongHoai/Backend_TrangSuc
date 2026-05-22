const { buildHeaders, getBaseUrl } = require("./config");
const { GhnError } = require("./error");
const {
  buildQueryString,
  normalizeGhnNetworkError,
  unwrapGhnPayload,
} = require("./shared");

// Hàm gọi GHN API dùng chung cho mọi endpoint, xử lý luôn parse payload và chuẩn hóa lỗi.
const ghnRequest = async ({
  method = "GET",
  path,
  query,
  body,
  includeShopId = true,
}) => {
  const url = `${getBaseUrl()}${path}${buildQueryString(query)}`;
  let response;

  try {
    response = await fetch(url, {
      method,
      headers: buildHeaders({ includeShopId }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw normalizeGhnNetworkError(error);
  }

  const payload = await unwrapGhnPayload(response);

  if (!response.ok) {
    throw new GhnError(
      payload?.message || payload?.code_message_value || "Khong the goi GHN API.",
      {
        status: response.status,
        details: payload,
      }
    );
  }

  if (payload && typeof payload === "object" && Number(payload.code) !== 200) {
    throw new GhnError(
      payload.message || payload.code_message_value || "GHN API tra ve loi.",
      {
        status: 502,
        details: payload,
      }
    );
  }

  return payload?.data ?? payload;
};

module.exports = {
  ghnRequest,
};
