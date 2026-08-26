const CARRIER_DISCORD_BRIDGE = {
  SPREADSHEET_ID: '1RvkYMyIjT7SGbu4nq5Pnqk2p2r6MnWLdXH17r1VI0fU',
  RESPONSES_SHEET: 'Form Responses 1',
  REVIEW_SHEET: 'Staff Review',
  HISTORY_SHEET: 'Review History',
};

/**
 * Run this ONCE in Apps Script before deploying the Web App.
 * It creates a random bridge token and prints it in the execution log.
 */
function setCarrierApplicationBridgeToken() {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('CARRIER_APPLICATION_API_TOKEN', token);
  console.log('CARRIER_APPLICATION_API_TOKEN=' + token);
  return token;
}

function doGet(e) {
  try {
    carrierBridgeAuthorize_(e && e.parameter ? e.parameter.token : '');
    const action = String((e && e.parameter && e.parameter.action) || '').trim();

    if (action === 'list') {
      return carrierBridgeJson_({ ok: true, applicants: carrierBridgeList_() });
    }

    if (action === 'get') {
      const id = String((e && e.parameter && e.parameter.id) || '').trim();
      if (!id) throw new Error('Missing application id.');
      return carrierBridgeJson_({ ok: true, application: carrierBridgeGet_(id) });
    }

    throw new Error('Unknown bridge action.');
  } catch (error) {
    return carrierBridgeJson_({ ok: false, error: error.message || String(error) });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    carrierBridgeAuthorize_(payload.token || '');

    if (payload.action !== 'saveReview') throw new Error('Unknown bridge action.');
    const result = carrierBridgeSaveReview_(payload);
    return carrierBridgeJson_({ ok: true, result: result });
  } catch (error) {
    return carrierBridgeJson_({ ok: false, error: error.message || String(error) });
  }
}

function carrierBridgeAuthorize_(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('CARRIER_APPLICATION_API_TOKEN');
  if (!expected) throw new Error('Bridge token has not been configured. Run setCarrierApplicationBridgeToken once.');
  if (!provided || String(provided) !== String(expected)) throw new Error('Unauthorized.');
}

function carrierBridgeBook_() {
  return SpreadsheetApp.openById(CARRIER_DISCORD_BRIDGE.SPREADSHEET_ID);
}

function carrierBridgeList_() {
  const sheet = carrierBridgeBook_().getSheetByName(CARRIER_DISCORD_BRIDGE.REVIEW_SHEET);
  if (!sheet) throw new Error('Staff Review sheet not found.');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rows = sheet.getRange(2, 1, lastRow - 1, Math.max(24, sheet.getLastColumn())).getValues();
  return rows
    .filter(row => String(row[0] || '').trim())
    .map(row => ({
      applicationId: String(row[0] || ''),
      submitted: carrierBridgeDate_(row[1]),
      discordUsername: String(row[2] || ''),
      discordUserId: String(row[3] || ''),
      robloxUsername: String(row[4] || ''),
      status: String(row[7] || 'New'),
      reviewer: String(row[8] || ''),
      total: row[15] === '' ? null : Number(row[15]),
      recommendation: String(row[16] || ''),
      decision: String(row[18] || 'Pending'),
    }))
    .sort((a, b) => carrierBridgeNumber_(b.applicationId) - carrierBridgeNumber_(a.applicationId))
    .slice(0, 25);
}

function carrierBridgeGet_(applicationId) {
  const book = carrierBridgeBook_();
  const review = book.getSheetByName(CARRIER_DISCORD_BRIDGE.REVIEW_SHEET);
  const responses = book.getSheetByName(CARRIER_DISCORD_BRIDGE.RESPONSES_SHEET);
  if (!review || !responses) throw new Error('Required Carrier Application sheets are missing.');

  const reviewRow = carrierBridgeFindReviewRow_(review, applicationId);
  if (!reviewRow) throw new Error('Application not found: ' + applicationId);

  const width = Math.max(24, review.getLastColumn());
  const headers = review.getRange(1, 1, 1, width).getValues()[0];
  const values = review.getRange(reviewRow, 1, 1, width).getValues()[0];
  const obj = carrierBridgeObject_(headers, values);

  const responseWidth = responses.getLastColumn();
  const responseLastRow = responses.getLastRow();
  const responseHeaders = responses.getRange(1, 1, 1, responseWidth).getValues()[0];
  const discordIdIndex = responseHeaders.indexOf('Discord User ID');
  let responseValues = null;

  if (responseLastRow >= 2 && discordIdIndex >= 0) {
    const targetId = String(obj['Discord User ID'] || '').trim();
    const rows = responses.getRange(2, 1, responseLastRow - 1, responseWidth).getValues();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (String(rows[i][discordIdIndex] || '').trim() === targetId) {
        responseValues = rows[i];
        break;
      }
    }
  }

  const answers = [];
  if (responseValues) {
    responseHeaders.forEach((question, index) => {
      if (!question) return;
      answers.push({
        question: String(question),
        answer: carrierBridgeDisplay_(responseValues[index]),
        section: carrierBridgeSection_(index),
      });
    });
  }

  return {
    applicationId: String(obj['Application ID'] || applicationId),
    submitted: carrierBridgeDate_(obj['Submitted']),
    discordUsername: String(obj['Discord Username'] || ''),
    discordUserId: String(obj['Discord User ID'] || ''),
    robloxUsername: String(obj['Roblox Username'] || ''),
    status: String(obj['Status'] || 'New'),
    reviewer: String(obj['Reviewer'] || ''),
    scores: {
      capability: carrierBridgeBlankNumber_(obj['Capability /5']),
      reliability: carrierBridgeBlankNumber_(obj['Reliability & Activity /4']),
      communication: carrierBridgeBlankNumber_(obj['Communication /3']),
      maturity: carrierBridgeBlankNumber_(obj['Attitude & Maturity /3']),
      knowledge: carrierBridgeBlankNumber_(obj['DQ Knowledge /3']),
      effort: carrierBridgeBlankNumber_(obj['Application Effort /2']),
    },
    total: carrierBridgeBlankNumber_(obj['Total /20']),
    recommendation: String(obj['Recommendation'] || ''),
    interviewRequired: String(obj['Interview Required'] || 'Pending'),
    decision: String(obj['Decision'] || 'Pending'),
    reasoning: String(obj['Reasoning'] || ''),
    nextAction: String(obj['Next Action'] || ''),
    privateNotes: String(obj['Private Review Notes'] || ''),
    lastReviewed: carrierBridgeDate_(obj['Last Reviewed']),
    reviewComplete: Boolean(obj['Review Complete']),
    answers: answers,
  };
}

function carrierBridgeSaveReview_(payload) {
  const id = String(payload.applicationId || '').trim();
  if (!id) throw new Error('Application ID is required.');

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const book = carrierBridgeBook_();
    const review = book.getSheetByName(CARRIER_DISCORD_BRIDGE.REVIEW_SHEET);
    let history = book.getSheetByName(CARRIER_DISCORD_BRIDGE.HISTORY_SHEET);
    if (!review) throw new Error('Staff Review sheet not found.');
    if (!history) history = book.insertSheet(CARRIER_DISCORD_BRIDGE.HISTORY_SHEET);

    const row = carrierBridgeFindReviewRow_(review, id);
    if (!row) throw new Error('Application not found: ' + id);

    const reviewerName = String(payload.reviewerName || '').trim();
    const reviewerId = String(payload.reviewerDiscordId || '').trim();
    const reviewer = reviewerName ? reviewerName + (reviewerId ? ' (' + reviewerId + ')' : '') : reviewerId;

    if (payload.scores) {
      const s = payload.scores;
      const values = [
        carrierBridgeScore_(s.capability, 5, 'Capability'),
        carrierBridgeScore_(s.reliability, 4, 'Reliability'),
        carrierBridgeScore_(s.communication, 3, 'Communication'),
        carrierBridgeScore_(s.maturity, 3, 'Maturity'),
        carrierBridgeScore_(s.knowledge, 3, 'DQ Knowledge'),
        carrierBridgeScore_(s.effort, 2, 'Application Effort'),
      ];
      const total = values.reduce((a, b) => a + b, 0);
      review.getRange(row, 10, 1, 6).setValues([values]);
      review.getRange(row, 16).setValue(total);
      review.getRange(row, 17).setValue(carrierBridgeRecommendation_(total));
      review.getRange(row, 8).setValue('Under Review');
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'privateNotes')) review.getRange(row, 22).setValue(String(payload.privateNotes || ''));
    if (Object.prototype.hasOwnProperty.call(payload, 'reasoning')) review.getRange(row, 20).setValue(String(payload.reasoning || ''));
    if (Object.prototype.hasOwnProperty.call(payload, 'nextAction')) review.getRange(row, 21).setValue(String(payload.nextAction || ''));

    if (Object.prototype.hasOwnProperty.call(payload, 'decision')) {
      const decision = carrierBridgeDecision_(payload.decision);
      review.getRange(row, 19).setValue(decision);
      let status = 'Under Review';
      if (decision === 'Accept' || decision === 'Accept / Trial') status = 'Accepted';
      if (decision === 'Interview') status = 'Interview';
      if (decision === 'Deny') status = 'Denied';
      review.getRange(row, 8).setValue(status);
      review.getRange(row, 18).setValue(decision === 'Interview' ? 'Yes' : 'Pending');
    }

    if (reviewer) review.getRange(row, 9).setValue(reviewer);
    review.getRange(row, 23).setValue(new Date());

    const snapshot = review.getRange(row, 1, 1, Math.max(24, review.getLastColumn())).getValues()[0];
    const total = snapshot[15] === '' ? '' : snapshot[15];
    const recommendation = String(snapshot[16] || '');
    const decision = String(snapshot[18] || 'Pending');
    const notes = [String(snapshot[19] || ''), String(snapshot[21] || '')].filter(Boolean).join('\n\n');

    if (history.getLastRow() === 0) {
      history.appendRow(['Timestamp','Application ID','Applicant','Reviewer','Capability','Reliability','Communication','Maturity','DQ Knowledge','Effort','Total','Recommendation','Decision','Notes','Next Action']);
    }
    history.appendRow([
      new Date(), id, String(snapshot[2] || ''), reviewer,
      snapshot[9], snapshot[10], snapshot[11], snapshot[12], snapshot[13], snapshot[14],
      total, recommendation, decision, notes, String(snapshot[20] || ''),
    ]);

    return { applicationId: id, total: total, recommendation: recommendation, decision: decision };
  } finally {
    lock.releaseLock();
  }
}

function carrierBridgeFindReviewRow_(sheet, id) {
  const last = sheet.getLastRow();
  if (last < 2) return null;
  const ids = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < ids.length; i++) if (String(ids[i][0]).trim() === id) return i + 2;
  return null;
}

function carrierBridgeObject_(headers, values) {
  const out = {};
  headers.forEach((header, i) => { if (header) out[String(header)] = values[i]; });
  return out;
}

function carrierBridgeDisplay_(value) {
  if (value instanceof Date) return carrierBridgeDate_(value);
  if (value === null || value === undefined || value === '') return 'No answer provided';
  return String(value);
}

function carrierBridgeDate_(value) {
  if (!value) return '';
  try {
    const date = value instanceof Date ? value : new Date(value);
    if (isNaN(date.getTime())) return String(value);
    return Utilities.formatDate(date, 'Europe/Dublin', 'dd MMM yyyy HH:mm');
  } catch (error) {
    return String(value);
  }
}

function carrierBridgeBlankNumber_(value) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  return isFinite(n) ? n : '';
}

function carrierBridgeScore_(value, max, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > max) throw new Error(label + ' must be 0-' + max + '.');
  return n;
}

function carrierBridgeDecision_(value) {
  const allowed = ['Pending','Accept','Accept / Trial','Interview','Deny'];
  const text = String(value || '').trim();
  if (!allowed.includes(text)) throw new Error('Invalid decision.');
  return text;
}

function carrierBridgeRecommendation_(total) {
  if (total >= 17) return 'Strong Accept';
  if (total >= 14) return 'Accept / Trial';
  if (total >= 11) return 'Interview';
  return 'Normally Deny';
}

function carrierBridgeNumber_(id) {
  const match = String(id || '').match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function carrierBridgeSection_(index) {
  if (index === 0) return 'Submission';
  if (index >= 1 && index <= 5) return 'I — Applicant Information';
  if (index >= 6 && index <= 11) return 'II — Carry Capability';
  if (index >= 12 && index <= 15) return 'III — Availability & Reliability';
  if (index >= 16 && index <= 20) return 'IV — Motivation & Conduct';
  if (index >= 21 && index <= 24) return 'V — Tavern Carry System';
  if (index >= 25 && index <= 28) return 'VI — Training & Probation';
  return 'VII — Applicant Declaration';
}

function carrierBridgeJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(ContentService.MimeType.JSON);
}
