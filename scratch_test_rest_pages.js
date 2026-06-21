const API_BASE = "http://localhost:5000";

async function checkRestPages() {
  try {
    const pageSize = 48;
    const cacheKey = Date.now();
    
    // Page 1
    const res1 = await fetch(`${API_BASE}/api/products?page=1&limit=${pageSize}&in_stock=1&t=${cacheKey}`);
    const data1 = await res1.json();
    console.log("Page 1 products:", data1.products?.length);
    console.log("Pagination info:", data1.pagination);

    // Page 2
    if (data1.pagination?.totalPages > 1) {
      const res2 = await fetch(`${API_BASE}/api/products?page=2&limit=${pageSize}&in_stock=1&t=${cacheKey}`);
      const data2 = await res2.json();
      console.log("Page 2 products:", data2.products?.length);
      console.log("Page 2 pagination info:", data2.pagination);
      
      const all = [...data1.products, ...data2.products];
      console.log("Combined products count:", all.length);
    } else {
      console.log("Only 1 page of products exists.");
    }
    
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

checkRestPages();
