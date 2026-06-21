const API_BASE = "http://localhost:5000";

async function checkHomeProducts() {
  try {
    // 1. Fetch categories
    console.log("=== Fetching /api/categories ===");
    const catsRes = await fetch(`${API_BASE}/api/categories`);
    const catsData = await catsRes.json();
    console.log(`Received ${catsData.categories?.length || 0} active categories.`);
    
    const catMap = {};
    if (catsData.success && Array.isArray(catsData.categories)) {
      catsData.categories.forEach(c => {
        catMap[c.id] = c;
      });
      
      const parents = catsData.categories.filter(c => c.parent_id === null);
      console.log("Parent categories:", parents.map(c => `${c.name} (ID: ${c.id})`));
      
      const children = catsData.categories.filter(c => c.parent_id !== null);
      console.log("Child categories count:", children.length);
    }
    
    // 2. Fetch products
    console.log("\n=== Fetching /api/products?page=1&limit=48&in_stock=1 ===");
    const prodsRes = await fetch(`${API_BASE}/api/products?page=1&limit=48&in_stock=1`);
    const prodsData = await prodsRes.json();
    console.log("Success:", prodsData.success);
    
    if (prodsData.success && Array.isArray(prodsData.products)) {
      console.log(`Received ${prodsData.products.length} products on page 1.`);
      
      const categoryCounts = {};
      prodsData.products.forEach(p => {
        categoryCounts[p.category] = (categoryCounts[p.category] || 0) + 1;
      });
      
      console.log("\nProduct count by category name in API response:");
      console.table(categoryCounts);
      
      // Let's print first 10 products
      console.log("\nFirst 10 products sample:");
      console.table(prodsData.products.slice(0, 10).map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        parentCategory: p.parentCategory,
        stockQuantity: p.stockQuantity
      })));
    } else {
      console.log("No products returned or error:", prodsData.message);
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error checking home products:", error);
    process.exit(1);
  }
}

checkHomeProducts();
