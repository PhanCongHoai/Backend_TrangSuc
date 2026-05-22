const {
  registerAdminOrderSubscriber,
  registerUserOrderSubscriber,
  writeSseEvent,
} = require("./realtime");

const streamAdminOrders = async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  writeSseEvent(res, "ready", { ok: true });
  const unregister = registerAdminOrderSubscriber(res);
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unregister();
  });
};

const streamMyOrders = async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  writeSseEvent(res, "ready", { ok: true });
  const unregister = registerUserOrderSubscriber(req.user?.id, res);
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unregister();
  });
};

module.exports = {
  streamAdminOrders,
  streamMyOrders,
};
