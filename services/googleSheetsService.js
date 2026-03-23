const { google } = require("googleapis");
const config = require("../config");

const auth = new google.auth.GoogleAuth({
  credentials: config.serviceAccount,
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

const sheets = google.sheets({ version: "v4", auth });

async function getRegistrationRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${config.registrationSheetName}!A:I`,
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

async function appendRegistrationRows(newRows) {
  if (!newRows.length) return 0;

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheetId,
    range: `${config.registrationSheetName}!A:I`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: newRows,
    },
  });

  return newRows.length;
}

async function updateExistingRegistrationRow(rowNumber, newSat, newSun) {
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${config.registrationSheetName}!G${rowNumber}:H${rowNumber}`,
    valueInputOption: "USER_ENTERED",
    requestBody: {
      values: [[newSat, newSun]],
    },
  });
}

async function deleteRowsByNumber(rowNumbers) {
  if (!rowNumbers.length) return 0;

  const requests = rowNumbers
    .sort((a, b) => b - a)
    .map((rowNumber) => ({
      deleteDimension: {
        range: {
          sheetId: config.sheetTabId,
          dimension: "ROWS",
          startIndex: rowNumber - 1,
          endIndex: rowNumber,
        },
      },
    }));

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: { requests },
  });

  return rowNumbers.length;
}

async function getEventConfigRows() {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheetId,
    range: `${config.eventConfigSheetName}!A:E`,
  });

  const rows = res.data.values || [];
  if (rows.length <= 1) return [];

  return rows.slice(1).map((row) => ({
    EventCode: row[0] || "",
    EventName: row[1] || "",
    Month: row[2] || "",
    DefaultFlag: row[3] || "",
    Active: row[4] || "",
  }));
}

async function getDefaultEventFromFactTable() {
  const rows = await getEventConfigRows();

  const activeDefault = rows.find(
    (r) =>
      String(r.DefaultFlag).trim().toUpperCase() === "YES" &&
      String(r.Active).trim().toUpperCase() === "YES"
  );

  if (activeDefault && activeDefault.Month) {
    return activeDefault.Month;
  }

  return config.defaultEventFallback;
}

module.exports = {
  getRegistrationRows,
  appendRegistrationRows,
  updateExistingRegistrationRow,
  deleteRowsByNumber,
  getEventConfigRows,
  getDefaultEventFromFactTable,
};
