const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const ragService = require("../src/services/rag.service");

async function main() {
  console.log("=== BAT DAU CHAY THU RAG SERVICE ===");
  console.log("GEMINI API KEY:", process.env.GEMINI_API_KEY ? "DA CAU HINH" : "CHUA CAU HINH");
  console.log("OPENAI API KEY:", process.env.OPENAI_API_KEY ? "DA CAU HINH" : "CHUA CAU HINH");

  console.log("\n1. Dang khoi tao RAG Service (Doc file, chunking, tao vector hoặc tai tu cache)...");
  await ragService.initialize();

  const queries = [
    "Làm sao đo size nhẫn tại nhà?",
    "Chính sách đổi trả trong vòng bao nhiêu ngày?",
    "Mẹo làm sáng nhẫn bạc bị xỉn màu?"
  ];

  for (const query of queries) {
    console.log(`\n--------------------------------------------`);
    console.log(`CAU HOI THU NGHIEM: "${query}"`);
    console.log(`Dang truy van tim kiem Vector (Similarity Search)...`);
    const results = await ragService.searchSimilarity(query, 2);
    
    console.log(`\nKet qua tim duoc (Top 2):`);
    results.forEach((r, idx) => {
      console.log(`\n[Vi tri #${idx + 1}] (Do tuong dong: ${(r.similarity * 100).toFixed(2)}%)`);
      console.log(r.text);
    });
  }
}

main().catch(err => console.error("Loi chay thu RAG:", err));
