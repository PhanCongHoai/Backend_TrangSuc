const forecastService = require("../services/forecast.service");
const etlService = require("../services/etl.service");

// Lấy báo cáo dự báo nhập hàng AI từ DWH
async function getAiRestockForecast(req, res) {
  try {
    const report = await forecastService.runForecasting();
    if (!report.success) {
      return res.status(500).json({
        success: false,
        message: report.error || "Không thể khởi chạy mô hình dự báo AI."
      });
    }
    return res.json({
      success: true,
      mode: report.mode, // 'ai' hoặc 'statistical'
      data: report.data
    });
  } catch (error) {
    console.error("Lỗi API getAiRestockForecast:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi dự báo nhập hàng."
    });
  }
}

// Chạy ETL đồng bộ thủ công từ API
async function triggerEtlSync(req, res) {
  try {
    console.log("[API] Admin kích hoạt đồng bộ ETL thủ công...");
    const etlResult = await etlService.run();
    if (!etlResult.success) {
      return res.status(500).json({
        success: false,
        message: etlResult.error || "Đồng bộ ETL thất bại."
      });
    }
    return res.json({
      success: true,
      message: "Đồng bộ dữ liệu sang Kho DWH thành công.",
      data: etlResult
    });
  } catch (error) {
    console.error("Lỗi API triggerEtlSync:", error);
    return res.status(500).json({
      success: false,
      message: "Lỗi hệ thống khi đồng bộ ETL."
    });
  }
}

module.exports = {
  getAiRestockForecast,
  triggerEtlSync
};
