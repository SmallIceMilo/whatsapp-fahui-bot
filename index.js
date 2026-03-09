const { Client, LocalAuth } = require('whatsapp-web.js');
const OpenAI = require('openai');
const { google } = require('googleapis');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const auth = new google.auth.GoogleAuth({
  keyFile: 'poised-gateway-426003-d0-6c2b067bfa1d.json',
  scopes: ['https://www.googleapis.com/auth/spreadsheets']
});

const sheets = google.sheets({ version: 'v4', auth });

const SPREADSHEET_ID = '1VMQNks_r10U8jNEe3s4sBwi79kzMMw8tS2UjFka7vs4';
const SHEET_NAME = 'Sheet1';

const pendingRegistrations = new Map();

function isBlank(value) {
  return !value || String(value).trim() === '';
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(name) {
  return String(name || '').trim().toLowerCase();
}

function normalizeGender(gender) {
  if (!gender) return '';

  const g = String(gender).trim().toLowerCase();

  if (g === '男' || g === 'male' || g === 'm') return 'male';
  if (g === '女' || g === 'female' || g === 'f') return 'female';

  return g;
}

function normalizeEvent(event) {
  if (!event) return 'March';

  const e = String(event).trim().toLowerCase();

  const monthMap = {
    '1': 'January',
    '一月': 'January',
    'jan': 'January',
    'january': 'January',
    '2': 'February',
    '二月': 'February',
    'feb': 'February',
    'february': 'February',
    '3': 'March',
    '三月': 'March',
    'mar': 'March',
    'march': 'March',
    '4': 'April',
    '四月': 'April',
    'apr': 'April',
    'april': 'April',
    '5': 'May',
    '五月': 'May',
    'may': 'May',
    '6': 'June',
    '六月': 'June',
    'jun': 'June',
    'june': 'June',
    '7': 'July',
    '七月': 'July',
    'jul': 'July',
    'july': 'July',
    '8': 'August',
    '八月': 'August',
    'aug': 'August',
    'august': 'August',
    '9': 'September',
    '九月': 'September',
    'sep': 'September',
    'sept': 'September',
    'september': 'September',
    '10': 'October',
    '十月': 'October',
    'oct': 'October',
    'october': 'October',
    '11': 'November',
    '十一月': 'November',
    'nov': 'November',
    'november': 'November',
    '12': 'December',
    '十二月': 'December',
    'dec': 'December',
    'december': 'December'
  };

  return monthMap[e] || String(event).trim();
}

function detectEventsFromMessage(text) {
  const t = normalizeText(text);

  const checks = [
    { patterns: [/\b1\b/, /一月/, /\bjan\b/, /\bjanuary\b/], value: 'January' },
    { patterns: [/\b2\b/, /二月/, /\bfeb\b/, /\bfebruary\b/], value: 'February' },
    { patterns: [/\b3\b/, /三月/, /\bmar\b/, /\bmarch\b/], value: 'March' },
    { patterns: [/\b4\b/, /四月/, /\bapr\b/, /\bapril\b/], value: 'April' },
    { patterns: [/\b5\b/, /五月/, /\bmay\b/], value: 'May' },
    { patterns: [/\b6\b/, /六月/, /\bjun\b/, /\bjune\b/], value: 'June' },
    { patterns: [/\b7\b/, /七月/, /\bjul\b/, /\bjuly\b/], value: 'July' },
    { patterns: [/\b8\b/, /八月/, /\baug\b/, /\baugust\b/], value: 'August' },
    { patterns: [/\b9\b/, /九月/, /\bsep\b/, /\bsept\b/, /\bseptember\b/], value: 'September' },
    { patterns: [/\b10\b/, /十月/, /\boct\b/, /\boctober\b/], value: 'October' },
    { patterns: [/\b11\b/, /十一月/, /\bnov\b/, /\bnovember\b/], value: 'November' },
    { patterns: [/\b12\b/, /十二月/, /\bdec\b/, /\bdecember\b/], value: 'December' }
  ];

  const found = [];

  for (const item of checks) {
    const matched = item.patterns.some((pattern) => pattern.test(t));
    if (matched) found.push(item.value);
  }

  return found.length > 0 ? found : ['March'];
}

function detectDaysFromMessage(text) {
  const t = normalizeText(text);

  const hasSat = /(?:\bsat(?:urday)?\b|星期六|礼拜六|周六)/i.test(t);
  const hasSun = /(?:\bsun(?:day)?\b|星期天|星期日|礼拜天|礼拜日|周日)/i.test(t);
  const hasBothPhrase =
    /(?:both days|two days|两天都来|两天|星期六和星期天|周六和周日|sat\s*(?:and|&)\s*sun|saturday\s*(?:and|&)\s*sunday)/i.test(t);

  if (hasBothPhrase) return { sat: 'YES', sun: 'YES' };
  if (hasSat && !hasSun) return { sat: 'YES', sun: 'NO' };
  if (!hasSat && hasSun) return { sat: 'NO', sun: 'YES' };
  if (hasSat && hasSun) return { sat: 'YES', sun: 'YES' };

  return { sat: 'YES', sun: 'YES' };
}

function inferSenderGenderFromRelationship(text) {
  const t = String(text || '').toLowerCase();

  if (/(my wife|我老婆|我太太|妻子|太太)/i.test(t)) return 'male';
  if (/(my husband|我老公|我先生|丈夫|先生)/i.test(t)) return 'female';

  return '';
}

function inferPartnerGenderFromRelationship(text) {
  const t = String(text || '').toLowerCase();

  if (/(my wife|我老婆|我太太|妻子|太太)/i.test(t)) return 'female';
  if (/(my husband|我老公|我先生|丈夫|先生)/i.test(t)) return 'male';

  return '';
}

function extractPartnerNameFromRelationship(text) {
  const content = String(text || '').trim();

  const patterns = [
    /(?:my wife|我太太|我老婆|妻子|太太)\s*[:：]?\s*([A-Za-z\u4e00-\u9fff]+)/i,
    /(?:my husband|我老公|我先生|丈夫|先生)\s*[:：]?\s*([A-Za-z\u4e00-\u9fff]+)/i
  ];

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      return match[1].trim().toLowerCase();
    }
  }

  return '';
}

function enrichPeopleFromRelationship(people, text) {
  const senderGender = inferSenderGenderFromRelationship(text);
  const partnerGender = inferPartnerGenderFromRelationship(text);
  const partnerName = extractPartnerNameFromRelationship(text);

  const result = people.map((person) => ({
    name: String(person.name || '').trim(),
    phone: String(person.phone || '').trim(),
    gender: normalizeGender(person.gender || '')
  }));

  const blankNameIndexes = [];
  const namedIndexes = [];

  for (let i = 0; i < result.length; i++) {
    if (isBlank(result[i].name)) {
      blankNameIndexes.push(i);
    } else {
      namedIndexes.push(i);
    }
  }

  if (blankNameIndexes.length > 0 && senderGender) {
    for (const idx of blankNameIndexes) {
      if (isBlank(result[idx].gender)) {
        result[idx].gender = senderGender;
      }
    }
  }

  if (partnerName && partnerGender) {
    for (let i = 0; i < result.length; i++) {
      if (
        !isBlank(result[i].name) &&
        normalizeName(result[i].name) === partnerName &&
        isBlank(result[i].gender)
      ) {
        result[i].gender = partnerGender;
      }
    }
  }

  if (result.length === 2) {
    const g1 = normalizeGender(result[0].gender);
    const g2 = normalizeGender(result[1].gender);

    if (g1 === 'female' && isBlank(g2) && senderGender) {
      result[1].gender = senderGender;
    } else if (g2 === 'female' && isBlank(g1) && senderGender) {
      result[0].gender = senderGender;
    } else if (g1 === 'male' && isBlank(g2) && senderGender === 'female') {
      result[1].gender = 'female';
    } else if (g2 === 'male' && isBlank(g1) && senderGender === 'female') {
      result[0].gender = 'female';
    }
  }

  if (namedIndexes.length === 1 && partnerGender) {
    const idx = namedIndexes[0];
    if (isBlank(result[idx].gender)) {
      result[idx].gender = partnerGender;
    }
  }

  return result;
}

function fillMissingDetailsFromText(people, text) {
  const result = [...people];
  const content = String(text || '').trim();

  const patterns = [
    /my name is\s+([a-zA-Z\u4e00-\u9fff]+)/i,
    /i am\s+([a-zA-Z\u4e00-\u9fff]+)/i,
    /i'm\s+([a-zA-Z\u4e00-\u9fff]+)/i,
    /我是\s*([\u4e00-\u9fffA-Za-z]+)/i,
    /我叫\s*([\u4e00-\u9fffA-Za-z]+)/i,
    /名字是\s*([\u4e00-\u9fffA-Za-z]+)/i
  ];

  let extractedName = '';

  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match && match[1]) {
      extractedName = match[1].trim();
      break;
    }
  }

  const inferredSenderGender = inferSenderGenderFromRelationship(content);

  const missingIndex = result.findIndex((p) => isBlank(p.name));
  if (missingIndex !== -1) {
    result[missingIndex] = {
      ...result[missingIndex],
      name: extractedName || result[missingIndex].name,
      gender: result[missingIndex].gender || inferredSenderGender
    };
  }

  return result;
}

function allPeopleHaveNames(people) {
  return Array.isArray(people) && people.length > 0 && people.every((p) => !isBlank(p.name));
}

async function getSheetData() {
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`
  });

  return response.data.values || [];
}

async function getSheetId() {
  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID
  });

  const sheet = spreadsheet.data.sheets.find(
    (s) => s.properties.title === SHEET_NAME
  );

  if (!sheet) {
    throw new Error(`Sheet "${SHEET_NAME}" not found.`);
  }

  return sheet.properties.sheetId;
}

async function registrationExists(event, sender, name) {
  const rows = await getSheetData();

  if (rows.length <= 1) return false;

  const targetEvent = normalizeText(event);
  const targetSender = String(sender || '').trim();
  const targetName = normalizeName(name);

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowEvent = normalizeText(row[1] || '');
    const rowSender = String(row[2] || '').trim();
    const rowName = normalizeName(row[3] || '');

    if (
      rowEvent === targetEvent &&
      rowSender === targetSender &&
      rowName === targetName
    ) {
      return true;
    }
  }

  return false;
}

async function addRowIfNotExists(event, sender, name, phone, gender, sat, sun) {
  if (isBlank(name)) {
    console.log('Skipped adding row because name is blank.');
    return false;
  }

  const exists = await registrationExists(event, sender, name);

  if (exists) {
    console.log(`Duplicate skipped: ${name} already registered for ${event}.`);
    return false;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A:H`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        new Date().toLocaleString('en-SG', { timeZone: 'Asia/Singapore' }),
        event || '',
        sender || '',
        name || '',
        phone || '',
        gender || '',
        sat || 'NO',
        sun || 'NO'
      ]]
    }
  });

  return true;
}

async function deleteAllRowsBySenderAndEvent(sender, event) {
  const rows = await getSheetData();

  if (rows.length <= 1) {
    console.log('No data rows found.');
    return 0;
  }

  const targetSender = String(sender || '').trim();
  const targetEvent = normalizeText(event);

  const rowsToDelete = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowEvent = normalizeText(row[1] || '');
    const rowSender = String(row[2] || '').trim();

    if (rowSender === targetSender && rowEvent === targetEvent) {
      rowsToDelete.push(i + 1);
    }
  }

  if (rowsToDelete.length === 0) {
    console.log(`No matching rows found for sender=${sender}, event=${event}`);
    return 0;
  }

  const sheetId = await getSheetId();

  rowsToDelete.sort((a, b) => b - a);

  const requests = rowsToDelete.map((rowNumber) => ({
    deleteDimension: {
      range: {
        sheetId,
        dimension: 'ROWS',
        startIndex: rowNumber - 1,
        endIndex: rowNumber
      }
    }
  }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests }
  });

  console.log(`Deleted ${rowsToDelete.length} row(s): ${rowsToDelete.join(', ')}`);
  return rowsToDelete.length;
}

async function deleteAllRowsBySenderAndEvents(sender, events) {
  let totalDeleted = 0;

  for (const event of events) {
    const count = await deleteAllRowsBySenderAndEvent(sender, event);
    totalDeleted += count;
  }

  return totalDeleted;
}

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});

client.on('qr', (qr) => {
  console.log('Scan this QR code in your browser:');
  console.log(`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qr)}`);
});

client.on('ready', () => {
  console.log('Bot is ready!');
});

client.on('authenticated', () => {
  console.log('WhatsApp authenticated successfully.');
});

client.on('auth_failure', (msg) => {
  console.log('Authentication failed:', msg);
});

client.on('disconnected', (reason) => {
  console.log('WhatsApp disconnected:', reason);
});

client.on('message', async (message) => {
  console.log('Message received:', message.body);

  try {
    const sender = message.from;
    const pending = pendingRegistrations.get(sender);

    if (pending) {
      const updatedPeople = fillMissingDetailsFromText(pending.people, message.body);

      if (allPeopleHaveNames(updatedPeople)) {
        let addedCount = 0;

        for (const event of pending.events) {
          for (const person of updatedPeople) {
            const added = await addRowIfNotExists(
              event,
              sender,
              person.name,
              person.phone,
              normalizeGender(person.gender),
              pending.sat,
              pending.sun
            );

            if (added) addedCount++;
          }
        }

        pendingRegistrations.delete(sender);
        console.log(`Pending registration completed. Added ${addedCount} row(s).`);
        return;
      } else {
        pendingRegistrations.set(sender, {
          ...pending,
          people: updatedPeople
        });
        console.log('Still waiting for missing registration details.');
        return;
      }
    }

    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      input: `Read this WhatsApp message and determine whether it is a registration, cancellation, question, or other message.

Return JSON ONLY in this exact format:
{
  "intent": "registration" | "cancellation" | "question" | "other",
  "events": [],
  "people": [
    {
      "name": "",
      "phone": "",
      "gender": ""
    }
  ]
}

Rules:
- Use "registration" if the sender clearly wants to sign up / register.
- Use "cancellation" if the sender says they cannot come, cannot make it, want to cancel, withdraw, 取消, 不来了, 不能来, cannot attend, not attending anymore.
- If it is a question or unrelated message, set people to [].
- Do not invent missing information.
- "events" should be an array of month names only, like ["March"], ["March","April"].
- If month is written in Chinese like 三月, convert it to English month name.
- If no month is clearly mentioned, default to ["March"].
- Names can be Chinese or English.
- Gender may appear as 男, 女, male, female, m, f.
- For phrases like "me and my wife/husband/friend", do not invent the sender's name if it is not explicitly stated. Leave it blank.
- For cancellation, people can be [] if the sender does not repeat their details.

Message:
${message.body}`
    });

    const result = response.output_text;
    console.log('AI extraction:', result);

    const cleaned = result
      .replace(/```json\s*/i, '')
      .replace(/```/g, '')
      .trim();

    const data = JSON.parse(cleaned);

    let events = detectEventsFromMessage(message.body);

    if (!Array.isArray(events) || events.length === 0) {
      if (Array.isArray(data.events) && data.events.length > 0) {
        events = data.events.map((e) => normalizeEvent(e));
      } else {
        events = ['March'];
      }
    }

    events = [...new Set(events.map((e) => normalizeEvent(e)))];

    const dayResult = detectDaysFromMessage(message.body);
    const sat = dayResult.sat;
    const sun = dayResult.sun;

    if (data.intent === 'registration' && Array.isArray(data.people) && data.people.length > 0) {
      let cleanedPeople = data.people.map((person) => ({
        name: String(person.name || '').trim(),
        phone: String(person.phone || '').trim(),
        gender: normalizeGender(person.gender || '')
      }));

      cleanedPeople = enrichPeopleFromRelationship(cleanedPeople, message.body);

      const validPeople = cleanedPeople.filter((person) => !isBlank(person.name));
      const missingPeople = cleanedPeople.filter((person) => isBlank(person.name));

      let addedCount = 0;

      for (const event of events) {
        for (const person of validPeople) {
          const added = await addRowIfNotExists(
            event,
            sender,
            person.name,
            person.phone,
            normalizeGender(person.gender),
            sat,
            sun
          );

          if (added) addedCount++;
        }
      }

      if (missingPeople.length > 0) {
        pendingRegistrations.set(sender, {
          events,
          sat,
          sun,
          people: missingPeople
        });

        console.log('Registration has missing names. Waiting for follow-up message.');
      }

      if (addedCount > 0) {
        console.log(`Added ${addedCount} new row(s) to Google Sheet.`);
      }

      if (addedCount === 0 && missingPeople.length === 0) {
        console.log('Registration detected but nothing new was added.');
      }
    } else if (data.intent === 'cancellation') {
      const deletedCount = await deleteAllRowsBySenderAndEvents(sender, events);

      pendingRegistrations.delete(sender);

      if (deletedCount > 0) {
        console.log(`Registration removed from Google Sheet. Deleted ${deletedCount} row(s).`);
      } else {
        console.log('Cancellation detected, but no matching registration found.');
      }
    } else {
      console.log('Not a registration or cancellation message.');
    }
  } catch (err) {
    console.log('Error:', err.message);
  }
});

client.initialize();
