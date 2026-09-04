const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { ensureCarryControlCenter } = require("./carryControlCenter");
const { ensureSessionVoice } = require("./carryVoiceSystem");
const {
  estimateQueueMinutes,
  notifyMatchingCarriers,
} = require("./communitySystems");

const PULSE_BUTTON_ID = "tavern_ops_pulse";
const SWEEP_MS = 2 * 60 * 1000;
const REPAIR_MS = 10 * 60 * 1000;
const ALERT_COOLDOWN_MS = 30 * 60 * 1000;
const RESCUE_RENOTIFY_MS = 60 * 60 * 1000;
const STALE_QUEUE_MS = 35 * 60 * 1000;
const STALE_CLAIM_MS = 18 * 60 * 1000;
const LONG_SESSION_MS = 2 * 60 * 60 * 1000;

let timer = null;
let sweepRunning = false;
let lastRepairAt = 0;
const cache = new Map();

db.exec(`
  CREATE TABLE IF NOT EXISTS carry_ops_alerts (
    alert_key TEXT PRIMARY KEY,
    last_sent_at INTEGER NOT NULL,
    occurrences INTEGER NOT NULL DEFAULT 1,
    payload TEXT
  );
`);

function ageMs(value, now = Date.now()) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? Math.max(0, now - ms) : 0;
}

function minutes(ms) {
  return Math.max(0, Math.floor(Number(ms || 0) / 60000));
}

function safeScalar(sql, field, params = []) {
  try {
    return Number(db.prepare(sql).get(...params)?.[field] || 0);
  } catch {
    return 0;
  }
}

function safeCount(sql, params = []) {
  return safeScalar(sql, "count", params);
}

function pressureFor({ waiting = 0, oldestMinutes = 0, availableCarriers = 0 }) {
  const score = Math.max(0, waiting * 10 + Math.min(60, oldestMinutes) - availableCarriers * 12);
  if (waiting === 0) return { level: "clear", score: 0, label: "🟢 Clear" };
  if (score >= 85 || oldestMinutes >= 50) return { level: "critical", score, label: "🔴 Critical" };
  if (score >= 45 || oldestMinutes >= 30) return { level: "high", score, label: "🟠 High" };
  if (score >= 20) return { level: "medium", score, label: "🟡 Medium" };
  return { level: "low", score, label: "🟢 Low" };
}

function healthLabel(snapshot) {
  if (!snapshot) return "⚪ Starting";
  if (!snapshot.supabaseOk) return "🔴 Database issue";
  if (snapshot.orphanedSessions > 0) return "🟠 Repair needed";
  if (snapshot.lastSweepError) return "🟠 Degraded";
  return "🟢 Healthy";
}

function formatAge(ms) {
  const mins = minutes(ms);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return `${hours}h ${rest}m`;
}

function formatServiceMinutes(totalMinutes) {
  const total = Math.max(0, Math.floor(Number(totalMinutes || 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

async function loadCarryRows() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,dungeon,difficulty,runs_requested,availability,status,created_at,claimed_at,started_at,updated_at,ticket_channel_id")
    .in("status", ["queued", "claimed", "in_progress"])
    .order("created_at", { ascending: true })
    .limit(250);
  if (error) throw new Error(error.message);
  return data || [];
}

function cachedSnapshot(guildId) {
  return cache.get(String(guildId)) || null;
}

async function buildSnapshot(guild) {
  const now = Date.now();
  let rows = [];
  let supabaseOk = true;
  let errorText = null;

  try {
    rows = await loadCarryRows();
  } catch (error) {
    supabaseOk = false;
    errorText = error.message;
  }

  const waitingRows = rows.filter((row) => row.status === "queued");
  const claimedRows = rows.filter((row) => row.status === "claimed");
  const runningRows = rows.filter((row) => row.status === "in_progress");
  const oldestWaitingMs = waitingRows.length ? ageMs(waitingRows[0].created_at, now) : 0;
  const availableCarriers = safeCount(
    "SELECT COUNT(*) AS count FROM carrier_status WHERE guild=? AND available=1",
    [String(guild.id)],
  );
  const timedSessions = safeCount(
    "SELECT COUNT(*) AS count FROM carry_service_sessions WHERE guild=? AND status IN ('running','checkpoint')",
    [String(guild.id)],
  );
  const voiceSessions = safeCount(
    "SELECT COUNT(*) AS count FROM carry_voice_sessions WHERE guild=? AND status IN ('claimed','started')",
    [String(guild.id)],
  );

  const since24h = now - 24 * 60 * 60 * 1000;
  const completed24h = safeCount(
    "SELECT COUNT(*) AS count FROM carry_service_history WHERE guild=? AND completed_at>=?",
    [String(guild.id), since24h],
  );
  const serviceMinutes24h = safeScalar(
    "SELECT COALESCE(SUM(service_minutes),0) AS total FROM carry_service_history WHERE guild=? AND completed_at>=?",
    "total",
    [String(guild.id), since24h],
  );
  const requesters24h = safeScalar(
    "SELECT COALESCE(SUM(request_count),0) AS total FROM carry_service_history WHERE guild=? AND completed_at>=?",
    "total",
    [String(guild.id), since24h],
  );

  let orphanedSessions = 0;
  for (const row of [...claimedRows, ...runningRows]) {
    if (!row.ticket_channel_id) {
      orphanedSessions += 1;
      continue;
    }
    if (!guild.channels.cache.has(String(row.ticket_channel_id))) {
      const fetched = await guild.channels.fetch(String(row.ticket_channel_id)).catch(() => null);
      if (!fetched) orphanedSessions += 1;
    }
  }

  const staleQueuedRows = waitingRows.filter((row) => ageMs(row.created_at, now) >= STALE_QUEUE_MS);
  const staleClaimedRows = claimedRows.filter((row) => ageMs(row.claimed_at || row.updated_at || row.created_at, now) >= STALE_CLAIM_MS);
  const longRunningRows = runningRows.filter((row) => ageMs(row.started_at || row.updated_at || row.created_at, now) >= LONG_SESSION_MS);
  const pressure = pressureFor({
    waiting: waitingRows.length,
    oldestMinutes: minutes(oldestWaitingMs),
    availableCarriers,
  });
  const queueTailEtaMinutes = waitingRows.length
    ? estimateQueueMinutes(waitingRows.length, availableCarriers)
    : 0;

  const previous = cachedSnapshot(guild.id);
  const snapshot = {
    guildId: String(guild.id),
    generatedAt: now,
    supabaseOk,
    lastSweepError: errorText,
    waiting: waitingRows.length,
    claimed: claimedRows.length,
    running: runningRows.length,
    activeTotal: claimedRows.length + runningRows.length,
    oldestWaitingMs,
    availableCarriers,
    timedSessions,
    voiceSessions,
    orphanedSessions,
    staleQueued: staleQueuedRows.length,
    staleClaimed: staleClaimedRows.length,
    longRunning: longRunningRows.length,
    completed24h,
    serviceMinutes24h,
    requesters24h,
    queueTailEtaMinutes,
    pressure,
    discordPing: Number.isFinite(guild.client.ws.ping) ? Math.round(guild.client.ws.ping) : null,
    lastRepairAt: previous?.lastRepairAt || 0,
    repairedLastSweep: previous?.repairedLastSweep || 0,
    rescuePingsLastSweep: previous?.rescuePingsLastSweep || 0,
    rows,
  };

  cache.set(String(guild.id), snapshot);
  return snapshot;
}

function pulseEmbed(snapshot) {
  const age = snapshot.generatedAt ? `<t:${Math.floor(snapshot.generatedAt / 1000)}:R>` : "now";
  const tailEta = snapshot.waiting === 0
    ? "No queue"
    : snapshot.queueTailEtaMinutes == null
      ? "Waiting for Carrier availability"
      : `~${snapshot.queueTailEtaMinutes}m queue-tail estimate`;

  return new EmbedBuilder()
    .setColor(snapshot.pressure.level === "critical" ? 0xed4245 : snapshot.pressure.level === "high" ? 0xf39c12 : 0x2ecc71)
    .setAuthor({ name: "THE CARRY TAVERN • LIVE OPERATIONS" })
    .setTitle("🧠 Tavern Pulse")
    .setDescription([
      "A real-time readout of the carry platform. No guessing whether the queue is healthy and no manual staff spreadsheet required.",
      "",
      `**System health:** ${healthLabel(snapshot)}`,
      `**Queue pressure:** ${snapshot.pressure.label}`,
      `**Forecast:** ${tailEta}`,
      `**Updated:** ${age}`,
    ].join("\n"))
    .addFields(
      { name: "📥 Waiting", value: `**${snapshot.waiting}**`, inline: true },
      { name: "🍻 Available Carriers", value: `**${snapshot.availableCarriers}**`, inline: true },
      { name: "⏱️ Oldest Wait", value: `**${formatAge(snapshot.oldestWaitingMs)}**`, inline: true },
      { name: "🎟️ Claimed", value: `**${snapshot.claimed}**`, inline: true },
      { name: "▶️ Live Sessions", value: `**${snapshot.running}**`, inline: true },
      { name: "🔊 Session VCs", value: `**${snapshot.voiceSessions}**`, inline: true },
      { name: "✅ Sessions • 24h", value: `**${snapshot.completed24h}**`, inline: true },
      { name: "👥 Served • 24h", value: `**${snapshot.requesters24h}**`, inline: true },
      { name: "⏲️ Verified Time • 24h", value: `**${formatServiceMinutes(snapshot.serviceMinutes24h)}**`, inline: true },
      { name: "🛟 Rescue Queue", value: `**${snapshot.staleQueued}** stale`, inline: true },
      { name: "🧩 Repair Watch", value: snapshot.orphanedSessions ? `**${snapshot.orphanedSessions}** issue(s)` : "**0** issues", inline: true },
      { name: "📡 Gateway", value: snapshot.discordPing == null ? "Unknown" : `**${snapshot.discordPing}ms**`, inline: true },
    )
    .addFields({
      name: "🤖 Automation Layer",
      value: [
        "`AUTO-RESCUE` re-pings matching available Carriers for stale requests",
        "`SELF-HEAL` repairs control centers + session VCs",
        "`WATCHDOG` detects orphaned/stalled sessions",
        "`FORECAST` calculates queue pressure and queue-tail ETA",
        "`DEDUPED ALERTS` staff only hear about unresolved problems",
      ].join("\n"),
      inline: false,
    })
    .setFooter({ text: "The Carry Tavern • Self-Healing Operations" })
    .setTimestamp(snapshot.generatedAt);
}

function pulseComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PULSE_BUTTON_ID)
      .setLabel("Refresh Pulse")
      .setEmoji("🔄")
      .setStyle(ButtonStyle.Secondary),
  )];
}

async function handlePulseInteraction(interaction) {
  if (!interaction.isButton?.() || interaction.customId !== PULSE_BUTTON_ID || !interaction.inGuild?.()) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const snapshot = await buildSnapshot(interaction.guild);
  await interaction.editReply({ embeds: [pulseEmbed(snapshot)], components: pulseComponents() });
  return true;
}

function alertAllowed(key, cooldownMs = ALERT_COOLDOWN_MS, now = Date.now()) {
  const row = db.prepare("SELECT last_sent_at FROM carry_ops_alerts WHERE alert_key=?").get(String(key));
  return !row || now - Number(row.last_sent_at || 0) >= cooldownMs;
}

function markAlert(key, payload, now = Date.now()) {
  db.prepare(`
    INSERT INTO carry_ops_alerts(alert_key,last_sent_at,occurrences,payload)
    VALUES(?,?,1,?)
    ON CONFLICT(alert_key) DO UPDATE SET
      last_sent_at=excluded.last_sent_at,
      occurrences=carry_ops_alerts.occurrences+1,
      payload=excluded.payload
  `).run(String(key), now, JSON.stringify(payload || {}));
}

async function alertChannel(guild) {
  const id = process.env.MOD_LOG_CHANNEL_ID || process.env.CARRY_QUEUE_CHANNEL_ID;
  if (!id) return null;
  const channel = guild.channels.cache.get(String(id)) || await guild.channels.fetch(String(id)).catch(() => null);
  return channel?.isTextBased?.() ? channel : null;
}

async function renotifyStaleCarries(client, guild, snapshot) {
  let sent = 0;
  const stale = snapshot.rows
    .filter((row) => row.status === "queued" && ageMs(row.created_at) >= STALE_QUEUE_MS)
    .slice(0, 3);

  for (const request of stale) {
    const key = `rescue-renotify:${request.id}`;
    if (!alertAllowed(key, RESCUE_RENOTIFY_MS)) continue;
    const notified = await notifyMatchingCarriers(client, guild.id, request).catch(() => 0);
    markAlert(key, { notified, dungeon: request.dungeon, difficulty: request.difficulty });
    sent += notified;
  }

  return sent;
}

async function sendRescueAlerts(guild, snapshot) {
  const channel = await alertChannel(guild);
  if (!channel) return 0;
  let sent = 0;

  if ((snapshot.pressure.level === "critical" || snapshot.staleQueued > 0) && alertAllowed("queue-pressure")) {
    const stale = snapshot.rows
      .filter((row) => row.status === "queued" && ageMs(row.created_at) >= STALE_QUEUE_MS)
      .slice(0, 8)
      .map((row) => `• **${row.dungeon} • ${row.difficulty}** — waiting ${formatAge(ageMs(row.created_at))}`);

    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xed4245)
        .setTitle("🛟 Auto-Rescue • Queue Pressure")
        .setDescription([
          `Queue pressure is **${snapshot.pressure.level.toUpperCase()}** with **${snapshot.waiting}** waiting and **${snapshot.availableCarriers}** available Carrier(s).`,
          snapshot.rescuePingsLastSweep ? `The rescue engine re-notified **${snapshot.rescuePingsLastSweep}** matching Carrier inbox(es) this sweep.` : "",
          stale.length ? "\nOldest rescue candidates:\n" + stale.join("\n") : "",
          "\nThis alert is automatically deduplicated for 30 minutes.",
        ].filter(Boolean).join("\n"))
        .setFooter({ text: "The Carry Tavern • Operations Watchdog" })
        .setTimestamp()],
    }).catch(() => {});
    markAlert("queue-pressure", { waiting: snapshot.waiting, stale: snapshot.staleQueued });
    sent += 1;
  }

  if ((snapshot.orphanedSessions > 0 || snapshot.staleClaimed > 0 || snapshot.longRunning > 0) && alertAllowed("session-watchdog")) {
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0xf39c12)
        .setTitle("🧩 Watchdog • Session Attention")
        .setDescription([
          `**Orphaned/missing ticket references:** ${snapshot.orphanedSessions}`,
          `**Claimed but not started:** ${snapshot.staleClaimed}`,
          `**Long-running sessions:** ${snapshot.longRunning}`,
          "",
          "The bot repairs recoverable panels/voice sessions automatically; only unresolved state is surfaced here.",
        ].join("\n"))
        .setFooter({ text: "The Carry Tavern • Self-Healing Operations" })
        .setTimestamp()],
    }).catch(() => {});
    markAlert("session-watchdog", {
      orphaned: snapshot.orphanedSessions,
      staleClaimed: snapshot.staleClaimed,
      longRunning: snapshot.longRunning,
    });
    sent += 1;
  }

  return sent;
}

async function repairActiveSessions(guild, rows) {
  let repaired = 0;
  const ticketIds = [...new Set(rows
    .filter((row) => ["claimed", "in_progress"].includes(row.status) && row.ticket_channel_id)
    .map((row) => String(row.ticket_channel_id)))]
    .slice(0, 30);

  for (const ticketId of ticketIds) {
    const ticket = guild.channels.cache.get(ticketId) || await guild.channels.fetch(ticketId).catch(() => null);
    if (!ticket?.isTextBased?.()) continue;
    let touched = false;
    await ensureCarryControlCenter(ticket, { replace: true, ping: false })
      .then((message) => { if (message) touched = true; })
      .catch(() => {});
    await ensureSessionVoice(ticket)
      .then((voice) => { if (voice) touched = true; })
      .catch(() => {});
    if (touched) repaired += 1;
  }

  return repaired;
}

async function sweep(client) {
  if (sweepRunning || !process.env.GUILD_ID) return null;
  sweepRunning = true;
  try {
    const guild = client.guilds.cache.get(String(process.env.GUILD_ID))
      || await client.guilds.fetch(String(process.env.GUILD_ID));
    await guild.channels.fetch().catch(() => {});
    const snapshot = await buildSnapshot(guild);

    snapshot.rescuePingsLastSweep = await renotifyStaleCarries(client, guild, snapshot);

    if (Date.now() - lastRepairAt >= REPAIR_MS) {
      const repaired = await repairActiveSessions(guild, snapshot.rows);
      lastRepairAt = Date.now();
      snapshot.lastRepairAt = lastRepairAt;
      snapshot.repairedLastSweep = repaired;
    }

    cache.set(String(guild.id), snapshot);
    await sendRescueAlerts(guild, snapshot).catch((error) => {
      console.warn(`[OPS INTELLIGENCE] Alert delivery failed: ${error.message}`);
    });
    return snapshot;
  } catch (error) {
    console.warn(`[OPS INTELLIGENCE] Sweep failed: ${error.message}`);
    return null;
  } finally {
    sweepRunning = false;
  }
}

function startCarryOpsIntelligence(client) {
  if (timer) return;
  void sweep(client);
  timer = setInterval(() => void sweep(client), SWEEP_MS);
  timer.unref?.();
  console.log("🧠 Carry operations intelligence started: forecast, pulse, watchdog, auto-rescue and self-heal online.");
}

module.exports = {
  PULSE_BUTTON_ID,
  buildSnapshot,
  cachedSnapshot,
  formatAge,
  formatServiceMinutes,
  handlePulseInteraction,
  healthLabel,
  pressureFor,
  pulseComponents,
  pulseEmbed,
  startCarryOpsIntelligence,
  sweep,
};
