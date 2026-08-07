require("dotenv").config();
const https = require("https");

const GEMINI_API_HOST = "generativelanguage.googleapis.com";
const geminiApiKey = String(process.env.GEMINI_API_KEY || "").trim();
const geminiModel = "gemini-flash-latest";

function requestJson({ hostname, path, body }) {
  return new Promise((resolve, reject) => {
    const dataStr = JSON.stringify(body);
    const req = https.request(
      {
        hostname,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(dataStr),
        },
      },
      (res) => {
        let responseBody = "";
        res.on("data", (chunk) => {
          responseBody += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = responseBody ? JSON.parse(responseBody) : {};
          } catch (e) {
            return reject(new Error("Invalid JSON: " + responseBody));
          }
          resolve({ status: res.statusCode, data: parsed });
        });
      }
    );
    req.on("error", reject);
    req.write(dataStr);
    req.end();
  });
}

async function run() {
  console.log("Testing SQL translation query with model:", geminiModel);
  console.log("API Key present:", !!geminiApiKey);
  console.log("API Key preview:", geminiApiKey.substring(0, 10) + "...");

  const path = `/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${encodeURIComponent(geminiApiKey)}`;

  const result = await requestJson({
    hostname: GEMINI_API_HOST,
    path,
    body: {
      contents: [
        {
          role: "user",
          parts: [{ text: 'Dịch câu này sang câu lệnh SQL: "Hiển thị danh sách sản phẩm"' }],
        }
      ],
      generationConfig: {
        temperature: 0.1,
      },
    },
  });

  console.log("HTTP Status Code:", result.status);
  console.log("Response:", JSON.stringify(result.data, null, 2));
}

run().catch(console.error);
