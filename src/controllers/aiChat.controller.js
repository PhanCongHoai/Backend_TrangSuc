const https = require("https");
const fs = require("fs");
const path = require("path");
const { poolPromise, sql } = require("../config/db");
const ragService = require("../services/rag.service");

// Khởi chạy tiến trình load/nhúng tài liệu RAG bất đồng bộ
ragService.initialize().catch((err) => {
  console.error("Lỗi khi tự động khởi tạo RAG Service:", err.message);
});

const OPENAI_API_HOST = "api.openai.com";
const OPENAI_API_PATH = "/v1/chat/completions";

const GEMINI_API_HOST = "generativelanguage.googleapis.com";
const GEMINI_API_VERSION = "v1beta";

const MAX_MESSAGE_LENGTH = 1200;
const MAX_HISTORY_ITEMS = 12;

const SYSTEM_PROMPT = `
Ban la tro ly tu van trang suc cho website JewelryBook.
- Tra loi bang tieng Viet, ngan gon, de hieu, giong than thien.
- Tap trung tu van: chon loai trang suc, chat lieu, phong cach, cach phoi, bao quan.
- Neu nguoi dung khong cung cap du du lieu, hay hoi 1-2 cau lam ro.
- Khong bia thong tin ton kho hay gia cu the neu khong co du lieu tu he thong.
`.trim();

// Gửi request HTTPS dạng JSON tới nhà cung cấp AI và parse phản hồi.
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

        res.on("data", (chunk) => {
          raw += chunk;
        });

        res.on("end", () => {
          let parsed = {};

          try {
            parsed = raw ? JSON.parse(raw) : {};
          } catch (error) {
            return reject(new Error("Khong the doc phan hoi tu nha cung cap AI."));
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const providerMessage =
              parsed?.error?.message || "Nha cung cap AI tra ve loi khi tao tu van.";
            return reject(new Error(providerMessage));
          }

          resolve(parsed);
        });
      }
    );

    req.on("error", reject);

    if (payload) {
      req.write(payload);
    }

    req.end();
  });
}

// Gọi OpenAI Chat Completions để lấy phản hồi tư vấn trang sức.
async function callOpenAIChatCompletion({ apiKey, model, messages }) {
  const parsedBody = await requestJson({
    hostname: OPENAI_API_HOST,
    path: OPENAI_API_PATH,
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      temperature: 0.5,
      messages,
    },
  });

  const reply = parsedBody?.choices?.[0]?.message?.content;

  if (!reply || !String(reply).trim()) {
    throw new Error("OpenAI chua tra noi dung tu van hop le.");
  }

  return String(reply).trim();
}

// Chuyển lịch sử hội thoại sang cấu trúc contents mà Gemini yêu cầu.
function toGeminiContents(history, userMessage) {
  const mappedHistory = history.map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: [{ text: item.content }],
  }));

  return [...mappedHistory, { role: "user", parts: [{ text: userMessage }] }];
}

// Gọi Gemini Generate Content để lấy phản hồi tư vấn từ lịch sử chat.
async function callGeminiGenerateContent({ apiKey, model, history, message, systemPrompt }) {
  const path = `/${GEMINI_API_VERSION}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parsedBody = await requestJson({
    hostname: GEMINI_API_HOST,
    path,
    body: {
      systemInstruction: {
        parts: [{ text: systemPrompt || SYSTEM_PROMPT }],
      },
      contents: toGeminiContents(history, message),
      generationConfig: {
        temperature: 0.5,
      },
    },
  });

  const parts = parsedBody?.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts)
    ? parts
        .map((part) => String(part?.text || "").trim())
        .filter(Boolean)
        .join("\n")
    : "";

  if (!reply) {
    throw new Error("Gemini chua tra noi dung tu van hop le.");
  }

  return reply;
}

// Hàm wrapper hỗ trợ chuyển đổi linh hoạt: Ưu tiên Gemini, tự động dự phòng sang OpenAI nếu lỗi (ví dụ: cạn kiệt Quota 429)
async function getAiResponse({ systemPrompt, message, history, apiKeyGemini, modelGemini, apiKeyOpenAI, modelOpenAI }) {
  if (apiKeyGemini) {
    try {
      const response = await callGeminiGenerateContent({
        apiKey: apiKeyGemini,
        model: modelGemini,
        history: history || [],
        message,
        systemPrompt,
      });
      return response;
    } catch (geminiError) {
      console.warn("Gemini API call failed, falling back to OpenAI. Error:", geminiError.message);
      if (!apiKeyOpenAI) {
        throw geminiError;
      }
    }
  }

  if (apiKeyOpenAI) {
    const messages = [
      { role: "system", content: systemPrompt },
    ];
    for (const item of history || []) {
      messages.push({
        role: item.role === "assistant" ? "assistant" : "user",
        content: item.content,
      });
    }
    messages.push({
      role: "user",
      content: message,
    });

    const response = await callOpenAIChatCompletion({
      apiKey: apiKeyOpenAI,
      model: modelOpenAI || "gpt-4o-mini",
      messages,
    });
    return response;
  }

  throw new Error("Chưa cấu hình API Key cho nhà cung cấp AI nào hoặc cuộc gọi thất bại.");
}

// Chuẩn hóa lịch sử chat đầu vào và giới hạn số lượt hội thoại được gửi lên AI.
function normalizeHistory(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string"
    )
    .map((item) => ({
      role: item.role,
      content: item.content.trim(),
    }))
    .filter((item) => item.content)
    .slice(-MAX_HISTORY_ITEMS);
}

let isAiChatSchemaReady = false;
async function ensureAiChatSchema() {
  if (isAiChatSchemaReady) {
    return;
  }
  try {
    const pool = await poolPromise;
    await pool.request().query(`
      IF OBJECT_ID('dbo.ai_chat_history', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.ai_chat_history (
          id INT IDENTITY(1,1) PRIMARY KEY,
          user_id INT NOT NULL,
          role VARCHAR(20) NOT NULL,
          content NVARCHAR(MAX) NOT NULL,
          created_at DATETIME NOT NULL CONSTRAINT DF_ai_chat_history_created_at DEFAULT GETDATE(),
          CONSTRAINT FK_ai_chat_history_users FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
        );
      END;
    `);
    isAiChatSchemaReady = true;
  } catch (error) {
    console.error("Error ensuring AI chat schema:", error);
    throw error;
  }
}

let isSmartReportSchemaReady = false;
async function ensureSmartReportSchema() {
  if (isSmartReportSchemaReady) {
    return;
  }
  try {
    const pool = await poolPromise;
    await pool.request().query(`
      IF OBJECT_ID('dbo.smart_report_history', 'U') IS NULL
      BEGIN
        CREATE TABLE dbo.smart_report_history (
          id INT IDENTITY(1,1) PRIMARY KEY,
          user_id INT NOT NULL,
          role VARCHAR(20) NOT NULL,
          content NVARCHAR(MAX) NOT NULL,
          sql_query NVARCHAR(MAX) NULL,
          raw_data NVARCHAR(MAX) NULL,
          error_message NVARCHAR(MAX) NULL,
          created_at DATETIME NOT NULL CONSTRAINT DF_smart_report_history_created_at DEFAULT GETDATE(),
          CONSTRAINT FK_smart_report_history_users FOREIGN KEY (user_id) REFERENCES dbo.users(id) ON DELETE CASCADE
        );
      END;
    `);
    isSmartReportSchemaReady = true;
  } catch (error) {
    console.error("Error ensuring Smart Report schema:", error);
    throw error;
  }
}

// Endpoint tư vấn AI: chọn provider khả dụng, gọi model và trả phản hồi cho frontend.
async function askAiAdvisor(req, res) {
  try {
    const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();

    const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const openAiModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

    const message = String(req.body?.message || "").trim();
    const history = normalizeHistory(req.body?.history);

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Vui long nhap cau hoi de nhan tu van AI.",
      });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Cau hoi qua dai. Toi da ${MAX_MESSAGE_LENGTH} ky tu.`,
      });
    }

    if (!geminiApiKey && !openAiApiKey) {
      return res.status(503).json({
        success: false,
        message:
          "Chua cau hinh GEMINI_API_KEY hoac OPENAI_API_KEY trong backend/.env nen chua dung duoc chat AI.",
      });
    }

    const userId = req.user.id;
    await ensureAiChatSchema();

    // 1. Lấy danh sách sản phẩm Active từ Database theo thời gian thực
    let productsText = "";
    try {
      const pool = await poolPromise;
      const result = await pool.request().query(`
        SELECT p.id, p.name, p.material_type, c.name AS category_name
        FROM products p
        LEFT JOIN product_categories c ON c.id = p.category_id
        WHERE UPPER(ISNULL(p.status, '')) = 'ACTIVE'
      `);
      
      if (result.recordset && result.recordset.length > 0) {
        productsText = "\nDanh sách sản phẩm đang bán tại cửa hàng:\n" +
          result.recordset.map(p => `- ID: ${p.id}, Tên: ${p.name}, Chất liệu: ${p.material_type || "N/A"}, Danh mục: ${p.category_name || "N/A"}`).join("\n");
      }
    } catch (dbError) {
      console.error("Loi khi truy van danh sach san pham cho AI Advisor:", dbError);
      // Fallback không làm lỗi cả luồng chat, chỉ tiếp tục không có sản phẩm
    }

    // 2. Tìm kiếm các đoạn tài liệu RAG liên quan ngữ nghĩa tới câu hỏi của khách hàng
    let knowledgeText = "";
    try {
      const searchResults = await ragService.searchSimilarity(message, 3);
      if (searchResults.length > 0) {
        const minSimilarity = 0.35;
        const filteredResults = searchResults.filter(r => r.similarity >= minSimilarity);
        if (filteredResults.length > 0) {
          knowledgeText = "\nTÀI LIỆU TRÍ THỨC CỦA CỬA HÀNG ĐƯỢC TÌM THẤY:\n" +
            filteredResults.map(r => r.text).join("\n\n") + "\n";
        }
      }
    } catch (ragError) {
      console.error("Loi truy van RAG trong askAiAdvisor:", ragError);
    }

    // 3. Tạo System Prompt động đính kèm danh sách sản phẩm và tài liệu RAG
    const dynamicSystemPrompt = `${SYSTEM_PROMPT}
${productsText}
${knowledgeText}

HƯỚNG DẪN TRẢ LỜI & ĐÍNH KÈM LIÊN KẾT SẢN PHẨM:
- Khi khách hàng hỏi các thông tin về hướng dẫn chọn size, chính sách đổi trả, hoàn tiền hoặc hướng dẫn bảo quản trang sức, bạn BẮT BUỘC phải dựa trên phần "TÀI LIỆU TRÍ THỨC CỦA CỬA HÀNG ĐƯỢC TÌM THẤY" ở trên để phản hồi.
- Khi giới thiệu hoặc tư vấn bất kỳ sản phẩm nào có trong danh sách trên, bạn BẮT BUỘC phải kèm theo đường dẫn tới sản phẩm đó.
- Đường dẫn sản phẩm phải được định dạng chính xác theo cú pháp markdown sau: [Tên sản phẩm](/products/ID)
- Ví dụ: "Bạn có thể tham khảo mẫu [Nhẫn cưới Kim Cương Vàng Tây](/products/12) vô cùng sang trọng."
- TUYỆT ĐỐI không tự bịa ra sản phẩm hoặc ID sản phẩm không có trong danh sách trên. Không sử dụng link dạng khác ngoài cú pháp markdown quy định.
`.trim();

    let reply = "";
    let model = "";
    let provider = "";

    // Use resilient fallback chat wrapper
    reply = await getAiResponse({
      systemPrompt: dynamicSystemPrompt,
      message,
      history,
      apiKeyGemini: geminiApiKey,
      modelGemini: geminiModel,
      apiKeyOpenAI: openAiApiKey,
      modelOpenAI: openAiModel,
    });
    
    provider = geminiApiKey ? "gemini" : "openai";
    model = geminiApiKey ? geminiModel : openAiModel;

    // 3. Ghi nhận cuộc hội thoại vào database
    try {
      const pool = await poolPromise;
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Role", sql.VarChar(20), "user")
        .input("Content", sql.NVarChar(sql.MAX), message)
        .query(`
          INSERT INTO dbo.ai_chat_history (user_id, role, content)
          VALUES (@UserId, @Role, @Content)
        `);
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Role", sql.VarChar(20), "assistant")
        .input("Content", sql.NVarChar(sql.MAX), reply)
        .query(`
          INSERT INTO dbo.ai_chat_history (user_id, role, content)
          VALUES (@UserId, @Role, @Content)
        `);
    } catch (dbSaveError) {
      console.error("Loi khi luu cuoc tro chuyen AI vao database:", dbSaveError);
    }

    return res.json({
      success: true,
      data: {
        reply,
        model,
        provider,
      },
    });
  } catch (error) {
    console.error("Ask AI advisor error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Khong the tao phan hoi AI luc nay.",
    });
  }
}

// Lấy lịch sử tư vấn AI của người dùng đã đăng nhập.
async function getAiChatHistory(req, res) {
  try {
    const userId = req.user.id;
    await ensureAiChatSchema();
    const pool = await poolPromise;
    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT role, content
        FROM dbo.ai_chat_history
        WHERE user_id = @UserId
        ORDER BY id ASC
      `);
    return res.json({
      success: true,
      data: result.recordset,
    });
  } catch (error) {
    console.error("Get AI chat history error:", error);
    return res.status(500).json({
      success: false,
      message: "Khong the lay lich su chat AI.",
    });
  }
}

// Xóa lịch sử tư vấn AI của người dùng đã đăng nhập.
async function clearAiChatHistory(req, res) {
  try {
    const userId = req.user.id;
    await ensureAiChatSchema();
    const pool = await poolPromise;
    await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        DELETE FROM dbo.ai_chat_history
        WHERE user_id = @UserId
      `);
    return res.json({
      success: true,
      message: "Xoa lich su chat AI thanh cong.",
    });
  } catch (error) {
    console.error("Clear AI chat history error:", error);
    return res.status(500).json({
      success: false,
      message: "Khong the xoa lich su chat AI.",
    });
  }
}

let cachedSchemaPrompt = "";
function getSchemaPrompt() {
  if (cachedSchemaPrompt) {
    return cachedSchemaPrompt;
  }
  try {
    const schemaPath = path.join(__dirname, "../../../scratch/db_schema.json");
    if (fs.existsSync(schemaPath)) {
      const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
      let desc = "DATABASE SCHEMA SUMMARY:\n";
      for (const [tableName, columns] of Object.entries(schema)) {
        if (tableName === "sysdiagrams") continue;
        const colList = columns.map(c => `${c.column} (${c.type}${c.maxLength > 0 ? '(' + c.maxLength + ')' : c.maxLength === -1 ? '(max)' : ''}${c.nullable ? ' NULL' : ' NOT NULL'})`).join(", ");
        desc += `- Table: ${tableName}\n  Columns: ${colList}\n`;
      }
      cachedSchemaPrompt = desc;
      return cachedSchemaPrompt;
    }
  } catch (error) {
    console.error("Error reading db_schema.json for Text-to-SQL prompt:", error);
  }
  return "Database contains tables for jewelry shop sales (users, products, product_variants, orders, order_items, order_payments, shipping_orders, return_requests, promotions, user_promotions, gold_rate_history).";
}

const SMART_REPORT_SYSTEM_PROMPT = `
You are a Microsoft SQL Server (T-SQL) expert and business analyst.
Your job is to translate a Vietnamese question from an administrator into a SINGLE valid T-SQL SELECT query.

Here is the database schema:
{SCHEMA}

RULES FOR GENERATING SQL:
1. ONLY output a single T-SQL SELECT statement. Do NOT wrap it in markdown code blocks like \`\`\`sql. Just return the raw SQL string.
2. The query MUST ONLY read data (SELECT). DO NOT generate any data-modifying queries (no INSERT, UPDATE, DELETE, DROP, TRUNCATE, ALTER, CREATE). If the user asks you to modify data, return an empty string "".
3. Do NOT include any explanations, greetings, or text other than the SELECT query.
4. Ensure correct table and column names from the schema. Note that MSSQL uses GETDATE() for current time.
5. In table relationships:
   - To link orders to products, join orders -> order_items (on order_id) -> product_variants (on variant_id) -> products (on product_id).
   - In 'orders' table, status field represents order status (e.g. 'COMPLETED', 'CANCELLED', 'DELIVERED', 'SHIPPING', 'PROCESSING', 'PENDING').
   - Revenue calculations:
     - Gross/Pending revenue (doanh thu phát sinh): sum of orders where status IS NOT 'CANCELLED' (UPPER(status) <> 'CANCELLED').
     - Completed revenue (doanh thu thực tế): sum of orders where status IS 'COMPLETED' (UPPER(status) = 'COMPLETED').
6. Handle string comparisons carefully, e.g. using LIKE with N'%' for Vietnamese text or UPPER() for case-insensitive matches.
`.trim();

const EXPLANATION_SYSTEM_PROMPT = `
Bạn là một trợ lý phân tích kinh doanh thông minh cho cửa hàng trang sức JewelryBook.
Bạn sẽ nhận được câu hỏi gốc của Admin, câu lệnh SQL đã thực thi và kết quả dữ liệu thô dạng JSON từ cơ sở dữ liệu.
Nhiệm vụ của bạn là giải thích kết quả này cho Admin bằng tiếng Việt một cách tự nhiên, dễ hiểu, chuyên nghiệp và ngắn gọn.

QUY TẮC PHẢN HỒI:
1. Trả lời bằng tiếng Việt lịch sự, tự nhiên.
2. Định dạng các con số tiền tệ thành dạng VNĐ (ví dụ: 15.000.000đ hoặc 15.000.000 VND).
3. Đưa ra nhận xét hoặc phân tích ngắn gọn nếu hữu ích (ví dụ: so sánh doanh số, đưa ra cảnh báo tồn kho thấp).
4. Nếu kết quả rỗng hoặc không có dữ liệu, hãy báo cho Admin biết một cách lịch sự rằng không tìm thấy thông tin phù hợp trong hệ thống.
5. Câu trả lời cần tập trung trực tiếp vào câu hỏi, tránh dài dòng lan man.
6. Khi liệt kê hoặc đề cập đến bất kỳ sản phẩm nào có trong kết quả dữ liệu truy vấn (thường chứa cột id/name của sản phẩm), bạn BẮT BUỘC phải tạo liên kết tới sản phẩm đó dưới dạng cú pháp markdown: [Tên sản phẩm](/products/ID_sản_phẩm) (Ví dụ: [Nhẫn Cầu Hôn](/products/12)). Hãy sử dụng đúng ID sản phẩm từ kết quả.
7. TUYỆT ĐỐI KHÔNG DÙNG DỮ LIỆU GIẢ (mock data), không tự bịa đặt ra sản phẩm, mã ID, đơn hàng, hay doanh số nếu chúng không có trong kết quả JSON thô của cơ sở dữ liệu. Tất cả thông tin báo cáo phải là từ dữ liệu thật 100% được lấy ra từ Database. Nếu không có dữ liệu, hãy thông báo lịch sự là không tìm thấy thông tin trong hệ thống.
`.trim();

function isSqlSafe(sqlQuery) {
  const q = sqlQuery.trim().toLowerCase();
  if (!q) {
    return false;
  }
  if (!q.startsWith("select") && !q.startsWith("with") && !q.startsWith(";with")) {
    return false;
  }
  const forbiddenKeywords = [
    "insert", "update", "delete", "drop", "truncate", "alter", 
    "create", "grant", "revoke", "exec", "execute", "xp_cmdshell"
  ];
  for (const word of forbiddenKeywords) {
    const regex = new RegExp(`\\b${word}\\b`, "i");
    if (regex.test(sqlQuery)) {
      return false;
    }
  }
  return true;
}

async function askSmartReport(req, res) {
  try {
    const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    const geminiModel = process.env.GEMINI_MODEL || "gemini-2.5-flash";
    const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
    const openAiModel = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";

    const message = String(req.body?.message || "").trim();
    const history = req.body?.history || [];

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Vui lòng nhập câu hỏi phân tích dữ liệu.",
      });
    }

    if (!geminiApiKey && !openAiApiKey) {
      return res.status(503).json({
        success: false,
        message: "Chưa cấu hình GEMINI_API_KEY hoặc OPENAI_API_KEY trong backend/.env nên chưa dùng được Báo cáo thông minh AI.",
      });
    }

    const userId = req.user.id;
    await ensureSmartReportSchema();

    // 1. Lưu tin nhắn của admin (role: 'user')
    try {
      const pool = await poolPromise;
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Role", sql.VarChar(20), "user")
        .input("Content", sql.NVarChar(sql.MAX), message)
        .query(`
          INSERT INTO dbo.smart_report_history (user_id, role, content)
          VALUES (@UserId, @Role, @Content)
        `);
    } catch (dbSaveError) {
      console.error("Lỗi khi lưu tin nhắn user vào smart_report_history:", dbSaveError);
    }

    // Step 2: Generate SQL from Natural Language
    const schemaPrompt = getSchemaPrompt();
    const systemPrompt = SMART_REPORT_SYSTEM_PROMPT.replace("{SCHEMA}", schemaPrompt);
    
    const sqlResponse = await getAiResponse({
      systemPrompt: systemPrompt,
      message: `Translate this question into T-SQL: "${message}"`,
      history: [],
      apiKeyGemini: geminiApiKey,
      modelGemini: geminiModel,
      apiKeyOpenAI: openAiApiKey,
      modelOpenAI: openAiModel,
    });

    let generatedSql = sqlResponse.trim();
    if (generatedSql.startsWith("```")) {
      generatedSql = generatedSql.replace(/^```(sql)?/i, "").replace(/```$/, "").trim();
    }

    // Step 3: Security Validation
    if (!isSqlSafe(generatedSql)) {
      const reply = "Yêu cầu bị chặn vì lý do bảo mật. Hệ thống chỉ hỗ trợ thực thi các câu lệnh SELECT đọc dữ liệu, không cho phép thực hiện thao tác thay đổi cơ sở dữ liệu.";
      
      // Lưu tin nhắn phản hồi bị chặn của assistant
      try {
        const pool = await poolPromise;
        await pool.request()
          .input("UserId", sql.Int, userId)
          .input("Role", sql.VarChar(20), "assistant")
          .input("Content", sql.NVarChar(sql.MAX), reply)
          .input("SqlQuery", sql.NVarChar(sql.MAX), generatedSql || "N/A")
          .input("ErrorMessage", sql.NVarChar(sql.MAX), "Unsafe SQL statement detected.")
          .query(`
            INSERT INTO dbo.smart_report_history (user_id, role, content, sql_query, error_message)
            VALUES (@UserId, @Role, @Content, @SqlQuery, @ErrorMessage)
          `);
      } catch (dbSaveError) {
        console.error("Lỗi khi lưu phản hồi unsafe của assistant vào smart_report_history:", dbSaveError);
      }

      return res.json({
        success: true,
        data: {
          reply,
          sql: generatedSql || "N/A",
          rawData: null,
          error: "Unsafe SQL statement detected."
        }
      });
    }

    // Step 4: Run generated SQL against DB
    let rawData = null;
    let queryError = null;
    try {
      const pool = await poolPromise;
      const dbResult = await pool.request().query(generatedSql);
      rawData = dbResult.recordset;
    } catch (err) {
      console.error("Smart Report Database Error:", err);
      queryError = err.message;
    }

    // Step 5: Feed query results and error (if any) back to Gemini to explain in natural language
    const explanationPrompt = `
CÂU HỎI CỦA ADMIN: "${message}"
CÂU LỆNH SQL ĐÃ CHẠY:
${generatedSql}

KẾT QUẢ DỮ LIỆU THÔ (JSON):
${queryError ? `LỖI TRUY VẤN CSDL: ${queryError}` : JSON.stringify(rawData, null, 2)}
    `;

    let reply = "";
    if (queryError) {
      reply = `Không thể lấy số liệu do lỗi truy vấn SQL Server: ${queryError}. Vui lòng thử hỏi lại bằng cách diễn đạt khác rõ nghĩa hơn.`;
    } else {
      reply = await getAiResponse({
        systemPrompt: EXPLANATION_SYSTEM_PROMPT,
        message: explanationPrompt,
        history: normalizeHistory(history),
        apiKeyGemini: geminiApiKey,
        modelGemini: geminiModel,
        apiKeyOpenAI: openAiApiKey,
        modelOpenAI: openAiModel,
      });
    }

    // Lưu tin nhắn phản hồi của assistant kèm thông tin bổ sung
    try {
      const pool = await poolPromise;
      await pool.request()
        .input("UserId", sql.Int, userId)
        .input("Role", sql.VarChar(20), "assistant")
        .input("Content", sql.NVarChar(sql.MAX), reply)
        .input("SqlQuery", sql.NVarChar(sql.MAX), generatedSql)
        .input("RawData", sql.NVarChar(sql.MAX), rawData ? JSON.stringify(rawData) : null)
        .input("ErrorMessage", sql.NVarChar(sql.MAX), queryError)
        .query(`
          INSERT INTO dbo.smart_report_history (user_id, role, content, sql_query, raw_data, error_message)
          VALUES (@UserId, @Role, @Content, @SqlQuery, @RawData, @ErrorMessage)
        `);
    } catch (dbSaveError) {
      console.error("Lỗi khi lưu phản hồi assistant vào smart_report_history:", dbSaveError);
    }

    return res.json({
      success: true,
      data: {
        reply,
        sql: generatedSql,
        rawData,
        error: queryError || null
      }
    });

  } catch (error) {
    console.error("Ask Smart Report error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Không thể thực hiện báo cáo thông minh lúc này.",
    });
  }
}

// Lấy lịch sử báo cáo thông minh của admin hiện tại.
async function getSmartReportHistory(req, res) {
  try {
    const userId = req.user.id;
    await ensureSmartReportSchema();
    const pool = await poolPromise;
    const result = await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        SELECT role, content, sql_query, raw_data, error_message, created_at
        FROM dbo.smart_report_history
        WHERE user_id = @UserId
        ORDER BY id ASC
      `);
    
    // Parse raw_data JSON string back to object if it exists
    const historyData = result.recordset.map(row => {
      let parsedRawData = null;
      if (row.raw_data) {
        try {
          parsedRawData = JSON.parse(row.raw_data);
        } catch (e) {
          parsedRawData = row.raw_data;
        }
      }
      return {
        role: row.role,
        content: row.content,
        sql: row.sql_query,
        rawData: parsedRawData,
        error: row.error_message,
        createdAt: row.created_at
      };
    });

    return res.json({
      success: true,
      data: historyData,
    });
  } catch (error) {
    console.error("Get Smart Report history error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể lấy lịch sử báo cáo thông minh.",
    });
  }
}

// Xóa lịch sử báo cáo thông minh của admin hiện tại.
async function clearSmartReportHistory(req, res) {
  try {
    const userId = req.user.id;
    await ensureSmartReportSchema();
    const pool = await poolPromise;
    await pool.request()
      .input("UserId", sql.Int, userId)
      .query(`
        DELETE FROM dbo.smart_report_history
        WHERE user_id = @UserId
      `);
    return res.json({
      success: true,
      message: "Xóa lịch sử báo cáo thông minh thành công.",
    });
  } catch (error) {
    console.error("Clear Smart Report history error:", error);
    return res.status(500).json({
      success: false,
      message: "Không thể xóa lịch sử báo cáo thông minh.",
    });
  }
}

module.exports = {
  askAiAdvisor,
  getAiChatHistory,
  clearAiChatHistory,
  askSmartReport,
  getSmartReportHistory,
  clearSmartReportHistory,
};
