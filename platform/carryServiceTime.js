const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");

const START_ID = "carry_service_start";
const WINDOW_MS = 20 * 60 * 1000;
const RESPONSE_MS = 5 * 60 * 1000;
const STAFF_ROLES = ["moderator", "administrator", "owner"];
const ACTIVE_TIMER_STATES = ["running", "checkpoint"];

let monitorTimer = null;
let monitorRunning = false;

db.exec(`
  CREATE TABLE IF NOT EXISTS carry_service_sessions (
    ticket_channel TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    carrier TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'stopped',
    first_started_at INTEGER,
    segment_started_at INTEGER,
    credit_cap_at INTEGER,
    credited_seconds INTEGER NOT NULL DEFAULT 0,
    next_check_at INTEGER,
    check_deadline INTEGER,
    checkpoint_number INTEGER NOT NULL DEFAULT 0,
    stopped_at INTEGER,
    stopped_reason TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS carry_service_carrier_status_idx
    ON carry_service_sessions(carrier, status);

  CREATE TABLE IF NOT EXISTS carry_service_checkpoint_responses (
    ticket_channel TEXT NOT NULL,
    checkpoint_number INTEGER NOT NULL,
    request_id TEXT NOT NULL,
    requester TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    responded_at INTEGER,
    PRIMARY KEY(ticket_channel, checkpoint_number, request_id)
  );

  CREATE TABLE IF NOT EXISTS carry_service_history (
    ticket_channel TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    carrier TEXT NOT NULL,
    service_seconds INTEGER NOT NULL,
    service_minutes INTEGER NOT NULL,
    runs_completed INTEGER NOT NULL DEFAULT 0,
    request_count INTEGER NOT NULL DEFAULT 0,
    completed_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS carry_service_history_carrier_idx
    ON carry_service_history(guild, carrier, completed_at);
`);

function unixSeconds(ms) {
  return Math.floor(Number(ms || 0) / 1000);
}

function formatMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.floor(Number(totalMinutes) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours}h ${rest}m` : `${rest}m`;
}

function sessionRow(channelId) {
  return db.prepare("SELECT * FROM carry_service_sessions WHERE ticket_channel = ?")
    .get(String(channelId));
}

function creditedSecondsFor(row, now = Date.now()) {
  if (!row) return 0;
  let seconds = Math.max(0, Number(row.credited_seconds || 0));
  if (!row.segment_started_at || !ACTIVE_TIMER_STATES.includes(String(row.status))) {
    return Math.floor(seconds);
  }

  const start = Number(row.segment_started_at);
  const cap = Number(row.credit_cap_at || start);
  const end = Math.max(start, Math.min(Number(now), cap));
  seconds += Math.max(0, end - start) / 1000;
  return Math.floor(seconds);
}

function getServiceSnapshot(channelId, now = Date.now()) {
  const row = sessionRow(channelId);
  if (!row) {
    return {
      exists: false,
      status: "not_started",
      seconds: 0,
      minutes: 0,
      firstStartedAt: null,
      nextCheckAt: null,
      checkDeadline: null,
      stoppedReason: null,
    };
  }

  const seconds = creditedSecondsFor(row, now);
  return {
    exists: true,
    status: String(row.status || "stopped"),
    seconds,
    minutes: Math.floor(seconds / 60),
    firstStartedAt: row.first_started_at ? Number(row.first_started_at) : null,
    nextCheckAt: row.next_check_at ? Number(row.next_check_at) : null,
    checkDeadline: row.check_deadline ? Number(row.check_deadline) : null,
    stoppedAt: row.stopped_at ? Number(row.stopped_at) : null,
    stoppedReason: row.stopped_reason || null,
    carrier: row.carrier || null,
    checkpointNumber: Number(row.checkpoint_number || 0),
  };
}

async function loadActiveRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load carry timer requests: ${error.message}`);
  return data || [];
}

async function actorCanManage(interaction, requests) {
  if (requests.some((request) => request.carrier?.discord_id === interaction.user.id)) return true;
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) return false;
  return hasAnyPlatformRole(profile.id, STAFF_ROLES);
}

function readinessFor(requestId) {
  try {
    return db.prepare("SELECT status, responded_at FROM carry_ready_checks WHERE request_id = ?")
      .get(String(requestId));
  } catch {
    return null;
  }
}

function readinessProblem(requests, freshAfter = 0) {
  for (const request of requests) {
    const ready = readinessFor(request.id);
    if (!ready || ready.status !== "ready") {
      return `${request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "A requester"} has not confirmed **I'm Ready** yet.`;
    }
    if (freshAfter && Number(ready.responded_at || 0) <= Number(freshAfter)) {
      return "A fresh **Ready Check** is required before this stopped timer can resume.";
    }
  }
  return null;
}

async function refreshControlCenter(channel) {
  if (!channel?.isTextBased?.()) return;
  try {
    const { ensureCarryControlCenter } = require("./carryControlCenter");
    await ensureCarryControlCenter(channel, { replace: true, ping: false });
  } catch (error) {
    console.warn("[CARRY SERVICE] Could not refresh Control Center:", error.message);
  }
}

async function startCarryService(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const requests = await loadActiveRequests(interaction.channelId);
  if (!requests.length) {
    await interaction.editReply("❌ There are no active carry requests in this ticket.");
    return true;
  }
  if (!(await actorCanManage(interaction, requests))) {
    await interaction.editReply("❌ Only the assigned Carrier or staff can start carry time.");
    return true;
  }

  const carrierDiscordId = requests[0].carrier?.discord_id || interaction.user.id;
  const current = sessionRow(interaction.channelId);
  if (current && ACTIVE_TIMER_STATES.includes(String(current.status))) {
    const snapshot = getServiceSnapshot(interaction.channelId);
    await interaction.editReply(`⏱️ Carry time is already running. **${formatMinutes(snapshot.minutes)}** is currently creditable.`);
    return true;
  }

  const readinessError = readinessProblem(requests, current?.stopped_at || 0);
  if (readinessError) {
    await interaction.editReply(`❌ ${readinessError}\nRun **Ready Check** first, then start the carry after everyone confirms.`);
    return true;
  }

  const other = db.prepare(`
    SELECT ticket_channel
    FROM carry_service_sessions
    WHERE carrier = ?
      AND status IN ('running','checkpoint')
      AND ticket_channel <> ?
    LIMIT 1
  `).get(String(carrierDiscordId), String(interaction.channelId));
  if (other) {
    await interaction.editReply(`❌ You already have another timed carry active in <#${other.ticket_channel}>. Finish or stop that session first.`);
    return true;
  }

  const now = Date.now();
  const priorSeconds = Math.max(0, Number(current?.credited_seconds || 0));
  const firstStartedAt = Number(current?.first_started_at || now);
  const cap = now + WINDOW_MS;

  db.prepare(`
    INSERT INTO carry_service_sessions(
      ticket_channel,guild,carrier,status,first_started_at,segment_started_at,
      credit_cap_at,credited_seconds,next_check_at,check_deadline,
      checkpoint_number,stopped_at,stopped_reason,updated_at
    ) VALUES(?,?,?,'running',?,?,?,?,?,NULL,?,NULL,NULL,?)
    ON CONFLICT(ticket_channel) DO UPDATE SET
      guild=excluded.guild,
      carrier=excluded.carrier,
      status='running',
      first_started_at=COALESCE(carry_service_sessions.first_started_at, excluded.first_started_at),
      segment_started_at=excluded.segment_started_at,
      credit_cap_at=excluded.credit_cap_at,
      credited_seconds=carry_service_sessions.credited_seconds,
      next_check_at=excluded.next_check_at,
      check_deadline=NULL,
      stopped_at=NULL,
      stopped_reason=NULL,
      updated_at=excluded.updated_at
  `).run(
    String(interaction.channelId),
    String(interaction.guildId || process.env.GUILD_ID || ""),
    String(carrierDiscordId),
    firstStartedAt,
    now,
    cap,
    priorSeconds,
    cap,
    Number(current?.checkpoint_number || 0),
    now,
  );

  const stamp = new Date(now).toISOString();
  const supabase = getSupabase();
  const { error } = await supabase
    .from("carry_requests")
    .update({ status: "in_progress", started_at: stamp, updated_at: stamp })
    .eq("ticket_channel_id", String(interaction.channelId))
    .in("status", ["claimed", "in_progress"]);
  if (error) {
    stopServiceSession(interaction.channelId, `Could not mark carry in progress: ${error.message}`);
    throw new Error(`Could not start carry tracking: ${error.message}`);
  }

  await refreshControlCenter(interaction.channel);
  await interaction.editReply([
    "▶️ **Carry timer started.**",
    `The first **20 minutes** can be credited normally.`,
    `At <t:${unixSeconds(cap)}:t>, each requester will get a verification check and have **5 minutes** to confirm they are still being carried.`,
    "If a checkpoint is missed, credited time freezes automatically.",
  ].join("\n"));
  return true;
}

function freezeSession(channelId, reason, now = Date.now()) {
  const row = sessionRow(channelId);
  if (!row || !ACTIVE_TIMER_STATES.includes(String(row.status))) return getServiceSnapshot(channelId, now);
  const seconds = creditedSecondsFor(row, now);
  db.prepare(`
    UPDATE carry_service_sessions
    SET status='stopped', credited_seconds=?, segment_started_at=NULL,
        credit_cap_at=NULL, next_check_at=NULL, check_deadline=NULL,
        stopped_at=?, stopped_reason=?, updated_at=?
    WHERE ticket_channel=?
  `).run(seconds, Number(now), String(reason || "Timer stopped"), Number(now), String(channelId));
  return getServiceSnapshot(channelId, now);
}

function stopServiceSession(channelId, reason = "Carry stopped") {
  return freezeSession(channelId, reason, Date.now());
}

function checkpointEmbed(request, session) {
  const creditedMinutes = Math.floor(creditedSecondsFor(session, Number(session.credit_cap_at)) / 60);
  const deadline = Number(session.check_deadline);
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`⏱️ Carry Time Check • ${request.dungeon} • ${request.difficulty}`)
    .setDescription([
      `**Requester:** ${request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester"}`,
      `**Carrier:** ${request.carrier?.discord_id ? `<@${request.carrier.discord_id}>` : "Carrier"}`,
      "",
      `The Carrier has reached the next **20-minute service checkpoint**.`,
      `Current verified cap: **${formatMinutes(creditedMinutes)}**.`,
      `Please confirm you are still being carried by <t:${unixSeconds(deadline)}:t> (<t:${unixSeconds(deadline)}:R>).`,
      "",
      "If you say no or do not respond within 5 minutes, Carrier service credit freezes at the last verified checkpoint.",
    ].join("\n"))
    .setFooter({ text: `The Carry Tavern • Time Verification • Checkpoint ${session.checkpoint_number}` })
    .setTimestamp();
}

function checkpointButtons(requestId, number) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`carry_time_yes_${requestId}_${number}`)
        .setLabel("Still Being Carried")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`carry_time_no_${requestId}_${number}`)
        .setLabel("No / Finished")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

async function beginCheckpoint(client, row) {
  const current = sessionRow(row.ticket_channel);
  if (!current || current.status !== "running" || Number(current.next_check_at || 0) > Date.now()) return false;

  const requests = await loadActiveRequests(current.ticket_channel);
  if (!requests.length) {
    freezeSession(current.ticket_channel, "No active requests remained");
    return false;
  }

  const checkpointNumber = Number(current.checkpoint_number || 0) + 1;
  const deadline = Date.now() + RESPONSE_MS;
  db.prepare(`
    UPDATE carry_service_sessions
    SET status='checkpoint', checkpoint_number=?, check_deadline=?, updated_at=?
    WHERE ticket_channel=? AND status='running'
  `).run(checkpointNumber, deadline, Date.now(), String(current.ticket_channel));

  const session = sessionRow(current.ticket_channel);
  const channel = await client.channels.fetch(String(current.ticket_channel)).catch(() => null);
  if (!channel?.isTextBased?.()) {
    freezeSession(current.ticket_channel, "Ticket channel unavailable at checkpoint");
    return false;
  }

  let missingRequester = false;
  for (const request of requests) {
    const requesterId = request.requester?.discord_id;
    if (!requesterId) {
      missingRequester = true;
      continue;
    }

    const message = await channel.send({
      content: `<@${requesterId}>`,
      embeds: [checkpointEmbed(request, session)],
      components: checkpointButtons(request.id, checkpointNumber),
      allowedMentions: { users: [String(requesterId)] },
    }).catch((error) => {
      console.warn(`[CARRY SERVICE] Could not send checkpoint for ${request.id}:`, error.message);
      return null;
    });

    if (!message) {
      missingRequester = true;
      continue;
    }

    db.prepare(`
      INSERT INTO carry_service_checkpoint_responses(
        ticket_channel,checkpoint_number,request_id,requester,status,message_id,responded_at
      ) VALUES(?,?,?,?, 'pending', ?, NULL)
      ON CONFLICT(ticket_channel,checkpoint_number,request_id) DO UPDATE SET
        requester=excluded.requester,status='pending',message_id=excluded.message_id,responded_at=NULL
    `).run(
      String(current.ticket_channel),
      checkpointNumber,
      String(request.id),
      String(requesterId),
      String(message.id),
    );

    try {
      const user = await client.users.fetch(String(requesterId));
      await user.send(`⏱️ **Carry time verification needed.**\nConfirm in <#${current.ticket_channel}> within **5 minutes** so your Carrier's verified service time can continue.`);
    } catch {}
  }

  if (missingRequester) {
    freezeSession(current.ticket_channel, "A requester could not be verified at checkpoint");
    await channel.send("⏸️ **Service time frozen.** A requester could not be verified at the checkpoint. Run a fresh Ready Check before resuming.").catch(() => {});
  }

  await refreshControlCenter(channel);
  return true;
}

async function continueAfterCheckpoint(channelId, checkpointNumber) {
  const responses = db.prepare(`
    SELECT status FROM carry_service_checkpoint_responses
    WHERE ticket_channel=? AND checkpoint_number=?
  `).all(String(channelId), Number(checkpointNumber));
  if (!responses.length || responses.some((row) => row.status !== "yes")) return false;

  const row = sessionRow(channelId);
  if (!row || row.status !== "checkpoint" || Number(row.checkpoint_number) !== Number(checkpointNumber)) return false;

  const previousCap = Number(row.credit_cap_at || Date.now());
  const seconds = creditedSecondsFor(row, previousCap);
  const nextCap = previousCap + WINDOW_MS;
  db.prepare(`
    UPDATE carry_service_sessions
    SET status='running', credited_seconds=?, segment_started_at=?, credit_cap_at=?,
        next_check_at=?, check_deadline=NULL, stopped_at=NULL, stopped_reason=NULL, updated_at=?
    WHERE ticket_channel=?
  `).run(seconds, previousCap, nextCap, nextCap, Date.now(), String(channelId));
  return true;
}

async function handleCheckpointResponse(interaction, requestId, checkpointNumber, answer) {
  const response = db.prepare(`
    SELECT * FROM carry_service_checkpoint_responses
    WHERE ticket_channel=? AND checkpoint_number=? AND request_id=?
  `).get(String(interaction.channelId), Number(checkpointNumber), String(requestId));

  if (!response || response.status !== "pending") {
    await interaction.reply({ content: "ℹ️ This time checkpoint is no longer waiting for your response.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (String(response.requester) !== String(interaction.user.id)) {
    await interaction.reply({ content: "❌ Only the requester for this carry can answer this time check.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const session = sessionRow(interaction.channelId);
  if (!session || session.status !== "checkpoint" || Number(session.checkpoint_number) !== Number(checkpointNumber)) {
    await interaction.reply({ content: "ℹ️ This service checkpoint has already ended.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const now = Date.now();
  if (now > Number(session.check_deadline || 0)) {
    const frozen = freezeSession(interaction.channelId, "Checkpoint response deadline expired", Number(session.credit_cap_at || now));
    await interaction.update({
      content: `<@${interaction.user.id}>`,
      embeds: [new EmbedBuilder().setColor(0xdc2626).setTitle("⏸️ Service Time Frozen").setDescription(`The 5-minute verification window expired. Credited time is frozen at **${formatMinutes(frozen.minutes)}**.`)],
      components: [],
      allowedMentions: { users: [String(interaction.user.id)] },
    });
    await refreshControlCenter(interaction.channel);
    return true;
  }

  db.prepare(`
    UPDATE carry_service_checkpoint_responses
    SET status=?, responded_at=?
    WHERE ticket_channel=? AND checkpoint_number=? AND request_id=?
  `).run(answer === "yes" ? "yes" : "no", now, String(interaction.channelId), Number(checkpointNumber), String(requestId));

  if (answer !== "yes") {
    const frozen = freezeSession(interaction.channelId, "Requester ended service at checkpoint", Number(session.credit_cap_at));
    await interaction.update({
      content: `<@${interaction.user.id}>`,
      embeds: [new EmbedBuilder().setColor(0x64748b).setTitle("⏸️ Service Time Stopped").setDescription(`You confirmed the carry is no longer continuing. Carrier credit is frozen at **${formatMinutes(frozen.minutes)}**.`)],
      components: [],
      allowedMentions: { users: [String(interaction.user.id)] },
    });
    await refreshControlCenter(interaction.channel);
    return true;
  }

  const continued = await continueAfterCheckpoint(interaction.channelId, checkpointNumber);
  const next = getServiceSnapshot(interaction.channelId);
  await interaction.update({
    content: `<@${interaction.user.id}>`,
    embeds: [new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle("✅ Carry Time Confirmed")
      .setDescription(continued
        ? `All requesters confirmed. Service time can continue for another **20 minutes** before the next verification.`
        : "Your confirmation was recorded. Waiting for the other requester(s) in this carry."),
    ],
    components: [],
    allowedMentions: { users: [String(interaction.user.id)] },
  });
  if (continued && next.nextCheckAt) {
    await interaction.channel.send(`⏱️ Time verification passed. Next checkpoint: <t:${unixSeconds(next.nextCheckAt)}:R>.`).catch(() => {});
  }
  await refreshControlCenter(interaction.channel);
  return true;
}

async function sweepServiceSessions(client) {
  if (monitorRunning) return;
  monitorRunning = true;
  try {
    const now = Date.now();
    const due = db.prepare(`
      SELECT * FROM carry_service_sessions
      WHERE status='running' AND next_check_at IS NOT NULL AND next_check_at <= ?
    `).all(now);
    for (const row of due) {
      await beginCheckpoint(client, row).catch((error) => {
        console.error(`[CARRY SERVICE] Checkpoint failed for ${row.ticket_channel}:`, error);
        freezeSession(row.ticket_channel, `Checkpoint error: ${error.message}`);
      });
    }

    const expired = db.prepare(`
      SELECT * FROM carry_service_sessions
      WHERE status='checkpoint' AND check_deadline IS NOT NULL AND check_deadline <= ?
    `).all(now);
    for (const row of expired) {
      const pending = db.prepare(`
        SELECT COUNT(*) AS count
        FROM carry_service_checkpoint_responses
        WHERE ticket_channel=? AND checkpoint_number=? AND status='pending'
      `).get(String(row.ticket_channel), Number(row.checkpoint_number));
      if (Number(pending?.count || 0) <= 0) continue;
      const frozen = freezeSession(row.ticket_channel, "Requester did not confirm the service checkpoint", Number(row.credit_cap_at || now));
      const channel = await client.channels.fetch(String(row.ticket_channel)).catch(() => null);
      if (channel?.isTextBased?.()) {
        await channel.send(`⏸️ **Service time frozen at ${formatMinutes(frozen.minutes)}.** A requester missed the 5-minute verification window. Run a fresh Ready Check before resuming.`).catch(() => {});
        await refreshControlCenter(channel);
      }
    }
  } finally {
    monitorRunning = false;
  }
}

function startCarryServiceMonitor(client) {
  if (monitorTimer) return;
  void sweepServiceSessions(client);
  monitorTimer = setInterval(() => void sweepServiceSessions(client), 15_000);
  monitorTimer.unref?.();
  console.log("✅ Verified carry service-time monitor started.");
}

function finishServiceSession(channelId, { guildId, carrierId, runsCompleted = 0, requestCount = 0 } = {}) {
  const existingHistory = db.prepare("SELECT * FROM carry_service_history WHERE ticket_channel = ?")
    .get(String(channelId));
  if (existingHistory) return existingHistory;

  const row = sessionRow(channelId);
  if (!row) throw new Error("Start Carry before completing the session so service time can be verified.");

  const seconds = creditedSecondsFor(row, Date.now());
  const minutes = Math.floor(seconds / 60);
  const completedAt = Date.now();
  db.prepare(`
    INSERT INTO carry_service_history(
      ticket_channel,guild,carrier,service_seconds,service_minutes,runs_completed,request_count,completed_at
    ) VALUES(?,?,?,?,?,?,?,?)
  `).run(
    String(channelId),
    String(guildId || row.guild || ""),
    String(carrierId || row.carrier || ""),
    seconds,
    minutes,
    Math.max(0, Number(runsCompleted || 0)),
    Math.max(0, Number(requestCount || 0)),
    completedAt,
  );

  db.prepare(`
    UPDATE carry_service_sessions
    SET status='completed', credited_seconds=?, segment_started_at=NULL,
        credit_cap_at=NULL,next_check_at=NULL,check_deadline=NULL,
        stopped_at=?,stopped_reason='Session completed',updated_at=?
    WHERE ticket_channel=?
  `).run(seconds, completedAt, completedAt, String(channelId));

  return db.prepare("SELECT * FROM carry_service_history WHERE ticket_channel = ?")
    .get(String(channelId));
}

function verifiedServiceBoard(guildId, sinceMs = 0, limit = 10) {
  return db.prepare(`
    SELECT carrier,
           SUM(service_seconds) AS service_seconds,
           SUM(service_minutes) AS service_minutes,
           SUM(runs_completed) AS runs_completed,
           SUM(request_count) AS request_count,
           COUNT(*) AS sessions
    FROM carry_service_history
    WHERE guild=? AND completed_at>=?
    GROUP BY carrier
    ORDER BY service_seconds DESC
    LIMIT ?
  `).all(String(guildId), Math.max(0, Number(sinceMs || 0)), Math.max(1, Number(limit || 10)));
}

async function handleCarryServiceInteraction(interaction) {
  if (!interaction.isButton()) return false;
  if (interaction.customId === START_ID) return startCarryService(interaction);

  let match = /^carry_time_yes_([0-9a-f-]{36})_(\d+)$/i.exec(interaction.customId || "");
  if (match) return handleCheckpointResponse(interaction, match[1], Number(match[2]), "yes");

  match = /^carry_time_no_([0-9a-f-]{36})_(\d+)$/i.exec(interaction.customId || "");
  if (match) return handleCheckpointResponse(interaction, match[1], Number(match[2]), "no");

  return false;
}

module.exports = {
  RESPONSE_MS,
  START_ID,
  WINDOW_MS,
  finishServiceSession,
  formatMinutes,
  getServiceSnapshot,
  handleCarryServiceInteraction,
  startCarryServiceMonitor,
  stopServiceSession,
  verifiedServiceBoard,
};
