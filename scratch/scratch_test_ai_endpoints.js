require("dotenv").config();
const http = require("http");

const PORT = process.env.PORT || 5000;
const BASE_URL = `http://localhost:${PORT}`;

// Helper to make HTTP requests
function makeRequest(url, method = "GET", headers = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let rawData = "";
      res.on("data", (chunk) => {
        rawData += chunk;
      });
      res.on("end", () => {
        try {
          const parsedData = rawData ? JSON.parse(rawData) : {};
          resolve({ status: res.statusCode, data: parsedData });
        } catch {
          resolve({ status: res.statusCode, raw: rawData });
        }
      });
    });

    req.on("error", (err) => {
      reject(err);
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runTests() {
  console.log("=== BẮT ĐẦU KIỂM THỬ TÍCH HỢP ENDPOINT CHAT AI ===");
  
  const randomSuffix = Math.floor(Math.random() * 100000);
  const email = `test_ai_user_${randomSuffix}@gmail.com`;
  const password = "Password123!";
  
  // 1. Đăng ký tài khoản
  console.log("\n1. Đăng ký tài khoản mới...");
  const regRes = await makeRequest(`${BASE_URL}/api/auth/register`, "POST", {}, {
    fullName: `Tester AI ${randomSuffix}`,
    email: email,
    password: password,
    confirmPassword: password
  });
  console.log(`Status: ${regRes.status}, Success: ${regRes.data?.success}`);
  
  if ((regRes.status !== 200 && regRes.status !== 201) || !regRes.data?.success) {
    throw new Error("Đăng ký tài khoản thất bại!");
  }

  // 2. Đăng nhập để lấy Access Token
  console.log("\n2. Đăng nhập...");
  const loginRes = await makeRequest(`${BASE_URL}/api/auth/login`, "POST", {}, {
    email: email,
    password: password
  });
  console.log(`Status: ${loginRes.status}, Success: ${loginRes.data?.success}`);
  
  if (loginRes.status !== 200 || !loginRes.data?.success) {
    throw new Error("Đăng nhập thất bại!");
  }
  
  const token = loginRes.data.accessToken;
  const authHeader = { "Authorization": `Bearer ${token}` };

  // 3. Kiểm thử bảo mật: Gửi tin nhắn mà KHÔNG CÓ Token
  console.log("\n3. Kiểm thử bảo mật: Hỏi AI không có Token...");
  const anonymousRes = await makeRequest(`${BASE_URL}/api/ai-chat/ask`, "POST", {}, {
    message: "Hỏi thử xem có bị chặn không"
  });
  console.log(`Status: ${anonymousRes.status} (Kỳ vọng: 401)`);
  if (anonymousRes.status !== 401) {
    throw new Error("Bảo mật thất bại! Khách vãng lai không bị chặn.");
  }

  // 4. Hỏi AI với tài khoản đăng nhập
  console.log("\n4. Gửi câu hỏi đến AI (đã đăng nhập)...");
  const askRes = await makeRequest(`${BASE_URL}/api/ai-chat/ask`, "POST", authHeader, {
    message: "Tu van giup minh nhan cuoi"
  });
  console.log(`Status: ${askRes.status}, Success: ${askRes.data?.success}`);
  console.log(`AI Reply: ${askRes.data?.data?.reply}`);
  
  if (askRes.status !== 200 || !askRes.data?.success) {
    throw new Error("Hỏi AI thất bại!");
  }

  // 5. Kiểm tra lịch sử trò chuyện
  console.log("\n5. Lấy lịch sử trò chuyện từ database...");
  const historyRes = await makeRequest(`${BASE_URL}/api/ai-chat/history`, "GET", authHeader);
  console.log(`Status: ${historyRes.status}, Success: ${historyRes.data?.success}`);
  console.log("Lịch sử tin nhắn:", JSON.stringify(historyRes.data?.data, null, 2));
  
  if (historyRes.status !== 200 || !historyRes.data?.success || !Array.isArray(historyRes.data?.data)) {
    throw new Error("Lấy lịch sử thất bại!");
  }
  
  if (historyRes.data.data.length < 2) {
    throw new Error("Lịch sử trò chuyện trống hoặc không lưu tin nhắn!");
  }

  // 6. Xóa lịch sử trò chuyện
  console.log("\n6. Xóa lịch sử trò chuyện...");
  const deleteRes = await makeRequest(`${BASE_URL}/api/ai-chat/history`, "DELETE", authHeader);
  console.log(`Status: ${deleteRes.status}, Success: ${deleteRes.data?.success}`);
  
  if (deleteRes.status !== 200 || !deleteRes.data?.success) {
    throw new Error("Xóa lịch sử thất bại!");
  }

  // 7. Lấy lại lịch sử trò chuyện sau khi xóa
  console.log("\n7. Kiểm tra lại lịch sử sau khi xóa...");
  const historyAfterDeleteRes = await makeRequest(`${BASE_URL}/api/ai-chat/history`, "GET", authHeader);
  console.log(`Status: ${historyAfterDeleteRes.status}, Success: ${historyAfterDeleteRes.data?.success}`);
  console.log("Số lượng tin nhắn sau khi xóa:", historyAfterDeleteRes.data?.data?.length);
  
  if (historyAfterDeleteRes.data?.data?.length !== 0) {
    throw new Error("Lịch sử chưa được xóa sạch!");
  }

  console.log("\n=== TẤT CẢ KIỂM THỬ ENDPOINT ĐÃ THÀNH CÔNG! ===");
  process.exit(0);
}

runTests().catch((err) => {
  console.error("\n❌ KIỂM THỬ THẤT BẠI:", err.message);
  process.exit(1);
});
