module.exports = {
  sheetId: process.env.GOOGLE_SHEET_ID,
  registrationSheetName: process.env.GOOGLE_SHEET_NAME || "Registrations",
  eventConfigSheetName: process.env.GOOGLE_EVENT_CONFIG_SHEET_NAME || "EventConfig",
  openAiApiKey: process.env.OPENAI_API_KEY,
  sheetTabId: Number(process.env.GOOGLE_SHEET_TAB_ID || 0),
  timezone: "Asia/Singapore",
  defaultEventFallback: "April",
  supportedEvents: ["April", "May"],
  contextExpiryMinutes: 60,
  serviceAccount: {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
  },
};
