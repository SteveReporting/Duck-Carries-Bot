// The Carry Tavern - Gold Donation Google Sheets webhook
//
// 1. Create/open the Google Sheet that should receive donation submissions.
// 2. Extensions -> Apps Script, paste this file into Code.gs.
// 3. Project Settings -> Script Properties:
//      DONATION_WEBHOOK_SECRET = a long random secret
// 4. Deploy -> New deployment -> Web app.
//    Execute as: Me
//    Who has access: Anyone
// 5. Put the deployment /exec URL and the same secret into the bot's .env:
//      GOLD_DONATION_SHEET_WEBHOOK_URL=
//      GOLD_DONATION_SHEET_WEBHOOK_SECRET=

const GOLD_DONATION_SHEET_NAME = "Gold Donations";

function jsonResponse(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const expectedSecret = PropertiesService
      .getScriptProperties()
      .getProperty("DONATION_WEBHOOK_SECRET");

    const data = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    if (!expectedSecret || data.secret !== expectedSecret) {
      return jsonResponse({ ok: false, error: "Unauthorized" });
    }

    const amount = Number(data.goldAmount);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000000000) {
      return jsonResponse({ ok: false, error: "Gold amount must be between 1 and 10T" });
    }

    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(GOLD_DONATION_SHEET_NAME);
    if (!sheet) sheet = spreadsheet.insertSheet(GOLD_DONATION_SHEET_NAME);

    const headers = [
      "Timestamp",
      "Submission ID",
      "Discord Username",
      "Discord Display Name",
      "Discord User ID",
      "Roblox Username",
      "Gold Amount",
      "Gold Display",
      "Guild",
      "Guild ID",
    ];

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    }

    sheet.appendRow([
      data.timestamp || new Date().toISOString(),
      data.submissionId || "",
      data.discordUsername || "",
      data.discordDisplayName || "",
      data.discordUserId || "",
      data.robloxUsername || "",
      amount,
      data.goldAmountDisplay || "",
      data.guildName || "",
      data.guildId || "",
    ]);

    return jsonResponse({ ok: true });
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message || String(error) });
  }
}
