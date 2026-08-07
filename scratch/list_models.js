const https = require("https");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const geminiApiKey = process.env.GEMINI_API_KEY;

function listModels(version = "v1beta") {
  return new Promise((resolve, reject) => {
    const urlPath = `/${version}/models?key=${geminiApiKey}`;
    
    const req = https.request({
      hostname: "generativelanguage.googleapis.com",
      path: urlPath,
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    }, (res) => {
      let raw = "";
      res.on("data", chunk => raw += chunk);
      res.on("end", () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          resolve({ raw });
        }
      });
    });

    req.on("error", reject);
    req.end();
  });
}

async function run() {
  console.log("Listing models for v1beta...");
  const resBeta = await listModels("v1beta");
  if (resBeta.models) {
    const embedModels = resBeta.models.filter(m => m.supportedGenerationMethods.includes("embedContent"));
    console.log("v1beta embedContent models:");
    embedModels.forEach(m => console.log(`- ${m.name}`));
  } else {
    console.log("Error v1beta:", resBeta.error || resBeta);
  }

  console.log("\nListing models for v1...");
  const resV1 = await listModels("v1");
  if (resV1.models) {
    const embedModels = resV1.models.filter(m => m.supportedGenerationMethods.includes("embedContent"));
    console.log("v1 embedContent models:");
    embedModels.forEach(m => console.log(`- ${m.name}`));
  } else {
    console.log("Error v1:", resV1.error || resV1);
  }
}

run();
