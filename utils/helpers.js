function stripCodeFences(text) {
  if (!text) return "";
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function getSenderPhone(msg) {
  if (msg.from && msg.from.endsWith("@g.us")) {
    return (msg.author || "").split("@")[0];
  }

  if (msg.from && msg.from.endsWith("@c.us")) {
    return (msg.from || "").split("@")[0];
  }

  return "";
}

function getSenderWA(msg) {
  if (msg.from && msg.from.endsWith("@g.us")) {
    return msg.author || "";
  }
  return msg.from || "";
}

function normalizeGender(gender) {
  if (!gender) return "";
  const g = String(gender).trim().toLowerCase();

  if (["m", "male", "man", "boy", "男"].includes(g)) return "Male";
  if (["f", "female", "woman", "girl", "女"].includes(g)) return "Female";

  return String(gender).trim();
}

function normalizeYesNoFromBoolOrString(value, defaultValue = "YES") {
  if (value === true) return "YES";
  if (value === false) return "NO";
  if (value == null || value === "") return defaultValue;

  const v = String(value).trim().toLowerCase();
  if (["yes", "y", "true"].includes(v)) return "YES";
  if (["no", "n", "false"].includes(v)) return "NO";

  return defaultValue;
}

function isTestOnlyMessage(text) {
  const t = String(text || "").trim().toLowerCase();
  return ["test", "testing", "测试", "測試", "測试"].includes(t);
}

function dedupePeople(people) {
  const seen = new Set();
  const result = [];

  for (const p of people || []) {
    const key = `${(p.name || "").trim()}|${(p.phone || "").trim()}|${(p.gender || "").trim()}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({
        name: (p.name || "").trim(),
        phone: (p.phone || "").trim(),
        gender: normalizeGender(p.gender || ""),
        sat: p.sat,
        sun: p.sun,
      });
    }
  }

  return result;
}

function inferSharedPhone(people) {
  const phones = [...new Set((people || []).map((p) => (p.phone || "").trim()).filter(Boolean))];
  return phones.length === 1 ? phones[0] : "";
}

function getSingaporeTimestamp() {
  const now = new Date();

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Singapore",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day} ${map.hour}:${map.minute}:${map.second}`;
}

function applyDayOverridesFromRawText(action, rawText) {
  if (!action || !Array.isArray(action.people)) return action;

  const text = rawText || "";

  const bothDaysRegex = /(\d{1,2})\s*(及|和|-|到)\s*(\d{1,2})/i;
  const saturdayRegex = /saturday|星期六|周六|礼拜六|禮拜六/i;
  const sundayRegex = /sunday|星期日|星期天|周日|周天|礼拜天|礼拜日|禮拜天|禮拜日/i;

  if (bothDaysRegex.test(text)) {
    action.people = action.people.map((p) => ({
      ...p,
      sat: true,
      sun: true,
    }));
    return action;
  }

  if (saturdayRegex.test(text) && !sundayRegex.test(text)) {
    action.people = action.people.map((p) => ({
      ...p,
      sat: true,
      sun: false,
    }));
    return action;
  }

  if (sundayRegex.test(text) && !saturdayRegex.test(text)) {
    action.people = action.people.map((p) => ({
      ...p,
      sat: false,
      sun: true,
    }));
    return action;
  }

  return action;
}

module.exports = {
  stripCodeFences,
  getSenderPhone,
  getSenderWA,
  normalizeGender,
  normalizeYesNoFromBoolOrString,
  isTestOnlyMessage,
  dedupePeople,
  inferSharedPhone,
  getSingaporeTimestamp,
  applyDayOverridesFromRawText,
};
