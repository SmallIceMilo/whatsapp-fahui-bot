const pendingContexts = {};

function isContextExpired(context, maxMinutes = 60) {
  if (!context || !context.updatedAt) return true;
  return Date.now() - context.updatedAt > maxMinutes * 60 * 1000;
}

function cleanupExpiredContext(senderKey, maxMinutes = 60) {
  const context = pendingContexts[senderKey];
  if (context && isContextExpired(context, maxMinutes)) {
    delete pendingContexts[senderKey];
  }
}

function getOrCreateContext(senderKey, maxMinutes = 60) {
  cleanupExpiredContext(senderKey, maxMinutes);

  if (!pendingContexts[senderKey]) {
    pendingContexts[senderKey] = {
      lastPeople: [],
      lastEvent: "",
      lastActionType: "",
      updatedAt: Date.now(),
    };
  }

  return pendingContexts[senderKey];
}

function updateContextFromRegistration(context, action) {
  const people = Array.isArray(action.people) ? action.people : [];
  const event = action.event || "";

  if (people.length) {
    context.lastPeople = people;
  }

  if (event) {
    context.lastEvent = event;
  }

  context.lastActionType = "registration";
  context.updatedAt = Date.now();
}

// Run a background cleanup every 15 minutes to prevent memory leaks from inactive users
setInterval(() => {
  const now = Date.now();
  for (const key in pendingContexts) {
    if (now - pendingContexts[key].updatedAt > 60 * 60 * 1000) {
      delete pendingContexts[key];
    }
  }
}, 15 * 60 * 1000);

module.exports = {
  getOrCreateContext,
  updateContextFromRegistration,
};
