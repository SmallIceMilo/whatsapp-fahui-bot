require("dotenv").config();

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const config = require("./config");

const {
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
  applyCalendarDayOverride,
} = require("./utils/helpers");

const { resolveEvent } = require("./utils/eventResolver");
const { getOrCreateContext, updateContextFromRegistration } = require("./utils/contextStore");

const {
  getRegistrationRows,
  appendRegistrationRows,
  updateExistingRegistrationRow,
  deleteRowsByNumber,
  getDefaultEventFromFactTable,
} = require("./services/googleSheetsService");

const { callOpenAIForExtraction } = require("./services/openaiService");

if (!config.sheetId) {
  throw new Error("Missing GOOGLE_SHEET_ID in environment variables.");
}

if (!config.openAiApiKey) {
  throw new Error("Missing OPENAI_API_KEY in environment variables.");
}

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
});

class Mutex {
  constructor() {
    this.queue = [];
    this.locked = false;
  }
  async lock() {
    return new Promise(resolve => {
      this.queue.push(resolve);
      this.dispatch();
    });
  }
  dispatch() {
    if (this.locked || this.queue.length === 0) return;
    this.locked = true;
    const resolve = this.queue.shift();
    resolve();
  }
  unlock() {
    this.locked = false;
    this.dispatch();
  }
}
const sheetMutex = new Mutex();

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

const http = require("http");

let latestQr = "";
let isAuthenticated = false;

client.on("qr", (qr) => {
  latestQr = qr;
  console.log("New QR Code generated. Visit your Railway app URL to scan it!");
});

client.on("ready", () => {
  console.log("Client is ready!");
  isAuthenticated = true;
});

client.on("authenticated", () => {
  console.log("WhatsApp authenticated.");
  isAuthenticated = true;
});

// A tiny built-in web server to display the QR code!
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  
  if (isAuthenticated) {
    res.end("<h1>Bot is Authenticated and Running!</h1>");
  } else if (latestQr) {
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(latestQr)}`;
    res.end(`
      <html>
        <head><meta http-equiv="refresh" content="5"></head>
        <body style="text-align: center; font-family: sans-serif; padding-top: 50px;">
          <h1>WhatsApp Login</h1>
          <p>This QR code automatically refreshes every 5 seconds.</p>
          <img src="${qrUrl}" alt="QR Code" />
        </body>
      </html>
    `);
  } else {
    res.end("<h1>Waiting for WhatsApp to generate QR code...</h1>");
  }
}).listen(process.env.PORT || 3000, () => {
  console.log("Web server is running for QR code display.");
});

client.on("auth_failure", (msg) => {
  console.error("Authentication failure:", msg);
});

client.on("disconnected", (reason) => {
  console.log("Client disconnected:", reason);
});

async function buildRegistrationRows({ action, senderWA, senderPhone, existingRows }) {
  const rowsToAdd = [];
  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  if (!action.event || !people.length) {
    return rowsToAdd;
  }

  const sharedPhone = inferSharedPhone(people);

  for (const person of people) {
    const name = (person.name || "").trim();
    // If the message contains a phone number, use it. Else, use the sender's actual WhatsApp number.
    const phone = (person.phone || sharedPhone || senderPhone || "").trim();
    const gender = normalizeGender(person.gender || "");

    const sat = normalizeYesNoFromBoolOrString(person.sat, "YES");
    const sun = normalizeYesNoFromBoolOrString(person.sun, "YES");

    let existingRow = null;

    if (phone) {
      existingRow = existingRows.find(
        (r) =>
          String(r.Event).trim() === action.event &&
          String(r.Name).trim() === name &&
          String(r.Phone).trim() === phone
      );
    }

    if (!existingRow) {
      existingRow = existingRows.find(
        (r) =>
          String(r.Event).trim() === action.event &&
          String(r.Name).trim() === name &&
          String(r.Sender_phone).trim() === senderPhone
      );
    }

    if (existingRow) {
      await updateExistingRegistrationRow(existingRow.rowNumber, sat, sun);
      continue;
    }

    rowsToAdd.push([
      getSingaporeTimestamp(),
      action.event,
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
  const people = dedupePeople(action.people || []).filter((p) => (p.name || "").trim());

  if (!action.event || !people.length) return [];

  const rowsToDelete = [];

  for (const person of people) {
    const targetName = (person.name || "").trim();
    const targetPhone = (person.phone || "").trim();

    let matches = existingRows.filter(
      (r) => String(r.Event).trim() === action.event && String(r.Name).trim() === targetName
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
    }
  }

  return [...new Set(rowsToDelete)];
}

client.on("message", async (msg) => {
  console.log("Message received:", msg?.from, msg?.body, msg?.hasMedia ? "[Media Included]" : "");

  try {
    if (!msg || (!msg.body && !msg.hasMedia)) return;
    if (msg.from === "status@broadcast") return;

    // Filter out obvious noise (videos, voice notes, stickers, etc.) to save Railway bandwidth and OpenAI costs
    const ignoredTypes = ['video', 'audio', 'ptt', 'voice', 'sticker', 'document', 'location', 'vcard', 'call_log'];
    if (ignoredTypes.includes(msg.type)) {
      console.log(`Ignoring noise message of type: ${msg.type}`);
      return;
    }

    const messageText = msg.body ? msg.body.trim() : "";
    const senderWA = getSenderWA(msg);
    const senderPhone = getSenderPhone(msg);
    const senderKey = senderWA || senderPhone;

    const context = getOrCreateContext(senderKey, config.contextExpiryMinutes);

    if (isTestOnlyMessage(messageText)) {
      console.log("Testing message detected. No sheet action taken.");
      return;
    }
    
    let base64Media = null;
    let mimeType = null;
    if (msg.hasMedia && msg.type === "image") {
      // Check if the accompanying text has registration keywords
      const isRegistrationRelated = /register|sign|join|attend|book|reserve|add|go|报名|參加|参加|登记|cancel|取消|预定|预订/i.test(messageText);
      
      // We ONLY download the image IF there are registration keywords. Images with no text are ignored.
      if (isRegistrationRelated) {
        try {
          const media = await msg.downloadMedia();
          if (media && media.mimetype && media.mimetype.startsWith("image/")) {
            base64Media = media.data;
            mimeType = media.mimetype;
          }
        } catch (err) {
          console.error("Error downloading media:", err);
        }
      } else {
        console.log("Ignored image because the accompanying text was not registration related or was empty.");
      }
    }

    await sheetMutex.lock();
    try {
      let { rows: existingRows } = await getRegistrationRows();
      const defaultEventFromSheet = await getDefaultEventFromFactTable();

      const extraction = await callOpenAIForExtraction(messageText, context, base64Media, mimeType);
      console.log("Extraction result:", JSON.stringify(extraction));

      const actions = Array.isArray(extraction.actions) ? extraction.actions : [];

      if (!actions.length) {
        console.log("No actions extracted.");
        return;
      }

      let totalAdded = 0;
      let totalDeleted = 0;

      for (const rawAction of actions) {
        const type = String(rawAction.type || "").toLowerCase();

        if (type === "registration") {
          let action = {
            ...rawAction,
            people: dedupePeople(rawAction.people || []),
          };

          action.event = resolveEvent({
            extractedEvent: rawAction.event,
            messageText,
            contextLastEvent: context.lastEvent,
            defaultEventFromSheet,
            defaultEventFallback: config.defaultEventFallback,
            supportedEvents: config.supportedEvents,
          });

          action = applyDayOverridesFromRawText(action, messageText);
          action = applyCalendarDayOverride(action, messageText);

          const rowsToAdd = await buildRegistrationRows({
            action,
            senderWA,
            senderPhone,
            existingRows,
          });

          if (rowsToAdd.length) {
            await appendRegistrationRows(rowsToAdd);
            totalAdded += rowsToAdd.length;

            const latest = await getRegistrationRows();
            existingRows = latest.rows;
          }

          updateContextFromRegistration(context, action);
        } else if (type === "cancellation") {
          const action = {
            ...rawAction,
            event: resolveEvent({
              extractedEvent: rawAction.event,
              messageText,
              contextLastEvent: context.lastEvent,
              defaultEventFromSheet,
              defaultEventFallback: config.defaultEventFallback,
              supportedEvents: config.supportedEvents,
            }),
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

            const latest = await getRegistrationRows();
            existingRows = latest.rows;
          }

          context.lastActionType = "cancellation";
          context.updatedAt = Date.now();
        } else if (type === "update") {
          console.log("Update intent detected. Not implemented yet.");
          context.lastActionType = "update";
          context.updatedAt = Date.now();
        } else {
          console.log("Other / non-action message detected.");
        }
      }

      console.log(`Done. Added: ${totalAdded}, Deleted: ${totalDeleted}`);
    } finally {
      sheetMutex.unlock();
    }
  } catch (error) {
    console.error("Error processing message:", error);
  }
});

client.initialize();
