const { ghnRequest } = require("./client");

// Lấy danh sách tỉnh/thành từ bộ dữ liệu chuẩn của GHN.
const getProvinces = () =>
  ghnRequest({
    path: "/master-data/province",
  });

// Lấy danh sách quận/huyện theo tỉnh thành đã chọn.
const getDistricts = (provinceId) =>
  ghnRequest({
    path: "/master-data/district",
    query: {
      province_id: provinceId,
    },
  });

// Lấy danh sách phường/xã theo quận huyện đã chọn.
const getWards = (districtId) =>
  ghnRequest({
    path: "/master-data/ward",
    query: {
      district_id: districtId,
    },
  });

module.exports = {
  getDistricts,
  getProvinces,
  getWards,
};
