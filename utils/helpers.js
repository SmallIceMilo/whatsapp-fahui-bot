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

function hasMultiDayPattern(text) {
  return (
    /(\d{1,2})月\s*(\d{1,2})\s*(及|和|与|與|-|到|至|、)\s*(\d{1,2})[日号]?/.test(text) ||
    /(\d{1,2})\s*(及|和|与|與|-|到|至|、)\s*(\d{1,2})[日号]/.test(text) ||
    /\b(\d{1,2})\/(\d{1,2})\s*(and|&|-|to)\s*(\d{1,2})\/(\d{1,2})\b/i.test(text)
  );
}

function applyDayOverridesFromRawText(action, rawText) {
  if (!action || !Array.isArray(action.people)) return action;

  // For multi-person messages, gpt-4o handles per-person day extraction.
  // Only apply overrides for single-person messages.
  if (action.people.length > 1) return action;

  const text = (rawText || "").toLowerCase();

  const saturdayRegex = /saturday|星期六|周六|礼拜六|禮拜六/i;
  const sundayRegex = /sunday|星期日|星期天|周日|周天|礼拜天|礼拜日|禮拜天|禮拜日/i;

  if (saturdayRegex.test(text) && !sundayRegex.test(text)) {
    action.people = action.people.map((p) => ({ ...p, sat: true, sun: false }));
    return action;
  }

  if (sundayRegex.test(text) && !saturdayRegex.test(text)) {
    action.people = action.people.map((p) => ({ ...p, sat: false, sun: true }));
    return action;
  }

  return action;
}

function extractMentionedDateParts(rawText) {
  const text = rawText || "";

  // If message clearly mentions multiple days, do NOT extract a single date
  if (hasMultiDayPattern(text)) {
    return null;
  }

  // 4月19日 / 4月19号
  let match = text.match(/(\d{1,2})月\s*(\d{1,2})[日号]?/);
  if (match) {
    return {
      month: Number(match[1]),
      day: Number(match[2]),
    };
  }

  // 19/4 or 4/19
  match = text.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (match) {
    const first = Number(match[1]);
    const second = Number(match[2]);

    if (first > 12 && second >= 1 && second <= 12) {
      return {
        month: second,
        day: first,
      };
    }

    if (first >= 1 && first <= 12 && second > 12) {
      return {
        month: first,
        day: second,
      };
    }

    return null;
  }

  // 19日 / 19号
  match = text.match(/\b(\d{1,2})[日号]\b/);
  if (match) {
    return {
      month: null,
      day: Number(match[1]),
    };
  }

  return null;
}

function applyCalendarDayOverride(action, rawText) {
  if (!action || !Array.isArray(action.people) || !action.event) return action;

  // For multi-person messages, trust gpt-4o's per-person extraction.
  if (action.people.length > 1) return action;

  const text = rawText || "";

  // If user already clearly specified multiple days, keep both days
  if (hasMultiDayPattern(text)) {
    return action;
  }

  const parts = extractMentionedDateParts(text);
  if (!parts || !parts.day) return action;

  const monthMap = {
    January: 1,
    February: 2,
    March: 3,
    April: 4,
    May: 5,
    June: 6,
    July: 7,
    August: 8,
    September: 9,
    October: 10,
    November: 11,
    December: 12,
  };

  const inferredMonth = parts.month || monthMap[action.event];
  if (!inferredMonth) return action;

  const year = new Date().getFullYear();
  const dateObj = new Date(year, inferredMonth - 1, parts.day);

  if (
    dateObj.getFullYear() !== year ||
    dateObj.getMonth() !== inferredMonth - 1 ||
    dateObj.getDate() !== parts.day
  ) {
    return action;
  }

  const weekday = dateObj.getDay(); // 0 = Sunday, 6 = Saturday

  if (weekday === 6) {
    action.people = action.people.map((p) => ({
      ...p,
      sat: true,
      sun: false,
    }));
    return action;
  }

  if (weekday === 0) {
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
  extractMentionedDateParts,
  applyCalendarDayOverride,
};
