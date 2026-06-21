const path = require("path");
const backendDir = "c:/Users/ASUS/Documents/Demo/Web_TrangSuc1/Web_TrangSuc/backend";
require(path.join(backendDir, "node_modules/dotenv")).config({ path: path.join(backendDir, ".env") });
const { poolPromise } = require(path.join(backendDir, "src/config/db"));

const API_BASE = "http://localhost:5000";

async function runE2ETest() {
  try {
    console.log("--- STARTING E2E PROMOTION ACCEPTANCE TEST ---");

    // 1. Generate a new random customer
    const randomSuffix = Math.floor(Math.random() * 100000);
    const customerEmail = `promo_cust_${randomSuffix}@gmail.com`;
    const customerPassword = "password123";
    const customerName = `Test Customer ${randomSuffix}`;

    console.log(`\n1. Registering new customer: ${customerEmail}...`);
    const regRes = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: customerName,
        email: customerEmail,
        password: customerPassword,
        confirmPassword: customerPassword
      })
    });
    
    const regData = await regRes.json();
    if (!regRes.ok || !regData.success) {
      throw new Error(`Registration failed: ${regRes.status} - ${JSON.stringify(regData)}`);
    }
    const customerId = regData.userId;
    console.log(`Customer registered successfully! User ID: ${customerId}`);

    // 2. Admin Login to distribute promo
    console.log("\n2. Logging in as Admin...");
    const adminLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@gmail.com", password: "admin123" })
    });
    if (!adminLoginRes.ok) {
      throw new Error(`Admin login failed: ${adminLoginRes.status}`);
    }
    const adminLoginData = await adminLoginRes.json();
    const adminToken = adminLoginData.accessToken;
    console.log("Admin logged in successfully!");

    // 3. Admin: Find or create a promotion to distribute
    console.log("\n3. Fetching promotions list as Admin...");
    const adminHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${adminToken}`
    };
    const promoListRes = await fetch(`${API_BASE}/api/promotions/admin/list`, { headers: adminHeaders });
    const promoListData = await promoListRes.json();
    let targetPromo = promoListData.data?.find(p => p.is_active);

    if (!targetPromo) {
      console.log("No active promotions found. Creating a new test promotion...");
      const testCode = "TESTPROMO" + randomSuffix;
      const createRes = await fetch(`${API_BASE}/api/promotions/admin/create`, {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({
          code: testCode,
          name: "Test Promo for E2E",
          type: "fixed",
          min_order: 100000,
          discount_amount: 15000,
          is_active: true
        })
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.success) {
        throw new Error(`Failed to create test promotion: ${JSON.stringify(createData)}`);
      }
      
      const refreshRes = await fetch(`${API_BASE}/api/promotions/admin/list`, { headers: adminHeaders });
      const refreshData = await refreshRes.json();
      targetPromo = refreshData.data.find(p => p.code === testCode);
    }
    console.log(`Using Promotion: ID=${targetPromo.id}, Code=${targetPromo.code}`);

    // 4. Admin: Distribute promotion to the newly created customer
    console.log(`\n4. Distributing promotion ${targetPromo.code} to Customer ID ${customerId}...`);
    const distRes = await fetch(`${API_BASE}/api/promotions/admin/distribute`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        promotionId: targetPromo.id,
        targetType: "selected",
        userIds: [customerId]
      })
    });
    const distData = await distRes.json();
    if (!distRes.ok || !distData.success) {
      throw new Error(`Distribution failed: ${JSON.stringify(distData)}`);
    }
    console.log("Distribution response:", distData.message);

    console.log("Waiting 3s for background email and chat notifications to process...");
    await new Promise(r => setTimeout(r, 3000));

    // 5. Customer Login
    console.log(`\n5. Logging in as Customer: ${customerEmail}...`);
    const custLoginRes = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: customerEmail, password: customerPassword })
    });
    if (!custLoginRes.ok) {
      throw new Error(`Customer login failed: ${custLoginRes.status}`);
    }
    const custLoginData = await custLoginRes.json();
    const custToken = custLoginData.accessToken;
    console.log("Customer logged in successfully!");

    // 6. Customer: Fetch assigned promotions
    console.log("\n6. Fetching customer promotions...");
    const custHeaders = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${custToken}`
    };
    const custPromoRes = await fetch(`${API_BASE}/api/promotions`, { headers: custHeaders });
    const custPromoData = await custPromoRes.json();
    if (!custPromoRes.ok || !custPromoData.success) {
      throw new Error(`Failed to fetch customer promotions: ${JSON.stringify(custPromoData)}`);
    }

    const assigned = custPromoData.data.find(p => p.id === targetPromo.id);
    if (!assigned) {
      throw new Error(`Promotion ${targetPromo.code} was not found in customer's assigned promotions list.`);
    }

    console.log("Assigned promotion status before accept:");
    console.log(`- Code: ${assigned.code}`);
    console.log(`- is_accepted: ${assigned.is_accepted} (${typeof assigned.is_accepted})`);
    console.log(`- is_used: ${assigned.is_used}`);

    const isAcceptedBefore = assigned.is_accepted === true || Number(assigned.is_accepted) === 1;
    if (isAcceptedBefore) {
      throw new Error("Expected promotion to be unaccepted (is_accepted = 0), but it was accepted.");
    }
    console.log("SUCCESS: Promotion is indeed pending acceptance.");

    // 6.5. Customer: Fetch chat messages and verify promotion notification message
    console.log("\n6.5. Fetching customer chat history to verify system promotion notification...");
    const chatRes = await fetch(`${API_BASE}/api/chat/me`, { headers: custHeaders });
    const chatData = await chatRes.json();
    if (!chatRes.ok || !chatData.success) {
      throw new Error(`Failed to fetch customer chat: ${JSON.stringify(chatData)}`);
    }

    const notificationMessage = chatData.messages?.find(m => 
      m.senderType === "admin" && 
      m.senderName === "Hệ thống" && 
      m.message.includes(targetPromo.code)
    );

    if (!notificationMessage) {
      console.log("Chat messages found:", chatData.messages);
      throw new Error(`Expected system chat notification containing ${targetPromo.code} was not found in chat history.`);
    }

    console.log("SUCCESS: Found system chat notification message!");
    console.log(`- From: ${notificationMessage.senderName}`);
    console.log(`- Message: "${notificationMessage.message.replace(/\n/g, ' ')}"`);

    // 7. Customer: Accept/Claim the promotion
    console.log(`\n7. Customer claiming promotion ID ${targetPromo.id}...`);
    const claimRes = await fetch(`${API_BASE}/api/promotions/accept`, {
      method: "POST",
      headers: custHeaders,
      body: JSON.stringify({ promotionId: targetPromo.id })
    });
    
    const claimText = await claimRes.text();
    console.log(`Raw Response Status: ${claimRes.status}`);
    console.log(`Raw Response Content: ${claimText.substring(0, 500)}`);
    
    let claimData;
    try {
      claimData = JSON.parse(claimText);
    } catch (parseErr) {
      throw new Error(`Failed to parse response as JSON. Status=${claimRes.status}. Content: ${claimText}`);
    }
    
    if (!claimRes.ok || !claimData.success) {
      throw new Error(`Claim promotion failed: ${JSON.stringify(claimData)}`);
    }
    console.log("Claim response:", claimData.message);

    // 8. Customer: Re-fetch and verify accepted status
    console.log("\n8. Verifying promotion acceptance...");
    const custPromoRes2 = await fetch(`${API_BASE}/api/promotions`, { headers: custHeaders });
    const custPromoData2 = await custPromoRes2.json();
    const assignedAfter = custPromoData2.data.find(p => p.id === targetPromo.id);
    
    console.log("Assigned promotion status after accept:");
    console.log(`- Code: ${assignedAfter?.code}`);
    console.log(`- is_accepted: ${assignedAfter?.is_accepted} (${typeof assignedAfter?.is_accepted})`);

    const isAcceptedAfter = assignedAfter?.is_accepted === true || Number(assignedAfter?.is_accepted) === 1;
    if (!isAcceptedAfter) {
      throw new Error("Promotion is_accepted was NOT updated to true after calling accept API.");
    }
    console.log("SUCCESS: Promotion is accepted!");

    // Cleanup test user and promotion
    console.log("\n9. Cleaning up test data from Database...");
    const pool = await poolPromise;
    await pool.request().query(`
      DELETE FROM user_promotions WHERE user_id = ${customerId};
      DELETE FROM user_profiles WHERE user_id = ${customerId};
      DELETE FROM chat_conversations WHERE user_id = ${customerId};
      DELETE FROM users WHERE id = ${customerId};
    `);
    console.log("Cleanup complete!");

    console.log("\n--- E2E INTEGRATION TEST COMPLETED SUCCESSFULLY! ---");
    process.exit(0);
  } catch (error) {
    console.error("\nTEST FAILED:", error);
    process.exit(1);
  }
}

runE2ETest();
