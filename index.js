const pendingContexts = {};
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

function getCurrentYear() {
  return new Date().getFullYear();
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
  return String(gender).trim();
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

  return map[e] || String(event).trim();
}

function monthNameFromIsoDate(isoDate) {
  if (!isoDate) return "";
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  return months[d.getMonth()];
}

function getSatSunFromIsoDate(isoDate) {
  if (!isoDate) return { sat: "YES", sun: "YES" };

  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return { sat: "YES", sun: "YES" };

  const weekday = d.getDay(); // 0=Sun, 6=Sat

  if (weekday === 6) return { sat: "YES", sun: "NO" };
  if (weekday === 0) return { sat: "NO", sun: "YES" };

  return { sat: "YES", sun: "YES" };
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

function isContextExpired(context, maxMinutes = 60) {
  if (!context || !context.updatedAt) return true;
  return Date.now() - context.updatedAt > maxMinutes * 60 * 1000;
}

function cleanupExpiredContext(senderKey) {
  const context = pendingContexts[senderKey];
  if (context && isContextExpired(context)) {
    delete pendingContexts[senderKey];
  }
}

function getOrCreateContext(senderKey) {
  cleanupExpiredContext(senderKey);

  if (!pendingContexts[senderKey]) {
    pendingContexts[senderKey] = {
      lastPeople: [],
      lastEvent: "",
      lastEventDate: "",
      lastActionType: "",
      updatedAt: Date.now(),
    };
  }

  return pendingContexts[senderKey];
}

async function getSheetRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
  });

  const rows = res.data.values || [];
  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0];
  const dataRows = rows.slice(1).map((row, idx) => ({
  rowNumber: idx + 2,
  Timestamp: row[0] || "",
  Event: row[1] || "",
  EventDate: row[2] || "",
  SenderWA: row[3] || "",
  Name: row[4] || "",
  Phone: row[5] || "",
  Gender: row[6] || "",
  Sat: row[7] || "",
  Sun: row[8] || "",
  Sender_phone: row[9] || "",
}));

  return { headers, rows: dataRows };
}

async function appendRows(newRows) {
  if (!newRows.length) return 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:J`,
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

async function callOpenAIForExtraction(messageText, context = {}) {
  const currentYear = getCurrentYear();

  const prompt = `
You extract registration actions from WhatsApp messages for event sign-ups.

Return STRICT JSON only.
No markdown.
No explanation.
No text outside JSON.

Schema:
{
  "actions": [
    {
      "type": "registration" | "cancellation" | "update" | "other",
      "event": "March",
      "eventDate": "${currentYear}-03-22",
      "people": [
        {
          "name": "蔡雅娇",
          "phone": "96884298",
          "gender": "Female",
          "sat": false,
          "sun": true
        }
      ]
    }
  ]
}

Recent sender context:
${JSON.stringify(context, null, 2)}

Rules:

1. Support Chinese and English.
2. Preserve names exactly as written. Do not translate names.
3. Resolve references using Recent sender context, including phrases like "以上三位", "上述三位", "这三位", "same people", and "the above people".
4. If a message lists multiple people, extract all of them.
5. Numbered entries like "2) name / phone" are separate people.
6. If a message says "全部女性", apply Female to all listed people.
7. Extract exact date whenever possible.
8. If year is not stated, assume current year ${currentYear}.
9. If eventDate exists, set event to the English month name based on eventDate.

DAY DETERMINATION PRIORITY
(Specific information overrides general information)

10. If a message explicitly mentions a weekday such as:
"Saturday", "Sunday", "星期六", "星期日", "周六", "周日", "礼拜六", "礼拜日",
then use that weekday to determine attendance days:

- Saturday => sat=true, sun=false
- Sunday => sat=false, sun=true

11. If a message mentions two dates within the same month such as:
"21-22日", "18-19日", "21及22", "21和22", "21/22",
interpret it as attending both days of that event weekend:
- sat=true
- sun=true

12. If the eventDate corresponds to a Saturday, set:
- sat=true
- sun=false

13. If the eventDate corresponds to a Sunday, set:
- sat=false
- sun=true

14. If a specific date exists but it is not clearly Saturday or Sunday, set:
- sat=null
- sun=null

MONTH-ONLY REGISTRATION

15. If a message registers for an event by mentioning only the month,
for example:
"March 法会", "April 佛一", "May fahui", "报名三月法会",
and no specific date or weekday is mentioned,
interpret it as registering for the whole month's event:

- event = that month
- eventDate = null
- sat = true
- sun = true

This means the person intends to attend both Saturday and Sunday sessions.

REGISTRATION LOGIC

16. If a message already registered people for an earlier date, and a later message refers to them with phrases like "以上三位", "上述三位", "这三位", "same people", or similar, reuse that same group from context and register them for the new date too.

17. If an action is registration and a date exists, try hard to return both event and eventDate.

18. If a registration message clearly contains a person name and event/date but no phone number, still extract the person and leave phone as an empty string.

PHONE RULES

19. If one phone number clearly belongs to one person, keep it with that person only.

MEMORIAL TABLET FILTERING

20. If the message contains sections related to memorial tablets such as:
"牌位", "婴灵牌位", "往生莲位", "历代祖先莲位", "消灾", or "冤亲债主",
these sections contain deceased names or spiritual dedications, not event registrants.

21. Names listed under memorial tablet sections must not be extracted as people for registration.

22. Only extract people as registrants if they are clearly applying, registering, or attending an event, such as:
"报名", "参加", "register", or "attend".

23. If the message is purely about memorial tablet entries or tablet form filling, return:
{
  "actions": [
    { "type": "other" }
  ]
}

24. If a Chinese name and an English name appear together for the same applicant, treat them as the same person, not two separate people. Combine both names into the name field, with the Chinese name first followed by the English name.

25. Do not invent names or phone numbers.

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
          content: "You are a precise JSON information extractor for event registration messages.",
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

async function updateExistingRegistrationRow(rowNumber, newSat, newSun) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!G${rowNumber}:H${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newSat, newSun]],
    },
  });

  console.log(`Updated row ${rowNumber} with Sat=${newSat}, Sun=${newSun}`);
}

async function buildRegistrationRows({ action, senderWA, senderPhone, existingRows }) {
  const rowsToAdd = [];
  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  let event = normalizeEvent(action.event || "");
  const eventDate = (action.eventDate || "").trim();

  if (!event && eventDate) {
    event = monthNameFromIsoDate(eventDate);
  }

  if (!event || !people.length) {
    return rowsToAdd;
  }

  const sharedPhone = inferSharedPhone(people);

  for (const person of people) {
    const name = (person.name || "").trim();
    const phone = (person.phone || sharedPhone || "").trim();
    const gender = normalizeGender(person.gender || "");

    let sat;
    let sun;

    if (eventDate) {
      const dateDays = getSatSunFromIsoDate(eventDate);
      sat = dateDays.sat;
      sun = dateDays.sun;
    } else {
      sat = normalizeYesNoFromBoolOrString(person.sat, "YES");
      sun = normalizeYesNoFromBoolOrString(person.sun, "YES");
    }

    let existingRow = null;

    if (phone) {
      existingRow = existingRows.find(
        (r) =>
          String(r.Event).trim() === event &&
          String(r.Name).trim() === name &&
          String(r.Phone).trim() === phone
      );
    }

    if (!existingRow) {
      existingRow = existingRows.find(
        (r) =>
          String(r.Event).trim() === event &&
          String(r.Name).trim() === name &&
          String(r.Sender_phone).trim() === senderPhone
      );
    }

    if (existingRow) {
      let newSat = String(existingRow.Sat || "").trim() || "NO";
      let newSun = String(existingRow.Sun || "").trim() || "NO";

      if (sat === "YES") newSat = "YES";
      if (sun === "YES") newSun = "YES";

      await updateExistingRegistrationRow(existingRow.rowNumber, newSat, newSun);
      console.log(`Updated existing registration for ${name}`);
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

  return rowsToAdd;
}

function findRowsForCancellation({ action, senderPhone, existingRows }) {
  let event = normalizeEvent(action.event || "");
  const eventDate = (action.eventDate || "").trim();

  if (!event && eventDate) {
    event = monthNameFromIsoDate(eventDate);
  }

  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  if (!event) {
    console.log("Cancellation skipped: no event identified.");
    return [];
  }

  if (!people.length) {
    console.log("Cancellation skipped: no person identified.");
    return [];
  }

  const rowsToDelete = [];

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
      console.log(`Ambiguous cancellation skipped for ${event} | ${targetName}. Matches: ${matches.length}`);
    }
  }

  return [...new Set(rowsToDelete)];
}

function updateContextFromRegistration(context, action) {
  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  let event = normalizeEvent(action.event || "");
  const eventDate = (action.eventDate || "").trim();

  if (!event && eventDate) {
    event = monthNameFromIsoDate(eventDate);
  }

  if (people.length) {
    context.lastPeople = people;
  }

  if (event) {
    context.lastEvent = event;
  }

  if (eventDate) {
    context.lastEventDate = eventDate;
  }

  context.lastActionType = "registration";
  context.updatedAt = Date.now();
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
    const context = getOrCreateContext(senderKey);

    console.log("RAW MESSAGE TEXT >>>", JSON.stringify(messageText));
    console.log("SenderWA:", senderWA);
    console.log("Sender_phone:", senderPhone);
    console.log("Context before AI:", JSON.stringify(context, null, 2));

    if (isTestOnlyMessage(messageText)) {
      console.log("Testing message detected. No sheet action taken.");
      return;
    }

    let { rows: existingRows } = await getSheetRows();
    let totalAdded = 0;
    let totalDeleted = 0;

    const extraction = await callOpenAIForExtraction(messageText, context);
    console.log("AI extraction:", JSON.stringify(extraction, null, 2));

    const actions = Array.isArray(extraction.actions) ? extraction.actions : [];

    if (!actions.length) {
      console.log("No actions extracted.");
      return;
    }

    for (const rawAction of actions) {
      const type = String(rawAction.type || "").toLowerCase();

      if (type === "registration") {
        const action = {
          ...rawAction,
          event: normalizeEvent(rawAction.event || ""),
          eventDate: (rawAction.eventDate || "").trim(),
          people: dedupePeople(rawAction.people || []),
        };

        const rawText = messageText;

        if (
          /saturday|星期六|周六|礼拜六|禮拜六/i.test(rawText) &&
          !/sunday|星期日|星期天|周日|周天|礼拜天|礼拜日|禮拜天|禮拜日/i.test(rawText)
        ) {
          action.eventDate = "";
          action.people = (action.people || []).map((p) => ({
            ...p,
            sat: true,
            sun: false,
          }));
        }

        if (
          /sunday|星期日|星期天|周日|周天|礼拜天|礼拜日|禮拜天|禮拜日/i.test(rawText) &&
          !/saturday|星期六|周六|礼拜六|禮拜六/i.test(rawText)
        ) {
          action.eventDate = "";
          action.people = (action.people || []).map((p) => ({
            ...p,
            sat: false,
            sun: true,
          }));
        }

        if (/(\d{1,2})\s*(及|和|-|\/|到)\s*(\d{1,2})/.test(rawText)) {
          action.eventDate = "";
          action.people = (action.people || []).map((p) => ({
            ...p,
            sat: true,
            sun: true,
          }));
        }

        const rowsToAdd = await buildRegistrationRows({
          action,
          senderWA,
          senderPhone,
          existingRows,
        });

        if (rowsToAdd.length) {
          await appendRows(rowsToAdd);
          totalAdded += rowsToAdd.length;

          const latest = await getSheetRows();
          existingRows = latest.rows;
        } else {
          console.log("No registration rows added.");
        }

        updateContextFromRegistration(context, action);
      } else if (type === "cancellation") {
        const action = {
          ...rawAction,
          event: normalizeEvent(rawAction.event || ""),
          eventDate: (rawAction.eventDate || "").trim(),
          people: dedupePeople(rawAction.people || []),
        };

        const rowsToDelete = findRowsForCancellation({
          action,
          senderPhone,
          existingRows,
        });

        if (rowsToDelete.length) {
          await deleteRowsByNumber(rowsToDelete);
          totalDeleted += rowsToDelete.length;

          const latest = await getSheetRows();
          existingRows = latest.rows;
        } else {
          console.log("No cancellation rows deleted.");
        }

        context.lastActionType = "cancellation";
        context.updatedAt = Date.now();
      } else if (type === "update") {
        console.log("Update intent detected. Not implemented yet. No action taken.");
        context.lastActionType = "update";
        context.updatedAt = Date.now();
      } else {
        console.log("Other / non-action message detected. No sheet action taken.");
      }
    }

    console.log("Context after AI:", JSON.stringify(context, null, 2));
    console.log(`Done. Added: ${totalAdded}, Deleted: ${totalDeleted}`);
  } catch (error) {
    console.error("Error:", error);
  }
});

client.initialize();
