const fs = require("fs");
const path = require("path");
const https = require("https");
const crypto = require("crypto");

// ---------------- Helper: HTTPS Request ----------------
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
            return reject(new Error("Không thể phân tích phản hồi JSON từ API."));
          }

          if (res.statusCode < 200 || res.statusCode >= 300) {
            const providerMessage = parsed?.error?.message || "Yêu cầu API thất bại.";
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

// ---------------- Helpers: Math ----------------
function dotProduct(vecA, vecB) {
  let product = 0;
  for (let i = 0; i < vecA.length; i++) {
    product += vecA[i] * vecB[i];
  }
  return product;
}

function magnitude(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    sum += vec[i] * vec[i];
  }
  return Math.sqrt(sum);
}

function cosineSimilarity(vecA, vecB) {
  if (vecA.length !== vecB.length) return 0;
  const dot = dotProduct(vecA, vecB);
  const magA = magnitude(vecA);
  const magB = magnitude(vecB);
  if (magA === 0 || magB === 0) return 0;
  return dot / (magA * magB);
}

// ---------------- Helper: Text Chunking ----------------
function splitText(text, maxChars = 500, overlap = 100) {
  const paragraphs = text.split(/\n+/);
  const chunks = [];
  let currentChunk = "";

  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    if (!trimmedPara) continue;

    if (currentChunk.length + trimmedPara.length <= maxChars) {
      currentChunk += (currentChunk ? "\n" : "") + trimmedPara;
    } else {
      if (currentChunk) {
        chunks.push(currentChunk);
        // Tính toán overlap từ cuối currentChunk
        const words = currentChunk.split(/\s+/);
        let overlapText = "";
        for (let i = words.length - 1; i >= 0; i--) {
          if ((overlapText + " " + words[i]).length <= overlap) {
            overlapText = words[i] + " " + overlapText;
          } else {
            break;
          }
        }
        currentChunk = overlapText.trim() + (overlapText ? "\n" : "") + trimmedPara;
      } else {
        // Nếu một đoạn văn dài vượt quá maxChars, ta tách nhỏ theo câu
        const sentences = trimmedPara.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
          if (currentChunk.length + sentence.length <= maxChars) {
            currentChunk += (currentChunk ? " " : "") + sentence;
          } else {
            if (currentChunk) {
              chunks.push(currentChunk);
              const words = currentChunk.split(/\s+/);
              let overlapText = "";
              for (let i = words.length - 1; i >= 0; i--) {
                if ((overlapText + " " + words[i]).length <= overlap) {
                  overlapText = words[i] + " " + overlapText;
                } else {
                  break;
                }
              }
              currentChunk = overlapText.trim() + (overlapText ? " " : "") + sentence;
            } else {
              // Câu quá dài
              chunks.push(sentence);
            }
          }
        }
      }
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  return chunks.map((c) => c.trim()).filter(Boolean);
}

// ---------------- Class: RAG Service ----------------
class RagService {
  constructor() {
    this.vectorStore = []; // Chứa danh sách: { text, vector }
    this.isInitialized = false;
    this.documentsDir = path.join(__dirname, "../data/knowledge");
    this.cacheFile = path.join(__dirname, "../data/knowledge_vectors.json");
  }

  // Lấy Vector Embedding cho một đoạn text
  async getEmbedding(text, { apiKeyGemini, apiKeyOpenAI, modelGemini, modelOpenAI }) {
    if (apiKeyGemini) {
      const model = modelGemini || "gemini-embedding-001";
      const apiPath = `/v1beta/models/${model}:embedContent?key=${encodeURIComponent(apiKeyGemini)}`;
      try {
        const response = await requestJson({
          hostname: "generativelanguage.googleapis.com",
          path: apiPath,
          body: {
            content: {
              parts: [{ text }],
            },
          },
        });
        const embedding = response?.embedding?.values;
        if (Array.isArray(embedding)) {
          return embedding;
        }
        throw new Error("Không lấy được embedding từ Gemini API.");
      } catch (err) {
        console.warn("Embedding Gemini API thất bại, chuyển hướng sang OpenAI nếu có. Lỗi:", err.message);
        if (!apiKeyOpenAI) throw err;
      }
    }

    if (apiKeyOpenAI) {
      const model = modelOpenAI || "text-embedding-3-small";
      try {
        const response = await requestJson({
          hostname: "api.openai.com",
          path: "/v1/embeddings",
          headers: {
            Authorization: `Bearer ${apiKeyOpenAI}`,
          },
          body: {
            input: text,
            model,
          },
        });
        const embedding = response?.data?.[0]?.embedding;
        if (Array.isArray(embedding)) {
          return embedding;
        }
        throw new Error("Không lấy được embedding từ OpenAI API.");
      } catch (err) {
        throw err;
      }
    }

    throw new Error("Không cấu hình API Key để sinh vector embedding.");
  }

  // Khởi tạo RAG: Đọc file, tách đoạn, sinh vector và lưu cache
  async initialize() {
    if (this.isInitialized) return;

    try {
      // 1. Kiểm tra sự tồn tại của thư mục documents
      if (!fs.existsSync(this.documentsDir)) {
        fs.mkdirSync(this.documentsDir, { recursive: true });
        console.warn(`Đã tạo thư mục tài liệu trống tại: ${this.documentsDir}. Hãy bỏ file tài liệu .txt vào đây.`);
        this.isInitialized = true;
        return;
      }

      // 2. Đọc tất cả các file .txt trong thư mục
      const files = fs.readdirSync(this.documentsDir).filter((file) => file.endsWith(".txt"));
      if (files.length === 0) {
        console.warn("Thư mục tài liệu RAG rỗng, bỏ qua tạo vector.");
        this.isInitialized = true;
        return;
      }

      // Đọc toàn bộ nội dung và ghép lại để tạo mã băm kiểm tra thay đổi (hash)
      let combinedContent = "";
      const fileDataList = [];
      for (const file of files) {
        const filePath = path.join(this.documentsDir, file);
        const fileContent = fs.readFileSync(filePath, "utf-8");
        combinedContent += `\nFILE_NAME: ${file}\n${fileContent}\n`;
        fileDataList.push({ file, content: fileContent });
      }

      const currentHash = crypto.createHash("md5").update(combinedContent).digest("hex");

      // 3. Kiểm tra file cache vector
      if (fs.existsSync(this.cacheFile)) {
        try {
          const cache = JSON.parse(fs.readFileSync(this.cacheFile, "utf-8"));
          if (cache.hash === currentHash && Array.isArray(cache.data)) {
            this.vectorStore = cache.data;
            this.isInitialized = true;
            console.log(`[RAG] Đã tải thành công ${this.vectorStore.length} vectors từ cache.`);
            return;
          }
        } catch (cacheError) {
          console.warn("[RAG] Lỗi đọc file cache vector, tiến hành sinh lại:", cacheError.message);
        }
      }

      // 4. Sinh vector mới
      console.log("[RAG] Phát hiện tài liệu thay đổi hoặc chưa có cache. Bắt đầu sinh vector mới...");
      const apiKeyGemini = String(process.env.GEMINI_API_KEY || "").trim();
      const apiKeyOpenAI = String(process.env.OPENAI_API_KEY || "").trim();

      if (!apiKeyGemini && !apiKeyOpenAI) {
        console.error("[RAG] Không thể sinh vector vì chưa cấu hình API Key trong backend/.env!");
        return;
      }

      const allChunks = [];
      for (const fileData of fileDataList) {
        const chunks = splitText(fileData.content, 450, 80);
        for (const chunk of chunks) {
          allChunks.push({
            text: `[Tài liệu: ${fileData.file}]\n${chunk}`,
          });
        }
      }

      console.log(`[RAG] Tổng số đoạn văn (chunks) cần sinh vector: ${allChunks.length}`);

      // Sinh embedding tuần tự để tránh chạm giới hạn Rate Limit của nhà cung cấp API
      const newVectorStore = [];
      for (let i = 0; i < allChunks.length; i++) {
        const text = allChunks[i].text;
        try {
          const vector = await this.getEmbedding(text, {
            apiKeyGemini,
            apiKeyOpenAI,
            modelGemini: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
            modelOpenAI: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
          });
          newVectorStore.push({ text, vector });
          // Thêm độ trễ nhỏ để tránh rate-limiting
          await new Promise((r) => setTimeout(r, 150));
        } catch (embedErr) {
          console.error(`[RAG] Lỗi khi sinh vector cho đoạn số ${i + 1}:`, embedErr.message);
        }
      }

      if (newVectorStore.length > 0) {
        this.vectorStore = newVectorStore;
        // Lưu lại cache
        fs.writeFileSync(
          this.cacheFile,
          JSON.stringify({ hash: currentHash, data: newVectorStore }, null, 2),
          "utf-8"
        );
        console.log(`[RAG] Đã sinh và lưu cache thành công ${newVectorStore.length} vectors.`);
      }

      this.isInitialized = true;
    } catch (error) {
      console.error("[RAG] Lỗi trong quá trình khởi tạo RAG Service:", error);
    }
  }

  // Tìm kiếm ngữ nghĩa: Tìm các đoạn tài liệu tương đồng nhất với câu hỏi
  async searchSimilarity(query, topK = 3) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.vectorStore.length === 0) {
      return [];
    }

    try {
      const apiKeyGemini = String(process.env.GEMINI_API_KEY || "").trim();
      const apiKeyOpenAI = String(process.env.OPENAI_API_KEY || "").trim();

      const queryVector = await this.getEmbedding(query, {
        apiKeyGemini,
        apiKeyOpenAI,
        modelGemini: process.env.GEMINI_EMBEDDING_MODEL || "gemini-embedding-001",
        modelOpenAI: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
      });

      const results = this.vectorStore.map((item) => {
        const similarity = cosineSimilarity(queryVector, item.vector);
        return { text: item.text, similarity };
      });

      // Sắp xếp giảm dần theo độ tương đồng và lấy top K
      results.sort((a, b) => b.similarity - a.similarity);
      return results.slice(0, topK);
    } catch (error) {
      console.error("[RAG] Lỗi khi tìm kiếm độ tương đồng vector:", error.message);
      return [];
    }
  }
}

module.exports = new RagService();
