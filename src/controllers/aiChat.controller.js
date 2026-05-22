const https = require("https");

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
async function callGeminiGenerateContent({ apiKey, model, history, message }) {
  const path = `/${GEMINI_API_VERSION}/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const parsedBody = await requestJson({
    hostname: GEMINI_API_HOST,
    path,
    body: {
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
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

// Endpoint tư vấn AI: chọn provider khả dụng, gọi model và trả phản hồi cho frontend.
async function askAiAdvisor(req, res) {
  try {
    const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
    const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();

    const geminiModel = process.env.GEMINI_MODEL || "gemini-2.0-flash";
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

    let reply = "";
    let model = "";
    let provider = "";

    if (geminiApiKey) {
      reply = await callGeminiGenerateContent({
        apiKey: geminiApiKey,
        model: geminiModel,
        history,
        message,
      });
      model = geminiModel;
      provider = "gemini";
    } else {
      reply = await callOpenAIChatCompletion({
        apiKey: openAiApiKey,
        model: openAiModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...history,
          { role: "user", content: message },
        ],
      });
      model = openAiModel;
      provider = "openai";
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

module.exports = {
  askAiAdvisor,
};
