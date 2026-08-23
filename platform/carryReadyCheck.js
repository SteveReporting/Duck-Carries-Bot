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
const { maybeSendAbuseAlert, recordNoShow } = require("./communitySystems");

const READY_CHECK_MS = 15 * 60 * 1000;
const PANEL_ID = "carry_readycheck_start";
const STAFF_PLATFORM_ROLES = ["moderator", "administrator", "owner"];

db.exec(`
  CREATE TABLE IF NOT EXISTS carry_ready_checks (
    request_id TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    ticket_channel TEXT NOT NULL,
    requester TEXT NOT NULL,
    carrier TEXT NOT NULL,
    deadline INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    created_at INTEGER NOT NULL,
    responded_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS carry_ready_panels (
    ticket_channel TEXT PRIMARY KEY,
    message_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unixSeconds(ms) {
  return Math.floor(Number(ms) / 1000);
}

function requesterName(request) {
  return request.requester?.roblox_username ||
    request.requester?.discord_display_name ||
    request.requester?.discord_username ||
    "Requester";
}

async function loadTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,status,claimed_at,started_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadRequest(requestId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,status,claimed_at,started_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

function panelEmbed() {
  return new EmbedBuilder()
    .setColor(0xc89532)
    .setTitle("📣 Ready Check")
    .setDescription([
      "When you are ready to start the carry, press **Start Ready Check**.",
      "",
      "The bot will ping each requester in this ticket and give them **15 minutes** to respond.",
      "They can choose **I'm Ready** or **Can't Join**. If they do not respond by the deadline, the Carrier can record a no-show from the ready-check message.",
    ].join("\n"))
    .setFooter({ text: "The Carry Tavern • Ready Check" });
}

function panelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(PANEL_ID)
        .setLabel("Start Ready Check")
        .setEmoji("📣")
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function readyCheckComponents(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`carry_ready_yes_${requestId}`)
        .setLabel("I'm Ready")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`carry_ready_no_${requestId}`)
        .setLabel("Can't Join")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`carry_ready_missed_${requestId}`)
        .setLabel("No Response")
        .setEmoji("🚫")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

function readyCheckEmbed(request, carrierDiscordId, deadline) {
  const deadlineUnix = unixSeconds(deadline);
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle(`📣 Ready Check • ${request.dungeon} • ${request.difficulty}`)
    .setDescription([
      `**Requester:** ${request.requester?.discord_id ? `<@${request.requester.discord_id}>` : requesterName(request)}`,
      `**Carrier:** <@${carrierDiscordId}>`,
      "",
      "Your Carrier is ready to start.",
      `Please respond by **<t:${deadlineUnix}:t>** (<t:${deadlineUnix}:R>).`,
      "",
      "If there is no response by the deadline, the Carrier can press **No Response** and the no-show will be added to staff history.",
    ].join("\n"))
    .setFooter({ text: `Request ${request.id}` })
    .setTimestamp();
}

function responseEmbed(request, carrierDiscordId, status, late) {
  const ready = status === "ready";
  return new EmbedBuilder()
    .setColor(ready ? 0x22c55e : 0x64748b)
    .setTitle(ready ? "✅ Requester Ready" : "❌ Requester Can't Join")
    .setDescription([
      `**Requester:** ${request.requester?.discord_id ? `<@${request.requester.discord_id}>` : requesterName(request)}`,
      `**Carrier:** <@${carrierDiscordId}>`,
      `**Dungeon:** **${request.dungeon} • ${request.difficulty}**`,
      "",
      ready
        ? "The requester confirmed they are ready to start the carry."
        : "The requester said they cannot join right now. The Carrier can release the claim to return it to the queue.",
      late ? "⚠️ This response arrived after the original ready-check deadline." : null,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: `Request ${request.id}` })
    .setTimestamp();
}

async function isStaff(interaction) {
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) return false;
  return hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES);
}

async function actorCanManage(interaction, requests) {
  if (requests.some((request) => request.carrier?.discord_id === interaction.user.id)) return true;
  return isStaff(interaction);
}

async function ensureReadyCheckPanel(channel, { retries = 0, retryDelay = 1500 } = {}) {
  if (!channel?.isTextBased?.() || !String(channel.name || "").startsWith("carry-")) return null;

  let requests = [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    requests = await loadTicketRequests(channel.id).catch(() => []);
    if (requests.length) break;
    if (attempt < retries) await sleep(retryDelay);
  }
  if (!requests.length) return null;

  const existing = db.prepare("SELECT message_id FROM carry_ready_panels WHERE ticket_channel = ?").get(String(channel.id));
  if (existing?.message_id) {
    const message = await channel.messages.fetch(existing.message_id).catch(() => null);
    if (message) return message;
    db.prepare("DELETE FROM carry_ready_panels WHERE ticket_channel = ?").run(String(channel.id));
  }

  const message = await channel.send({
    embeds: [panelEmbed()],
    components: panelComponents(),
  });

  db.prepare(`
    INSERT INTO carry_ready_panels(ticket_channel,message_id,created_at)
    VALUES(?,?,?)
    ON CONFLICT(ticket_channel) DO UPDATE SET
      message_id=excluded.message_id,
      created_at=excluded.created_at
  `).run(String(channel.id), String(message.id), Date.now());

  return message;
}

async function ensureReadyCheckPanelsForClient(client) {
  if (!process.env.GUILD_ID) return 0;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("ticket_channel_id")
    .in("status", ["claimed", "in_progress"])
    .not("ticket_channel_id", "is", null);
  if (error) throw new Error(error.message);

  const ids = [...new Set((data || []).map((row) => row.ticket_channel_id).filter(Boolean))];
  let added = 0;
  for (const id of ids) {
    const channel = await client.channels.fetch(String(id)).catch(() => null);
    if (!channel?.isTextBased?.()) continue;
    const before = db.prepare("SELECT message_id FROM carry_ready_panels WHERE ticket_channel = ?").get(String(id));
    const message = await ensureReadyCheckPanel(channel).catch(() => null);
    if (message && !before) added += 1;
  }
  return added;
}

async function startReadyCheck(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const requests = await loadTicketRequests(interaction.channelId);
  if (!requests.length) {
    await interaction.editReply("❌ There are no active carry requests attached to this ticket.");
    return true;
  }

  if (!(await actorCanManage(interaction, requests))) {
    await interaction.editReply("❌ Only the assigned Carrier or staff can start a ready check.");
    return true;
  }

  let started = 0;
  let alreadyActive = 0;
  let unavailable = 0;

  for (const request of requests) {
    const requesterDiscordId = request.requester?.discord_id;
    const carrierDiscordId = request.carrier?.discord_id || interaction.user.id;
    if (!requesterDiscordId) {
      unavailable += 1;
      continue;
    }

    const current = db.prepare("SELECT * FROM carry_ready_checks WHERE request_id = ?").get(String(request.id));
    if (current?.status === "pending") {
      alreadyActive += 1;
      continue;
    }

    const deadline = Date.now() + READY_CHECK_MS;
    const message = await interaction.channel.send({
      content: `<@${requesterDiscordId}>`,
      embeds: [readyCheckEmbed(request, carrierDiscordId, deadline)],
      components: readyCheckComponents(request.id),
      allowedMentions: { users: [String(requesterDiscordId)] },
    });

    db.prepare(`
      INSERT INTO carry_ready_checks(
        request_id,guild,ticket_channel,requester,carrier,deadline,status,message_id,created_at,responded_at
      ) VALUES(?,?,?,?,?,?,'pending',?,?,NULL)
      ON CONFLICT(request_id) DO UPDATE SET
        guild=excluded.guild,
        ticket_channel=excluded.ticket_channel,
        requester=excluded.requester,
        carrier=excluded.carrier,
        deadline=excluded.deadline,
        status='pending',
        message_id=excluded.message_id,
        created_at=excluded.created_at,
        responded_at=NULL
    `).run(
      String(request.id),
      String(interaction.guildId || process.env.GUILD_ID || ""),
      String(interaction.channelId),
      String(requesterDiscordId),
      String(carrierDiscordId),
      deadline,
      String(message.id),
      Date.now(),
    );

    try {
      const requester = await interaction.client.users.fetch(String(requesterDiscordId));
      const deadlineUnix = unixSeconds(deadline);
      await requester.send([
        `📣 **Your Carrier is ready for ${request.dungeon} • ${request.difficulty}.**`,
        `Carrier: <@${carrierDiscordId}>`,
        `Please respond in <#${interaction.channelId}> by <t:${deadlineUnix}:t> (<t:${deadlineUnix}:R>).`,
      ].join("\n"));
    } catch {}

    started += 1;
  }

  const lines = [
    started ? `✅ Started **${started}** ready check${started === 1 ? "" : "s"}.` : null,
    alreadyActive ? `📣 **${alreadyActive}** request${alreadyActive === 1 ? " already has" : "s already have"} an active ready check.` : null,
    unavailable ? `⚠️ **${unavailable}** requester${unavailable === 1 ? " has" : "s have"} no linked Discord account.` : null,
  ].filter(Boolean);

  await interaction.editReply(lines.join("\n") || "🍺 Nothing needed a new ready check.");
  return true;
}

async function handleRequesterResponse(interaction, requestId, response) {
  const check = db.prepare("SELECT * FROM carry_ready_checks WHERE request_id = ?").get(String(requestId));
  if (!check || check.ticket_channel !== String(interaction.channelId)) {
    await interaction.reply({ content: "❌ This ready check is no longer active in this ticket.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (String(check.requester) !== String(interaction.user.id)) {
    await interaction.reply({ content: "❌ Only the requester for this carry can answer this ready check.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (check.status !== "pending") {
    await interaction.reply({ content: "ℹ️ This ready check has already been answered.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const request = await loadRequest(requestId);
  if (!request || request.ticket_channel_id !== interaction.channelId) {
    await interaction.reply({ content: "❌ This carry request is no longer active in this ticket.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const now = Date.now();
  const late = now > Number(check.deadline);
  const nextStatus = response === "ready" ? "ready" : "unavailable";
  db.prepare("UPDATE carry_ready_checks SET status = ?, responded_at = ? WHERE request_id = ?")
    .run(nextStatus, now, String(requestId));

  if (response === "ready" && request.status === "claimed") {
    const stamp = new Date().toISOString();
    const supabase = getSupabase();
    const { error } = await supabase
      .from("carry_requests")
      .update({ status: "in_progress", started_at: stamp, updated_at: stamp })
      .eq("id", request.id)
      .eq("status", "claimed");
    if (error) console.warn("[READY CHECK] Could not mark carry in progress:", error.message);
  }

  await interaction.update({
    content: `<@${check.requester}>`,
    embeds: [responseEmbed(request, check.carrier, nextStatus, late)],
    components: [],
    allowedMentions: { users: [String(check.requester)] },
  });

  return true;
}

async function handleMissedResponse(interaction, requestId) {
  const check = db.prepare("SELECT * FROM carry_ready_checks WHERE request_id = ?").get(String(requestId));
  if (!check || check.ticket_channel !== String(interaction.channelId)) {
    await interaction.reply({ content: "❌ This ready check is no longer active in this ticket.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (check.status !== "pending") {
    await interaction.reply({ content: "ℹ️ This ready check has already been resolved.", flags: MessageFlags.Ephemeral });
    return true;
  }

  const request = await loadRequest(requestId);
  if (!request || request.ticket_channel_id !== interaction.channelId || !["claimed", "in_progress"].includes(request.status)) {
    await interaction.reply({ content: "❌ This carry request is no longer active in this ticket.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!(await actorCanManage(interaction, [request]))) {
    await interaction.reply({ content: "❌ Only the assigned Carrier or staff can record a missed ready check.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (Date.now() < Number(check.deadline)) {
    const deadlineUnix = unixSeconds(check.deadline);
    await interaction.reply({
      content: `⏳ Give the requester until <t:${deadlineUnix}:t> (<t:${deadlineUnix}:R>) to respond.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  recordNoShow({
    guildId: interaction.guildId || check.guild,
    requestId: request.id,
    offenderId: check.requester,
    reporterId: interaction.user.id,
    offenderSide: "requester",
    reason: `No response to 15-minute ready check in ticket ${interaction.channelId}.`,
  });

  db.prepare("UPDATE carry_ready_checks SET status = 'no_show', responded_at = ? WHERE request_id = ?")
    .run(Date.now(), String(requestId));

  await maybeSendAbuseAlert(
    interaction.client,
    interaction.guildId || check.guild,
    check.requester,
    `missed carry ready check ${request.id}`,
  ).catch(() => {});

  const missedEmbed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("🚫 Ready Check Missed")
    .setDescription([
      `**Requester:** <@${check.requester}>`,
      `**Carrier:** <@${check.carrier}>`,
      `**Dungeon:** **${request.dungeon} • ${request.difficulty}**`,
      "",
      "The requester did not respond before the 15-minute deadline.",
      "A no-show has been added to staff history. The Carrier can now use **Release Claim** if the request should return to the queue.",
    ].join("\n"))
    .setFooter({ text: `Request ${request.id}` })
    .setTimestamp();

  await interaction.message.edit({
    content: `<@${check.requester}>`,
    embeds: [missedEmbed],
    components: [],
    allowedMentions: { users: [String(check.requester)] },
  }).catch(() => {});

  if (process.env.MOD_LOG_CHANNEL_ID) {
    const logChannel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
    if (logChannel?.isTextBased?.()) {
      await logChannel.send([
        "🚫 **Carry Ready Check Missed**",
        `Request: \`${request.id}\``,
        `Ticket: <#${interaction.channelId}>`,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Carrier: <@${check.carrier}>`,
        `No-show: <@${check.requester}> (requester)`,
        "Reason: no response within 15 minutes of the Carrier ready check.",
      ].join("\n")).catch(() => {});
    }
  }

  await interaction.reply({
    content: `✅ No-show recorded for <@${check.requester}>. Use **Release Claim** if you want the request returned to the queue.`,
    flags: MessageFlags.Ephemeral,
  });
  return true;
}

async function handleReadyCheckInteraction(interaction) {
  if (!interaction.isButton()) return false;

  if (interaction.customId === PANEL_ID) return startReadyCheck(interaction);

  let match = /^carry_ready_yes_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleRequesterResponse(interaction, match[1], "ready");

  match = /^carry_ready_no_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleRequesterResponse(interaction, match[1], "unavailable");

  match = /^carry_ready_missed_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleMissedResponse(interaction, match[1]);

  return false;
}

module.exports = {
  ensureReadyCheckPanel,
  ensureReadyCheckPanelsForClient,
  handleReadyCheckInteraction,
};
