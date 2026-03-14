const pendingRegistrations = {};
const { Client, LocalAuth } = require("whatsapp-web.js");
const { google } = require("googleapis");

// =========================
// CONFIG
// =========================
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || "Sheet1";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!SHEET_ID) {
  throw new Error("Missing GOOGLE_SHEET_ID in environment variables.");
}
if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in environment variables.");
}

const serviceAccount = {
  type: "service_account",
  project_id: process.env.GOOGLE_PROJECT_ID,
  private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
  private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
  client_email: process.env.GOOGLE_CLIENT_EMAIL,
  client_id: process.env.GOOGLE_CLIENT_ID,
};

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

// =========================
// WHATSAPP CLIENT
// =========================
const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "/app/.wwebjs_auth",
  }),
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  },
});

client.on("qr", (qr) => {
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`;
  console.log("Scan this QR code in your browser:");
  console.log(qrUrl);
});

client.on("ready", () => {
  console.log("Client is ready!");
});

client.on("authenticated", () => {
  console.log("WhatsApp authenticated.");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected:", reason);
});

// =========================
// HELPERS
// =========================
function getTimestamp() {
  return new Date().toISOString();
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

function stripCodeFences(text) {
  if (!text) return "";
  return text
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function normalizeGender(gender) {
  if (!gender) return "";
  const g = String(gender).trim().toLowerCase();

  if (["m", "male", "man", "boy", "男"].includes(g)) return "Male";
  if (["f", "female", "woman", "girl", "女"].includes(g)) return "Female";
  return gender;
}

function normalizeYesNo(value, defaultValue = "YES") {
  if (value === true) return "YES";
  if (value === false) return "NO";
  if (value == null || value === "") return defaultValue;

  const v = String(value).trim().toLowerCase();
  if (["yes", "y", "true", "去", "会去"].includes(v)) return "YES";
  if (["no", "n", "false", "不去", "不会去"].includes(v)) return "NO";

  return defaultValue;
}

function detectDaysFromMessage(messageText) {
  const text = String(messageText || "").toLowerCase();

  const hasSat =
    text.includes("sat") ||
    text.includes("saturday") ||
    text.includes("星期六") ||
    text.includes("周六") ||
    text.includes("礼拜六") ||
    text.includes("禮拜六");

  const hasSun =
    text.includes("sun") ||
    text.includes("sunday") ||
    text.includes("星期日") ||
    text.includes("星期天") ||
    text.includes("周日") ||
    text.includes("周天") ||
    text.includes("礼拜天") ||
    text.includes("礼拜日") ||
    text.includes("禮拜天") ||
    text.includes("禮拜日");

  if (hasSat && !hasSun) {
    return { sat: "YES", sun: "NO" };
  }

  if (!hasSat && hasSun) {
    return { sat: "NO", sun: "YES" };
  }

  if (hasSat && hasSun) {
    return { sat: "YES", sun: "YES" };
  }

  return { sat: "YES", sun: "YES" };
}

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

  return map[e] || event;
}

function detectEventsFromMessage(messageText) {
  const text = String(messageText || "").toLowerCase();
  const events = [];

  const monthPatterns = [
    { month: "January", num: 1, en: ["january", "jan"], zh: ["一月", "1月"] },
    { month: "February", num: 2, en: ["february", "feb"], zh: ["二月", "2月"] },
    { month: "March", num: 3, en: ["march", "mar"], zh: ["三月", "3月"] },
    { month: "April", num: 4, en: ["april", "apr"], zh: ["四月", "4月"] },
    { month: "May", num: 5, en: ["may"], zh: ["五月", "5月"] },
    { month: "June", num: 6, en: ["june", "jun"], zh: ["六月", "6月"] },
    { month: "July", num: 7, en: ["july", "jul"], zh: ["七月", "7月"] },
    { month: "August", num: 8, en: ["august", "aug"], zh: ["八月", "8月"] },
    { month: "September", num: 9, en: ["september", "sep", "sept"], zh: ["九月", "9月"] },
    { month: "October", num: 10, en: ["october", "oct"], zh: ["十月", "10月"] },
    { month: "November", num: 11, en: ["november", "nov"], zh: ["十一月", "11月"] },
    { month: "December", num: 12, en: ["december", "dec"], zh: ["十二月", "12月"] },
  ];

  for (const m of monthPatterns) {
    const hasEnglish = m.en.some((k) => new RegExp(`\\b${k}\\b`).test(text));
    const hasChinese = m.zh.some((k) => text.includes(k)) || text.includes(`${m.num} 月`);
    const hasSlashPrefix = new RegExp(`(^|[^0-9])${m.num}\\/\\d+`).test(text);
    const hasSlashSuffix = new RegExp(`\\d+\\/${m.num}(?!\\d)`).test(text);

    if (hasEnglish || hasChinese || hasSlashPrefix || hasSlashSuffix) {
      events.push(m.month);
    }
  }

  return [...new Set(events)];
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
      result.push(p);
    }
  }

  return result;
}

function inferSharedPhone(people) {
  const phones = [...new Set((people || []).map((p) => (p.phone || "").trim()).filter(Boolean))];
  return phones.length === 1 ? phones[0] : "";
}

function isDraftExpired(draft, maxMinutes = 30) {
  if (!draft || !draft.updatedAt) return true;
  return Date.now() - draft.updatedAt > maxMinutes * 60 * 1000;
}

function cleanupExpiredDraft(senderKey) {
  const draft = pendingRegistrations[senderKey];
  if (draft && isDraftExpired(draft)) {
    delete pendingRegistrations[senderKey];
  }
}

async function getSheetRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1).map((row, idx) => ({
    rowNumber: idx + 2,
    Timestamp: row[0] || "",
    Event: row[1] || "",
    SenderWA: row[2] || "",
    Name: row[3] || "",
    Phone: row[4] || "",
    Gender: row[5] || "",
    Sat: row[6] || "",
    Sun: row[7] || "",
    Sender_phone: row[8] || "",
  }));

  return { headers, rows: dataRows };
}

async function appendRows(newRows) {
  if (!newRows.length) return 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: newRows,
    },
  });

  console.log(`Added ${newRows.length} new row(s) to Google Sheet.`);
  return newRows.length;
}

async function deleteRowsByNumber(rowNumbers) {
  if (!rowNumbers.length) return 0;

  const requests = rowNumbers
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: 0,
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: { requests },
  });

  console.log(`Deleted row(s): ${rowNumbers.join(", ")}`);
  return rowNumbers.length;
}

async function callOpenAIForExtraction(messageText, draft = {}) {
  const prompt = `
You are extracting structured registration data from WhatsApp messages.

Return STRICT JSON only.
Do not use markdown.
Do not explain anything.
Do not include any text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "events": ["March"],
      "people": [
        {
          "name": "杰夫",
          "phone": "93298978",
          "gender": "Male",
          "sat": true,
          "sun": false
        }
      ]
    }
  ]
}

Recent sender context:
${JSON.stringify(draft || {}, null, 2)}

Rules:
1. Extract all meaningful actions from the message.
2. Support Chinese and English.
3. Preserve names exactly as written. Do not translate names.
4. If the message refers to earlier people, such as:
   "以上三位", "上述三位", "这三位", "same people", "the above people",
   use the people from Recent sender context.
5. If the message refers to earlier event context, use it when clearly implied.
6. Event months should be normalized to English month names when possible.
7. If a registration message contains people but no clear event, return people and leave events empty.
8. If a registration message contains event but no new people and refers to earlier people, reuse the earlier people from context.
9. If no day is mentioned, set sat and sun to null.
10. For cancellation, include person names whenever possible.
11. If the message is only testing, return type "other".
12. Do not invent people, names, or phone numbers.
13. If gender is stated for all people, apply it to all relevant people.
14. If the message says "以上三位要报名4月19日", that means the previously mentioned people should be registered for April.
15. If one phone number is clearly attached to one person, keep it with that person only.
16. If a message lists multiple people, extract all of them.

Message:
${messageText}
`.trim();

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: "You extract structured JSON from registration messages.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${errText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content || "";
  const cleaned = stripCodeFences(content);

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("Failed to parse AI JSON:", cleaned);
    throw err;
  }
}

function buildRegistrationRows({ action, senderWA, senderPhone, messageText, existingRows }) {
  const rowsToAdd = [];
  const events = (action.events || []).map(normalizeEvent).filter(Boolean);
  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  if (!events.length || !people.length) {
    return rowsToAdd;
  }

  const sharedPhone = inferSharedPhone(people);
  const fallbackDays = detectDaysFromMessage(messageText);

  for (const person of people) {
    const name = (person.name || "").trim();
    const phone = (person.phone || sharedPhone || "").trim();
    const gender = normalizeGender(person.gender || "");

    const sat = normalizeYesNo(person.sat, fallbackDays.sat);
    const sun = normalizeYesNo(person.sun, fallbackDays.sun);

    for (const event of events) {
      const duplicate = existingRows.some(
        (r) =>
          String(r.Event).trim() === event &&
          String(r.Name).trim() === name &&
          String(r.Sender_phone).trim() === senderPhone
      );

      if (duplicate) {
        console.log(`Duplicate skipped: ${event} | ${name} | ${senderPhone}`);
        continue;
      }

      rowsToAdd.push([
        getTimestamp(),
        event,
        senderWA,
        name,
        phone,
        gender,
        sat,
        sun,
        senderPhone,
      ]);
    }
  }

  return rowsToAdd;
}

function findRowsForCancellation({ action, senderPhone, existingRows }) {
  const events = (action.events || []).map(normalizeEvent).filter(Boolean);
  const people = (action.people || []).filter((p) => (p.name || "").trim());

  if (!events.length) {
    console.log("Cancellation skipped: no event identified.");
    return [];
  }

  if (!people.length) {
    console.log("Cancellation skipped: no person identified.");
    return [];
  }

  const rowsToDelete = [];

  for (const event of events) {
    for (const person of people) {
      const targetName = (person.name || "").trim();
      const targetPhone = (person.phone || "").trim();

      let matches = existingRows.filter(
        (r) => String(r.Event).trim() === event && String(r.Name).trim() === targetName
      );

      if (targetPhone) {
        const phoneMatches = matches.filter((r) => String(r.Phone).trim() === targetPhone);
        if (phoneMatches.length > 0) {
          matches = phoneMatches;
        }
      } else {
        const senderMatches = matches.filter(
          (r) => String(r.Sender_phone).trim() === senderPhone
        );
        if (senderMatches.length > 0) {
          matches = senderMatches;
        }
      }

      if (matches.length === 1) {
        rowsToDelete.push(matches[0].rowNumber);
      } else if (matches.length === 0) {
        console.log(`No cancellation match found for ${event} | ${targetName}`);
      } else {
        console.log(
          `Ambiguous cancellation skipped for ${event} | ${targetName}. Matches: ${matches.length}`
        );
      }
    }
  }

  return [...new Set(rowsToDelete)];
}

// =========================
// MAIN MESSAGE HANDLER
// =========================
client.on("message", async (msg) => {
  try {
    if (!msg || !msg.body) return;
    if (msg.from === "status@broadcast") return;

    const messageText = msg.body.trim();
    const senderWA = getSenderWA(msg);
    const senderPhone = getSenderPhone(msg);
    const senderKey = senderWA || senderPhone;

    cleanupExpiredDraft(senderKey);

    if (!pendingRegistrations[senderKey]) {
      pendingRegistrations[senderKey] = {
        events: [],
        people: [],
        lastActionType: "",
        updatedAt: Date.now(),
      };
    }

    const draft = pendingRegistrations[senderKey];

    console.log("Message received:", messageText);
    console.log("SenderWA:", senderWA);
    console.log("Sender_phone:", senderPhone);
    console.log("SenderKey:", senderKey);
    console.log("Current draft:", JSON.stringify(draft, null, 2));

    if (isTestOnlyMessage(messageText)) {
      console.log("Testing message detected. No sheet action taken.");
      return;
    }

    let { rows: existingRows } = await getSheetRows();
    let totalAdded = 0;
    let totalDeleted = 0;

    const extraction = await callOpenAIForExtraction(messageText, draft);
    console.log("AI extraction:", JSON.stringify(extraction, null, 2));

    // Optional manual follow-up extraction for very fragmented messages
    const nameMatch = messageText.match(/姓名[:：]?\s*([^\n]+)/);
    const phoneMatch = messageText.match(/(电话|手机号|电话号码)[:：]?\s*(\d{7,})/);
    const genderMatch = messageText.match(/(男|女)/);

    if (nameMatch) {
      const extractedName = nameMatch[1].trim();
      if (!draft.people.length) {
        draft.people.push({
          name: extractedName,
          phone: "",
          gender: genderMatch ? (genderMatch[1] === "男" ? "Male" : "Female") : "",
        });
      } else {
        draft.people[draft.people.length - 1].name = extractedName;
        if (genderMatch) {
          draft.people[draft.people.length - 1].gender =
            genderMatch[1] === "男" ? "Male" : "Female";
        }
      }
    }

    if (phoneMatch) {
      const extractedPhone = phoneMatch[2];
      if (!draft.people.length) {
        draft.people.push({
          name: "",
          phone: extractedPhone,
          gender: genderMatch ? (genderMatch[1] === "男" ? "Male" : "Female") : "",
        });
      } else {
        draft.people[draft.people.length - 1].phone = extractedPhone;
      }
    }

    if (!nameMatch && !phoneMatch && genderMatch && draft.people.length) {
      draft.people[draft.people.length - 1].gender =
        genderMatch[1] === "男" ? "Male" : "Female";
    }

    const actions = Array.isArray(extraction.actions) ? extraction.actions : [];

    if (!actions.length) {
      console.log("No actions extracted.");
      return;
    }

    for (const rawAction of actions) {
      const type = String(rawAction.type || "").toLowerCase();

      if (type === "registration") {
        const extractedEvents =
          (rawAction.events || []).map(normalizeEvent).filter(Boolean).length > 0
            ? (rawAction.events || []).map(normalizeEvent).filter(Boolean)
            : detectEventsFromMessage(messageText);

        const extractedPeople = dedupePeople(rawAction.people || [])
          .filter((p) => (p.name || "").trim())
          .map((p) => ({
            name: p.name || "",
            phone: p.phone || "",
            gender: normalizeGender(p.gender || ""),
            sat: p.sat,
            sun: p.sun,
          }));

        const finalEvents = extractedEvents.length ? extractedEvents : draft.events;
        const finalPeople = extractedPeople.length ? extractedPeople : draft.people;

        if (extractedEvents.length) {
          draft.events = extractedEvents;
        }

        if (extractedPeople.length) {
          draft.people = extractedPeople;
        }

        draft.people = dedupePeople(draft.people);
        draft.updatedAt = Date.now();

        const actionToApply = {
          ...rawAction,
          events: finalEvents,
          people: finalPeople,
        };

        const rowsToAdd = buildRegistrationRows({
          action: actionToApply,
          senderWA,
          senderPhone,
          messageText,
          existingRows,
        });

        if (rowsToAdd.length) {
          await appendRows(rowsToAdd);
          totalAdded += rowsToAdd.length;

          const latest = await getSheetRows();
          existingRows = latest.rows;

          draft.lastActionType = "registration";
          draft.updatedAt = Date.now();
        } else {
          console.log("No registration rows added.");
        }
      } else if (type === "cancellation") {
        const normalizedAction = {
          ...rawAction,
          events: (rawAction.events || []).map(normalizeEvent).filter(Boolean),
          people: rawAction.people || [],
        };

        const rowsToDelete = findRowsForCancellation({
          action: normalizedAction,
          senderPhone,
          existingRows,
        });

        if (rowsToDelete.length) {
          await deleteRowsByNumber(rowsToDelete);
          totalDeleted += rowsToDelete.length;

          const latest = await getSheetRows();
          existingRows = latest.rows;

          draft.lastActionType = "cancellation";
          draft.updatedAt = Date.now();
        } else {
          console.log("No cancellation rows deleted.");
        }
      } else if (type === "update") {
        console.log("Update intent detected. Not implemented yet. No action taken.");
        draft.lastActionType = "update";
        draft.updatedAt = Date.now();
      } else {
        console.log("Other / non-action message detected. No sheet action taken.");
      }
    }

    console.log("Updated draft:", JSON.stringify(draft, null, 2));
    console.log(`Done. Added: ${totalAdded}, Deleted: ${totalDeleted}`);
  } catch (error) {
    console.error("Error:", error);
  }
});

client.initialize();
