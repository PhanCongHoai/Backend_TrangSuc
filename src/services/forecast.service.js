const sql = require("mssql");
const { getDwhPool } = require("./etl.service");
const https = require("https");

// Helper: Gửi request API HTTPS
function requestJson({ hostname, path, method = "POST", headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : "";
    const req = https.request(
      {
        hostname,
        path,
        method,
        headers: {
          "Content-Type": "application/json",
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (e) {
            return reject(new Error("Không thể đọc phản hồi từ nhà cung cấp AI."));
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(parsed?.error?.message || "Lỗi gọi API."));
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------- Thuật toán Thống kê ----------------
// Áp dụng thuật toán San bằng số mũ đơn (Simple Exponential Smoothing)
function calculateForecastQuantity(salesHistory, alpha = 0.3) {
  if (!Array.isArray(salesHistory) || salesHistory.length === 0) {
    return 0;
  }
  
  // salesHistory là mảng lượng bán theo tuần (8 tuần gần nhất)
  let forecast = salesHistory[0];
  for (let i = 1; i < salesHistory.length; i++) {
    forecast = alpha * salesHistory[i] + (1 - alpha) * forecast;
  }

  // Kết quả trả về là dự báo lượng bán cho 1 tuần tiếp theo.
  // Quy đổi ra 4 tuần (30 ngày) = forecast * 4
  const monthlyForecast = forecast * 4;
  return Math.max(0, Math.round(monthlyForecast * 100) / 100);
}

class ForecastService {
  // Lấy dữ liệu bán hàng lịch sử từ DWH và chuẩn bị cho mô hình dự báo
  async prepareForecastingData() {
    try {
      const dwhPool = await getDwhPool();

      // Tính toán khóa ngày cách đây 60 ngày
      const date60DaysAgo = new Date();
      date60DaysAgo.setDate(date60DaysAgo.getDate() - 60);
      const recentDateKey = date60DaysAgo.getFullYear() * 10000 + (date60DaysAgo.getMonth() + 1) * 100 + date60DaysAgo.getDate();

      // 1. Lấy thông tin sản phẩm và tồn kho từ DWH
      console.log("[Forecast] Đang lấy danh sách sản phẩm và tổng lượng bán từ DWH...");
      const productsQuery = await dwhPool.request()
        .input("recentDateKey", sql.Int, recentDateKey)
        .query(`
          SELECT 
              p.product_key,
              p.original_product_id,
              p.product_name,
              p.category_name,
              p.material_type,
              p.stock_quantity,
              p.current_price,
              p.capital_cost,
              COALESCE((SELECT SUM(quantity_sold) FROM dbo.FACT_PRODUCT_SALES WHERE product_key = p.product_key), 0) AS total_sold_ever,
              COALESCE((SELECT SUM(quantity_sold) FROM dbo.FACT_PRODUCT_SALES WHERE product_key = p.product_key AND date_key >= @recentDateKey), 0) AS total_sold_60d
          FROM dbo.DIM_PRODUCTS p
          WHERE p.status = 'ACTIVE'
        `);

      const productsList = productsQuery.recordset;

      // 2. Lấy chi tiết lịch sử bán hàng theo ngày của 60 ngày gần đây
      console.log("[Forecast] Đang lấy chi tiết lịch sử bán hàng theo ngày...");
      const salesQuery = await dwhPool.request()
        .input("recentDateKey", sql.Int, recentDateKey)
        .query(`
          SELECT 
              product_key,
              date_key,
              SUM(quantity_sold) AS quantity_sold
          FROM dbo.FACT_PRODUCT_SALES
          WHERE date_key >= @recentDateKey
          GROUP BY product_key, date_key
          ORDER BY product_key, date_key ASC
        `);

      const salesData = salesQuery.recordset;

      // Nhóm lịch sử bán hàng theo sản phẩm
      const salesByProduct = {};
      for (const sale of salesData) {
        if (!salesByProduct[sale.product_key]) {
          salesByProduct[sale.product_key] = [];
        }
        salesByProduct[sale.product_key].push(sale);
      }

      // 3. Thực hiện tính toán dự báo cơ bản bằng thuật toán thống kê Exponential Smoothing
      const preparedData = productsList.map((prod) => {
        const productSales = salesByProduct[prod.product_key] || [];
        
        // Chia 60 ngày gần nhất thành 8 tuần để làm mượt số liệu
        const weeklySales = Array(8).fill(0);
        const now = new Date();

        for (const sale of productSales) {
          // Parse date_key YYYYMMDD thành đối tượng Date
          const year = Math.floor(sale.date_key / 10000);
          const month = Math.floor((sale.date_key % 10000) / 100) - 1;
          const day = sale.date_key % 100;
          const saleDate = new Date(year, month, day);

          const diffTime = Math.abs(now - saleDate);
          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          const weekIdx = Math.min(7, Math.floor(diffDays / 7)); // 0 = tuần này, 7 = 7 tuần trước
          
          weeklySales[7 - weekIdx] += sale.quantity_sold; // Đưa về dòng thời gian xuôi từ tuần xa nhất tới tuần gần nhất
        }

        // Tính lượng bán dự báo 30 ngày tới
        const mathForecast30Days = calculateForecastQuantity(weeklySales, 0.3);

        return {
          product_key: prod.product_key,
          original_product_id: prod.original_product_id,
          product_name: prod.product_name,
          category_name: prod.category_name,
          material_type: prod.material_type,
          stock_quantity: prod.stock_quantity,
          current_price: Number(prod.current_price || 0),
          capital_cost: Number(prod.capital_cost || 0),
          total_sold_60d: prod.total_sold_60d,
          math_forecast_30d: mathForecast30Days,
          weekly_sales_history: weeklySales
        };
      });

      return preparedData;
    } catch (error) {
      console.error("[Forecast] Lỗi chuẩn bị dữ liệu dự báo:", error.message);
      throw error;
    }
  }

  // Chạy mô hình dự báo AI kết hợp Gemini
  async runForecasting() {
    try {
      const preparedData = await this.prepareForecastingData();
      if (preparedData.length === 0) {
        return { success: true, data: [], message: "Không có sản phẩm nào để phân tích dự báo." };
      }

      const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
      const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();

      // Nếu không có API Key, tự động chuyển về chế độ dự báo Thống kê thuần túy làm Fallback
      if (!geminiApiKey && !openAiApiKey) {
        console.warn("[Forecast] Không tìm thấy API Key AI, chuyển sang chế độ dự báo Thống kê thuần (Fallback).");
        return {
          success: true,
          mode: "statistical",
          data: this.generateStatisticalFallback(preparedData)
        };
      }

      // Dựng prompt hệ thống phân tích gửi lên LLM
      const compactData = preparedData.map(p => ({
        id: p.original_product_id,
        name: p.product_name,
        category: p.category_name,
        stock: p.stock_quantity,
        sold_60d: p.total_sold_60d,
        math_forecast: p.math_forecast_30d
      }));

      const systemPrompt = `
You are an expert supply chain and inventory analyst for the JewelryBook shop.
Your job is to analyze historical sales data and current stock levels to output a restock prediction report.

For each product in the input list, generate:
1. "forecast_demand_30d": Estimated sales volume for the next 30 days. Recommend a value close to "math_forecast" but adjusted logically based on sold_60d.
2. "status":
   - "RESTOCK" (Need to import): if forecast_demand_30d > stock.
   - "STABLE" (No need to import): if stock >= forecast_demand_30d and sold_60d > 0.
   - "SLOW_MOVING" (Hard to sell): if sold_60d = 0 and stock > 0.
3. "recommend_import_qty": 
   - If status is "RESTOCK", quantity is (forecast_demand_30d - stock), rounded up.
   - Otherwise, 0.
4. "reason": A short explanation in Vietnamese (1-2 sentences) justifying your recommendation (e.g. why it is slow-moving, why we need to import more).

Output ONLY a JSON array matching this exact schema (no markdown, no greetings):
[
  {
    "original_product_id": number,
    "product_name": string,
    "forecast_demand_30d": number,
    "status": "RESTOCK" | "STABLE" | "SLOW_MOVING",
    "recommend_import_qty": number,
    "reason": string
  }
]
      `.trim();

      try {
        let aiResult = "";
        
        if (geminiApiKey) {
          const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
          const path = `/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;
          
          const response = await requestJson({
            hostname: "generativelanguage.googleapis.com",
            path,
            body: {
              systemInstruction: { parts: [{ text: systemPrompt }] },
              contents: [{ role: "user", parts: [{ text: `Analyze and forecast this product dataset:\n${JSON.stringify(compactData)}` }] }],
              generationConfig: { responseMimeType: "application/json", temperature: 0.1 }
            }
          });
          
          aiResult = response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        } else {
          // Fallback OpenAI
          const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
          const response = await requestJson({
            hostname: "api.openai.com",
            path: "/v1/chat/completions",
            headers: { Authorization: `Bearer ${openAiApiKey}` },
            body: {
              model,
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: JSON.stringify(compactData) }
              ],
              temperature: 0.1,
              response_format: { type: "json_object" }
            }
          });
          aiResult = response?.choices?.[0]?.message?.content || "";
        }

        let parsedReport = JSON.parse(aiResult);
        // Hỗ trợ nếu OpenAI bọc trong root key
        if (!Array.isArray(parsedReport) && parsedReport.data) {
          parsedReport = parsedReport.data;
        }

        if (Array.isArray(parsedReport)) {
          // Trộn thêm thông tin giá và danh mục từ preparedData
          const finalReport = parsedReport.map((aiItem) => {
            const originItem = preparedData.find(p => p.original_product_id === aiItem.original_product_id);
            return {
              ...aiItem,
              category_name: originItem?.category_name || "N/A",
              material_type: originItem?.material_type || "N/A",
              stock_quantity: originItem?.stock_quantity || 0,
              current_price: originItem?.current_price || 0,
              capital_cost: originItem?.capital_cost || 0
            };
          });
          return { success: true, mode: "ai", data: finalReport };
        }
        throw new Error("Dữ liệu phản hồi từ AI không đúng định dạng mảng.");
      } catch (aiErr) {
        console.error("[Forecast] Lỗi phân tích AI, chuyển sang dùng thuật toán Thống kê. Lỗi:", aiErr.message);
        return {
          success: true,
          mode: "statistical",
          data: this.generateStatisticalFallback(preparedData)
        };
      }

    } catch (error) {
      console.error("[Forecast] Tiến trình dự báo thất bại:", error.message);
      return { success: false, error: error.message };
    }
  }

  // Tạo báo cáo dự báo dự phòng (Fallback) bằng tính toán thống kê thuần túy
  generateStatisticalFallback(preparedData) {
    return preparedData.map((p) => {
      const forecastDemand = p.math_forecast_30d;
      let status = "STABLE";
      let recommendImport = 0;
      let reason = "";

      if (p.total_sold_60d === 0 && p.stock_quantity > 0) {
        status = "SLOW_MOVING";
        recommendImport = 0;
        reason = "Hàng bán chậm: Không có giao dịch phát sinh nào trong 60 ngày gần đây. Khuyến nghị KHÔNG nhập thêm để tránh tồn đọng vốn.";
      } else if (forecastDemand > p.stock_quantity) {
        status = "RESTOCK";
        recommendImport = Math.ceil(forecastDemand - p.stock_quantity);
        reason = `Cần nhập hàng: Dự báo lượng bán 30 ngày tới là ${Math.ceil(forecastDemand)} chiếc, vượt mức tồn kho hiện tại (${p.stock_quantity} chiếc). Đề xuất nhập thêm để đáp ứng nhu cầu.`;
      } else {
        status = "STABLE";
        recommendImport = 0;
        reason = `Tồn kho ổn định: Lượng hàng hiện tại (${p.stock_quantity} chiếc) đủ để phục vụ nhu cầu dự kiến 30 ngày tới (${Math.ceil(forecastDemand)} chiếc).`;
      }

      return {
        original_product_id: p.original_product_id,
        product_name: p.product_name,
        category_name: p.category_name,
        material_type: p.material_type,
        stock_quantity: p.stock_quantity,
        current_price: p.current_price,
        capital_cost: p.capital_cost,
        forecast_demand_30d: Math.ceil(forecastDemand),
        status,
        recommend_import_qty: recommendImport,
        reason
      };
    });
  }
}

module.exports = new ForecastService();
