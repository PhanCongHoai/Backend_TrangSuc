const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const forecastService = require("../src/services/forecast.service");

async function main() {
  console.log("=== CHAY THU AI FORECASTING ===");
  console.log("GEMINI API KEY:", process.env.GEMINI_API_KEY ? "DA CAU HINH" : "CHUA CAU HINH");
  console.log("OPENAI API KEY:", process.env.OPENAI_API_KEY ? "DA CAU HINH" : "CHUA CAU HINH");

  const report = await forecastService.runForecasting();

  if (report.success) {
    console.log(`\n[FORECAST SUCCESS] Mode: ${report.mode.toUpperCase()}`);
    console.log("\nKet qua bao cao du bao nhap hang (Restock recommendations):");
    
    report.data.forEach((p, idx) => {
      console.log(`\n--------------------------------------------`);
      console.log(`#${idx + 1} Tên sản phẩm: ${p.product_name}`);
      console.log(`- Mã sản phẩm gốc: ${p.original_product_id}`);
      console.log(`- Danh mục: ${p.category_name} | Chất liệu: ${p.material_type}`);
      console.log(`- Tồn kho thực tế: ${p.stock_quantity}`);
      console.log(`- Dự báo lượng bán (30 ngày tới): ${p.forecast_demand_30d}`);
      console.log(`- Trạng thái phân loại: ${p.status}`);
      console.log(`- Số lượng khuyên nhập: ${p.recommend_import_qty}`);
      console.log(`- Lý do đề xuất (AI/Math): ${p.reason}`);
    });
  } else {
    console.log("\n[FORECAST FAILED]");
    console.error("Loi:", report.error);
  }
  process.exit(0);
}

main().catch(err => {
  console.error("Loi chay test forecast:", err);
  process.exit(1);
});
