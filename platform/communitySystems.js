const db = require("../database/database");
const { canonicalizeDungeon, canonicalizeDifficulty } = require("./dungeons");

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function now() {
  return Date.now();
}

function normalizeScope(dungeon, difficulty = "*") {
  return {
    dungeon: dungeon === "*" ? "*" : canonicalizeDungeon(dungeon),
    difficulty: difficulty === "*" ? "*" : canonicalizeDifficulty(difficulty),
  };
}

function setCarrierAvailability(guildId, userId, available) {
  const stamp = now();
  db.prepare(`
    INSERT INTO carrier_status(guild,user,available,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(guild,user) DO UPDATE SET
      available=excluded.available,
      updated_at=excluded.updated_at,
      session_dungeon=CASE WHEN excluded.available=0 THEN NULL ELSE carrier_status.session_dungeon END,
      session_difficulty=CASE WHEN excluded.available=0 THEN NULL ELSE carrier_status.session_difficulty END,
      session_started_at=CASE WHEN excluded.available=0 THEN NULL ELSE carrier_status.session_started_at END
  `).run(String(guildId), String(userId), available ? 1 : 0, stamp);
  return getCarrierStatus(guildId, userId);
}

function startCarrierSession(guildId, userId, dungeon, difficulty) {
  const scope = normalizeScope(dungeon, difficulty);
  const stamp = now();
  db.prepare(`
    INSERT INTO carrier_status(guild,user,available,session_dungeon,session_difficulty,session_started_at,updated_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guild,user) DO UPDATE SET
      available=1,
      session_dungeon=excluded.session_dungeon,
      session_difficulty=excluded.session_difficulty,
      session_started_at=excluded.session_started_at,
      updated_at=excluded.updated_at
  `).run(String(guildId), String(userId), 1, scope.dungeon, scope.difficulty, stamp, stamp);
  return getCarrierStatus(guildId, userId);
}

function stopCarrierSession(guildId, userId, keepAvailable = false) {
  const stamp = now();
  db.prepare(`
    INSERT INTO carrier_status(guild,user,available,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(guild,user) DO UPDATE SET
      available=excluded.available,
      session_dungeon=NULL,
      session_difficulty=NULL,
      session_started_at=NULL,
      updated_at=excluded.updated_at
  `).run(String(guildId), String(userId), keepAvailable ? 1 : 0, stamp);
  return getCarrierStatus(guildId, userId);
}

function getCarrierStatus(guildId, userId) {
  return db.prepare("SELECT * FROM carrier_status WHERE guild=? AND user=?").get(String(guildId), String(userId)) || null;
}

function listAvailableCarriers(guildId) {
  return db.prepare(`
    SELECT * FROM carrier_status
    WHERE guild=? AND available=1
    ORDER BY CASE WHEN session_started_at IS NULL THEN 1 ELSE 0 END, updated_at DESC
  `).all(String(guildId));
}

function setCarrierPermission(guildId, userId, dungeon, difficulty, allowed, grantedBy) {
  const scope = normalizeScope(dungeon, difficulty || "*");
  db.prepare(`
    INSERT INTO carrier_permissions(guild,user,dungeon,difficulty,allowed,granted_by,created_at)
    VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(guild,user,dungeon,difficulty) DO UPDATE SET
      allowed=excluded.allowed,
      granted_by=excluded.granted_by,
      created_at=excluded.created_at
  `).run(String(guildId), String(userId), scope.dungeon, scope.difficulty, allowed ? 1 : 0, String(grantedBy || ""), now());
  return scope;
}

function removeCarrierPermission(guildId, userId, dungeon, difficulty = "*") {
  const scope = normalizeScope(dungeon, difficulty);
  return db.prepare(`DELETE FROM carrier_permissions WHERE guild=? AND user=? AND dungeon=? AND difficulty=?`)
    .run(String(guildId), String(userId), scope.dungeon, scope.difficulty).changes;
}

function clearCarrierPermissions(guildId, userId) {
  return db.prepare("DELETE FROM carrier_permissions WHERE guild=? AND user=?")
    .run(String(guildId), String(userId)).changes;
}

function listCarrierPermissions(guildId, userId) {
  return db.prepare(`
    SELECT dungeon,difficulty,allowed,granted_by,created_at
    FROM carrier_permissions WHERE guild=? AND user=?
    ORDER BY dungeon,difficulty
  `).all(String(guildId), String(userId));
}

function carrierCanHandle(guildId, userId, dungeon, difficulty) {
  const rows = listCarrierPermissions(guildId, userId);
  if (!rows.length) return true; // backwards-compatible: unrestricted until staff configures a scope.
  const scope = normalizeScope(dungeon, difficulty);
  const matches = rows.filter((row) =>
    (row.dungeon === "*" || row.dungeon === scope.dungeon) &&
    (row.difficulty === "*" || row.difficulty === scope.difficulty));
  if (!matches.length) return false;
  // A more-specific rule beats a wildcard rule. A deny beats an equally-specific allow.
  matches.sort((a, b) => {
    const specA = (a.dungeon === "*" ? 0 : 2) + (a.difficulty === "*" ? 0 : 1);
    const specB = (b.dungeon === "*" ? 0 : 2) + (b.difficulty === "*" ? 0 : 1);
    return specB - specA || a.allowed - b.allowed;
  });
  return Boolean(matches[0].allowed);
}

function sessionMatches(status, dungeon, difficulty) {
  if (!status?.session_dungeon) return true;
  const scope = normalizeScope(dungeon, difficulty);
  return status.session_dungeon === scope.dungeon &&
    (!status.session_difficulty || status.session_difficulty === "*" || status.session_difficulty === scope.difficulty);
}

function matchingCarrierIds(guildId, dungeon, difficulty) {
  return listAvailableCarriers(guildId)
    .filter((status) => sessionMatches(status, dungeon, difficulty))
    .filter((status) => carrierCanHandle(guildId, status.user, dungeon, difficulty))
    .map((status) => status.user);
}

function countAvailableCarriers(guildId, dungeon = null, difficulty = null) {
  if (!dungeon) return listAvailableCarriers(guildId).length;
  return matchingCarrierIds(guildId, dungeon, difficulty).length;
}

function priorityForAge(createdAt) {
  const age = Math.max(0, now() - new Date(createdAt).getTime());
  if (age >= 18 * HOUR) return { label: "CRITICAL", icon: "🔴", rank: 4 };
  if (age >= 12 * HOUR) return { label: "URGENT", icon: "🟠", rank: 3 };
  if (age >= 6 * HOUR) return { label: "HIGH", icon: "🟡", rank: 2 };
  return { label: "NORMAL", icon: "🟢", rank: 1 };
}

function estimateQueueMinutes(position, availableCarriers) {
  const carriers = Math.max(0, Number(availableCarriers) || 0);
  if (!carriers) return null;
  // One grouped carry slot is treated as roughly 15 minutes. This is deliberately conservative
  // and becomes more accurate as more carriers mark themselves available.
  return Math.max(5, Math.ceil((Math.max(1, position) / carriers) * 15));
}

function recordCarrierRating({ guildId, requestId, carrierId, requesterId, score, note = null }) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO carrier_ratings(guild,request_id,carrier,requester,score,note,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(String(guildId || ""), String(requestId), String(carrierId), String(requesterId), Number(score), note ? String(note).slice(0, 500) : null, now());
  return result.changes === 1;
}

function carrierReputation(carrierId, guildId = null) {
  const where = guildId ? "carrier=? AND guild=?" : "carrier=?";
  const params = guildId ? [String(carrierId), String(guildId)] : [String(carrierId)];
  const summary = db.prepare(`
    SELECT COUNT(*) AS ratings, ROUND(AVG(score),2) AS average,
           SUM(CASE WHEN score=5 THEN 1 ELSE 0 END) AS five_star
    FROM carrier_ratings WHERE ${where}
  `).get(...params);
  const recent = db.prepare(`
    SELECT score,note,created_at FROM carrier_ratings WHERE ${where}
    ORDER BY created_at DESC LIMIT 5
  `).all(...params);
  return {
    ratings: Number(summary?.ratings || 0),
    average: summary?.average == null ? null : Number(summary.average),
    fiveStar: Number(summary?.five_star || 0),
    recent,
  };
}

function recordNoShow({ guildId, requestId = null, offenderId, reporterId, offenderSide, reason = null }) {
  db.prepare(`
    INSERT INTO no_shows(guild,request_id,offender,reporter,offender_side,reason,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(String(guildId), requestId ? String(requestId) : null, String(offenderId), String(reporterId), String(offenderSide), reason ? String(reason).slice(0, 500) : null, now());
  recordAbuseEvent(guildId, offenderId, "no_show", 3, { requestId, offenderSide });
}

function noShowSummary(guildId, userId, windowDays = 30) {
  const since = now() - windowDays * DAY;
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
      SUM(CASE WHEN offender_side='requester' THEN 1 ELSE 0 END) AS requester_count,
      SUM(CASE WHEN offender_side='carrier' THEN 1 ELSE 0 END) AS carrier_count
    FROM no_shows WHERE guild=? AND offender=? AND created_at>=?
  `).get(String(guildId), String(userId), since);
  return {
    total: Number(row?.total || 0),
    requester: Number(row?.requester_count || 0),
    carrier: Number(row?.carrier_count || 0),
  };
}

function addWarning(guildId, userId, staffId, reason) {
  const info = db.prepare(`INSERT INTO warnings(guild,user,staff,reason,active,created_at) VALUES(?,?,?,?,1,?)`)
    .run(String(guildId), String(userId), String(staffId), String(reason).slice(0, 1000), now());
  recordAbuseEvent(guildId, userId, "warning", 3, { warningId: info.lastInsertRowid });
  return Number(info.lastInsertRowid);
}

function removeWarning(guildId, warningId, staffId) {
  return db.prepare(`
    UPDATE warnings SET active=0,removed_at=?,removed_by=?
    WHERE guild=? AND id=? AND active=1
  `).run(now(), String(staffId), String(guildId), Number(warningId)).changes;
}

function listWarnings(guildId, userId, activeOnly = false) {
  return db.prepare(`
    SELECT * FROM warnings WHERE guild=? AND user=? ${activeOnly ? "AND active=1" : ""}
    ORDER BY created_at DESC LIMIT 25
  `).all(String(guildId), String(userId));
}

function recordTradeRating({ guildId, raterId, targetId, score, reference, note = null }) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO trade_ratings(guild,rater,target,score,reference,note,created_at)
    VALUES(?,?,?,?,?,?,?)
  `).run(String(guildId), String(raterId), String(targetId), Number(score), String(reference).slice(0, 120), note ? String(note).slice(0, 500) : null, now());
  return result.changes === 1;
}

function tradeReputation(guildId, userId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS ratings,ROUND(AVG(score),2) AS average,
      SUM(CASE WHEN score>=4 THEN 1 ELSE 0 END) AS positive
    FROM trade_ratings WHERE guild=? AND target=?
  `).get(String(guildId), String(userId));
  return {
    ratings: Number(row?.ratings || 0),
    average: row?.average == null ? null : Number(row.average),
    positive: Number(row?.positive || 0),
  };
}

function recordTradeDispute({ guildId, reporterId, targetId, kind, reason, evidence = null }) {
  const result = db.prepare(`
    INSERT INTO trade_disputes(guild,reporter,target,kind,reason,evidence,status,created_at)
    VALUES(?,?,?,?,?,?,'open',?)
  `).run(String(guildId), String(reporterId), String(targetId), String(kind), String(reason).slice(0, 1500), evidence ? String(evidence).slice(0, 1000) : null, now());
  recordAbuseEvent(guildId, targetId, kind === "scam" ? "scam_report" : "trade_dispute", kind === "scam" ? 4 : 2, { disputeId: result.lastInsertRowid });
  return Number(result.lastInsertRowid);
}

function resolveTradeDispute(guildId, disputeId, staffId) {
  return db.prepare(`
    UPDATE trade_disputes SET status='resolved',resolved_at=?,resolved_by=?
    WHERE guild=? AND id=? AND status='open'
  `).run(now(), String(staffId), String(guildId), Number(disputeId)).changes;
}

function recordAbuseEvent(guildId, userId, kind, weight = 1, metadata = null) {
  db.prepare(`INSERT INTO abuse_events(guild,user,kind,weight,metadata,created_at) VALUES(?,?,?,?,?,?)`)
    .run(String(guildId), String(userId), String(kind), Number(weight) || 0, metadata ? JSON.stringify(metadata).slice(0, 2000) : null, now());
}

function abuseSummary(guildId, userId) {
  const thirtyDays = now() - 30 * DAY;
  const oneHour = now() - HOUR;
  const weighted = db.prepare(`SELECT COALESCE(SUM(weight),0) AS score FROM abuse_events WHERE guild=? AND user=? AND created_at>=?`)
    .get(String(guildId), String(userId), thirtyDays);
  const requestBurst = db.prepare(`SELECT COUNT(*) AS count FROM abuse_events WHERE guild=? AND user=? AND kind='queue_request' AND created_at>=?`)
    .get(String(guildId), String(userId), oneHour);
  const activeWarnings = db.prepare(`SELECT COUNT(*) AS count FROM warnings WHERE guild=? AND user=? AND active=1`)
    .get(String(guildId), String(userId));
  const burst = Math.max(0, Number(requestBurst?.count || 0) - 3) * 2;
  const score = Number(weighted?.score || 0) + burst;
  return {
    score,
    level: score >= 12 ? "critical" : score >= 8 ? "high" : score >= 5 ? "watch" : "normal",
    requestBurst: Number(requestBurst?.count || 0),
    activeWarnings: Number(activeWarnings?.count || 0),
    noShows: noShowSummary(guildId, userId, 30).total,
  };
}

async function maybeSendAbuseAlert(client, guildId, userId, context = "activity") {
  const summary = abuseSummary(guildId, userId);
  if (summary.score < 8 || !process.env.MOD_LOG_CHANNEL_ID) return summary;
  const previous = db.prepare("SELECT * FROM abuse_alerts WHERE guild=? AND user=?").get(String(guildId), String(userId));
  if (previous && now() - previous.last_alert_at < 6 * HOUR && summary.score < previous.last_score + 3) return summary;

  const channel = await client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
  if (channel?.isTextBased?.()) {
    await channel.send([
      `⚠️ **Anti-abuse flag: <@${userId}>**`,
      `Risk: **${summary.level.toUpperCase()}** (${summary.score} points)`,
      `Active warnings: ${summary.activeWarnings} • No-shows (30d): ${summary.noShows} • Requests (1h): ${summary.requestBurst}`,
      `Triggered by: ${context}`,
      "This is a staff flag only. The bot does not automatically punish the member.",
    ].join("\n")).catch(() => {});
  }
  db.prepare(`
    INSERT INTO abuse_alerts(guild,user,last_alert_at,last_score) VALUES(?,?,?,?)
    ON CONFLICT(guild,user) DO UPDATE SET last_alert_at=excluded.last_alert_at,last_score=excluded.last_score
  `).run(String(guildId), String(userId), now(), summary.score);
  return summary;
}

async function notifyMatchingCarriers(client, guildId, request) {
  if (!client || !guildId || !request?.dungeon) return 0;
  const dungeon = canonicalizeDungeon(request.dungeon);
  const difficulty = canonicalizeDifficulty(request.difficulty);
  const ids = matchingCarrierIds(guildId, dungeon, difficulty).slice(0, 20);
  if (!ids.length) return 0;
  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild=?").get(String(guildId));
  const queueChannel = process.env.CARRY_QUEUE_CHANNEL_ID || settings?.queueChannel || null;
  const link = queueChannel ? `https://discord.com/channels/${guildId}/${queueChannel}` : null;
  let sent = 0;
  for (const id of ids) {
    try {
      const user = await client.users.fetch(id);
      await user.send([
        "⚔️ **Carry match available**",
        `🏰 ${dungeon}`,
        `⚔️ ${difficulty}`,
        `👥 ${Number(request.runs_requested || request.runs || 1)} run(s)`,
        request.availability ? `🕒 ${request.availability}` : null,
        "",
        "You are marked available and this request matches your Carrier permissions/session.",
        "Open `/queue view` in The Carry Tavern to claim the grouped run tier.",
        link,
      ].filter(Boolean).join("\n"));
      sent += 1;
    } catch {}
  }
  return sent;
}

module.exports = {
  abuseSummary,
  addWarning,
  carrierCanHandle,
  carrierReputation,
  clearCarrierPermissions,
  countAvailableCarriers,
  estimateQueueMinutes,
  getCarrierStatus,
  listAvailableCarriers,
  listCarrierPermissions,
  listWarnings,
  matchingCarrierIds,
  maybeSendAbuseAlert,
  noShowSummary,
  notifyMatchingCarriers,
  priorityForAge,
  recordAbuseEvent,
  recordCarrierRating,
  recordNoShow,
  recordTradeDispute,
  recordTradeRating,
  removeCarrierPermission,
  removeWarning,
  resolveTradeDispute,
  setCarrierAvailability,
  setCarrierPermission,
  startCarrierSession,
  stopCarrierSession,
  tradeReputation,
};
