const { poolPromise, sql } = require("../config/db");

// Chuẩn hóa khóa vật liệu để so khớp alias không bị lệch dấu hoặc định dạng.
const normalizeMaterialKey = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();

// Ánh xạ nhiều tên gọi vật liệu về một tên chuẩn thống nhất trong hệ thống.
const normalizeMaterialType = (value) => {
  const materialType = String(value || "").trim();
  const aliases = {
    "GOLD 24K": "Vàng 24K",
    "VANG 24K": "Vàng 24K",
    "GOLD 18K": "Vàng 18K",
    "VANG 18K": "Vàng 18K",
    "WHITE GOLD 10K": "Vàng trắng 18K",
    "WHITE GOLD 18K": "Vàng trắng 18K",
    "VANG TRANG": "Vàng trắng 18K",
    "VANG TRANG 18K": "Vàng trắng 18K",
    "SILVER 925": "Bạc 925",
    "BAC 925": "Bạc 925",
    PLATINUM: "Bạch kim",
    "BACH KIM": "Bạch kim",
  };

  return aliases[normalizeMaterialKey(materialType)] || materialType;
};

// Chuẩn hóa một bản ghi giá vàng về tên vật liệu canonical.
const toCanonicalGoldRate = (item) => ({
  ...item,
  material_type: normalizeMaterialType(item.material_type),
});

// Lấy bản ghi giá mới nhất cho từng loại vật liệu sau khi đã canonical hóa.
const getLatestRatesByCanonicalMaterial = (records) => {
  const latestByMaterial = new Map();

  records.forEach((item) => {
    const normalizedItem = toCanonicalGoldRate(item);
    const currentItem = latestByMaterial.get(normalizedItem.material_type);
    if (
      !currentItem ||
      Number(normalizedItem.id || 0) > Number(currentItem.id || 0)
    ) {
      latestByMaterial.set(normalizedItem.material_type, normalizedItem);
    }
  });

  return Array.from(latestByMaterial.values()).sort((left, right) =>
    left.material_type.localeCompare(right.material_type, "vi")
  );
};

// Lấy lịch sử giá vàng/nguyên liệu để hiển thị trong admin.
const getGoldRates = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        id,
        material_type,
        base_sell_price,
        recorded_at,
        CONVERT(varchar(19), recorded_at, 120) AS recorded_at_text
      FROM gold_rate_history
      ORDER BY id DESC
    `);

    const goldRates = result.recordset.map(toCanonicalGoldRate);

    return res.status(200).json({
      success: true,
      goldRates,
      currentRates: getLatestRatesByCanonicalMaterial(result.recordset),
    });
  } catch (error) {
    console.error("Get gold rates error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Lấy danh sách loại nguyên liệu cùng mức giá mới nhất của từng loại.
const getMaterialOptions = async (req, res) => {
  try {
    const pool = await poolPromise;

    const result = await pool.request().query(`
      SELECT
        id,
        material_type,
        base_sell_price,
        recorded_at,
        CONVERT(varchar(19), recorded_at, 120) AS recorded_at_text
      FROM gold_rate_history
      WHERE LTRIM(RTRIM(ISNULL(material_type, ''))) <> ''
      ORDER BY id DESC
    `);

    return res.status(200).json({
      success: true,
      materials: getLatestRatesByCanonicalMaterial(result.recordset),
    });
  } catch (error) {
    console.error("Get material options error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

// Tạo một bản ghi giá vàng/nguyên liệu mới.
const createGoldRate = async (req, res) => {
  try {
    const { material_type, base_sell_price, recorded_at } = req.body;

    if (!material_type || !String(material_type).trim()) {
      return res.status(400).json({
        success: false,
        message: "material_type is required.",
      });
    }

    const normalizedMaterialType = normalizeMaterialType(material_type);
    const normalizedPrice = Number(base_sell_price);
    const normalizedRecordedAt = recorded_at ? new Date(recorded_at) : null;

    if (Number.isNaN(normalizedPrice) || normalizedPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: "base_sell_price must be a valid positive number.",
      });
    }

    if (normalizedRecordedAt && Number.isNaN(normalizedRecordedAt.getTime())) {
      return res.status(400).json({
        success: false,
        message: "recorded_at is invalid.",
      });
    }

    const pool = await poolPromise;

    const insertResult = await pool
      .request()
      .input("MaterialType", sql.NVarChar(50), normalizedMaterialType)
      .input("BaseSellPrice", sql.Decimal(15, 2), normalizedPrice)
      .input("RecordedAt", sql.DateTime, normalizedRecordedAt)
      .query(`
        INSERT INTO gold_rate_history (material_type, base_sell_price, recorded_at)
        OUTPUT
          INSERTED.id,
          INSERTED.material_type,
          INSERTED.base_sell_price,
          INSERTED.recorded_at,
          CONVERT(varchar(19), INSERTED.recorded_at, 120) AS recorded_at_text
        VALUES (@MaterialType, @BaseSellPrice, ISNULL(@RecordedAt, GETDATE()))
      `);

    return res.status(201).json({
      success: true,
      message: "Gold rate created successfully.",
      goldRate: insertResult.recordset[0],
    });
  } catch (error) {
    console.error("Create gold rate error:", error);
    return res.status(500).json({
      success: false,
      message: "Server error.",
    });
  }
};

module.exports = {
  getGoldRates,
  getMaterialOptions,
  createGoldRate,
};
