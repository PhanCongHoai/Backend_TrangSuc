const { getMongoDatabase } = require("./client");
const { getMongoSepayConfig } = require("./config");
const {
  buildMongoUpsertPayload,
  buildOrderDocument,
  buildTransactionDocument,
} = require("./mappers");

// Đồng bộ một webhook SePay sang MongoDB, gồm giao dịch và snapshot đơn hàng liên quan.
const syncSepayWebhookToMongo = async ({
  sepayPayload,
  rawPayload,
  matchedOrder = null,
  paymentReference = "",
  paymentStatus = "",
  syncStatus = "",
  syncMessage = "",
}) => {
  const config = getMongoSepayConfig();
  const database = await getMongoDatabase();

  if (!config.enabled || !database || !sepayPayload?.id) {
    return {
      synced: false,
      skipped: true,
    };
  }

  const transactionsCollection = database.collection(config.transactionsCollection);
  const ordersCollection = database.collection(config.ordersCollection);
  const transactionDocument = buildTransactionDocument({
    sepayPayload,
    rawPayload,
    matchedOrder,
    paymentReference,
    syncStatus,
    syncMessage,
  });

  await transactionsCollection.updateOne(
    { id: transactionDocument.id },
    buildMongoUpsertPayload(transactionDocument),
    { upsert: true }
  );

  if (matchedOrder?.id) {
    const orderDocument = buildOrderDocument({
      matchedOrder,
      paymentReference,
      paymentStatus,
      sepayPayload,
    });

    await ordersCollection.updateOne(
      { id: orderDocument.id },
      buildMongoUpsertPayload(orderDocument),
      { upsert: true }
    );
  }

  return {
    synced: true,
    skipped: false,
  };
};

// Bọc lỗi cho luồng đồng bộ MongoDB để webhook chính không bị fail theo.
const syncSepayWebhookToMongoSafe = async (payload) => {
  try {
    return await syncSepayWebhookToMongo(payload);
  } catch (error) {
    console.error("[MongoDB] Dong bo SePay sang MongoDB that bai:", error);
    return {
      synced: false,
      skipped: true,
      error: error?.message || "Unknown MongoDB sync error.",
    };
  }
};

module.exports = {
  syncSepayWebhookToMongoSafe,
};
