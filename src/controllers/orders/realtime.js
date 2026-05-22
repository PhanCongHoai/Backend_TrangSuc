const adminOrderSubscribers = new Set();
const userOrderSubscribers = new Map();

const writeSseEvent = (response, eventName, payload) => {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const registerAdminOrderSubscriber = (response) => {
  adminOrderSubscribers.add(response);

  return () => {
    adminOrderSubscribers.delete(response);
  };
};

const registerUserOrderSubscriber = (userId, response) => {
  const key = String(Number(userId || 0));
  const listeners = userOrderSubscribers.get(key) || new Set();
  listeners.add(response);
  userOrderSubscribers.set(key, listeners);

  return () => {
    const currentListeners = userOrderSubscribers.get(key);

    if (!currentListeners) {
      return;
    }

    currentListeners.delete(response);

    if (!currentListeners.size) {
      userOrderSubscribers.delete(key);
    }
  };
};

const notifyAdminOrderSubscribers = (payload) => {
  adminOrderSubscribers.forEach((response) => writeSseEvent(response, "order", payload));
};

const notifyUserOrderSubscribers = (userId, payload) => {
  const listeners = userOrderSubscribers.get(String(Number(userId || 0)));

  if (!listeners?.size) {
    return;
  }

  listeners.forEach((response) => writeSseEvent(response, "order", payload));
};

const notifyOrderSubscribers = ({ userId = null, ...payload }) => {
  notifyAdminOrderSubscribers(payload);

  if (Number(userId || 0) > 0) {
    notifyUserOrderSubscribers(userId, payload);
  }
};

module.exports = {
  notifyOrderSubscribers,
  registerAdminOrderSubscriber,
  registerUserOrderSubscriber,
  writeSseEvent,
};
