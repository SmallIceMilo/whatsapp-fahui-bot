function normalizeEvent(event) {
  if (!event) return "";

  const e = String(event).trim().toLowerCase();

  const map = {
    january: "January",
    jan: "January",
    "一月": "January",

    february: "February",
    feb: "February",
    "二月": "February",

    march: "March",
    mar: "March",
    "三月": "March",

    april: "April",
    apr: "April",
    "四月": "April",

    may: "May",
    "五月": "May",

    june: "June",
    jun: "June",
    "六月": "June",

    july: "July",
    jul: "July",
    "七月": "July",

    august: "August",
    aug: "August",
    "八月": "August",

    september: "September",
    sep: "September",
    sept: "September",
    "九月": "September",

    october: "October",
    oct: "October",
    "十月": "October",

    november: "November",
    nov: "November",
    "十一月": "November",

    december: "December",
    dec: "December",
    "十二月": "December",
  };

  return map[e] || String(event).trim();
}

function detectEventFromText(text) {
  const t = String(text || "").toLowerCase();

  if (/\bapril\b|四月/.test(t)) return "April";
  if (/\bmay\b|五月/.test(t)) return "May";

  return "";
}

function resolveEvent({
  extractedEvent,
  messageText,
  contextLastEvent,
  defaultEventFromSheet,
  defaultEventFallback,
  supportedEvents = [],
}) {
  const fromExtractor = normalizeEvent(extractedEvent || "");
  const fromText = detectEventFromText(messageText);
  const fromContext = normalizeEvent(contextLastEvent || "");
  const fromSheet = normalizeEvent(defaultEventFromSheet || "");
  const fallback = normalizeEvent(defaultEventFallback || "");

  const candidates = [fromExtractor, fromText, fromContext, fromSheet, fallback].filter(Boolean);

  for (const candidate of candidates) {
    if (!supportedEvents.length || supportedEvents.includes(candidate)) {
      return candidate;
    }
  }

  return fallback;
}

module.exports = {
  normalizeEvent,
  resolveEvent,
};
