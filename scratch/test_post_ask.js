const http = require("http");

function makeRequest(url, method = "POST", headers = {}, body = null) {
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
          resolve({ status: res.statusCode, data: JSON.parse(rawData) });
        } catch {
          resolve({ status: res.statusCode, raw: rawData });
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  const loginRes = await makeRequest("http://localhost:5000/api/auth/login", "POST", {}, {
    email: "test_ai_user_123@gmail.com",
    password: "Password123!"
  });
  
  let token = "";
  if (loginRes.status !== 200 || !loginRes.data?.success) {
    // Register
    const regRes = await makeRequest("http://localhost:5000/api/auth/register", "POST", {}, {
      fullName: "Tester AI",
      email: "test_ai_user_123@gmail.com",
      password: "Password123!",
      confirmPassword: "Password123!"
    });
    const loginRes2 = await makeRequest("http://localhost:5000/api/auth/login", "POST", {}, {
      email: "test_ai_user_123@gmail.com",
      password: "Password123!"
    });
    token = loginRes2.data.accessToken;
  } else {
    token = loginRes.data.accessToken;
  }

  const askRes = await makeRequest("http://localhost:5000/api/ai-chat/ask", "POST", {
    "Authorization": `Bearer ${token}`
  }, {
    message: "Tu van giup minh nhan cuoi"
  });

  console.log("Status Code:", askRes.status);
  console.log("Response Body:", JSON.stringify(askRes.data || askRes.raw, null, 2));
}

test().catch(console.error);
