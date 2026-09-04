const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getGuildConfig, listConfiguredGuilds, saveGuildConfig } = require("./guildConfig");

const CHANNEL_NAME = "⚔️・active-carries";
const HEADER_FOOTER = "The Carry Tavern • Active Carries";
const CARD_FOOTER_PREFIX = "The Carry Tavern • Live Carry • ";
const MANAGE_PREFIX = "active_carry_manage:";
const RUN_PREFIX = "active_carry_run:";
const REFRESH_MS = 20_000;
const MAX_MUTATIONS_PER_PASS = 30;
const timers = new Map();
const locks = new Set();

db.exec(`
  CREATE TABLE IF NOT EXISTS active_carry_cards (
    ticket_channel TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    payload_hash TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS active_carry_run_progress (
    ticket_channel TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    runs_done INTEGER NOT NULL DEFAULT 0,
    target_runs INTEGER NOT NULL DEFAULT 1,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS active_carry_cards_guild_idx
    ON active_carry_cards(guild, updated_at);
`);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function publicReadOnlyOverwrites(guild, botId) {
  return [
    {
      id: guild.roles.everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    },
    {
      id: botId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageMessages,
      ],
    },
  ];
}

async function ensureActiveCarriesChannel(guild) {
  let config = getGuildConfig(guild.id);
  if (config?.active_carries_channel_id) {
    const configured = guild.channels.cache.get(String(config.active_carries_channel_id))
      || await guild.channels.fetch(String(config.active_carries_channel_id)).catch(() => null);
    if (configured?.type === ChannelType.GuildText) return configured;
  }

  await guild.channels.fetch();
  let channel = guild.channels.cache.find((item) =>
    item.type === ChannelType.GuildText && normalize(item.name) === normalize(CHANNEL_NAME),
  ) || null;

  let parent = null;
  const queueId = config?.queue_channel_id;
  if (queueId) {
    const queue = guild.channels.cache.get(String(queueId)) || await guild.channels.fetch(String(queueId)).catch(() => null);
    if (queue?.parent?.type === ChannelType.GuildCategory) parent = queue.parent;
  }
  if (!parent) {
    parent = guild.channels.cache.find((item) =>
      item.type === ChannelType.GuildCategory && normalize(item.name) === "carries",
    ) || null;
  }

  if (!channel) {
    channel = await guild.channels.create({
      name: CHANNEL_NAME,
      type: ChannelType.GuildText,
      parent: parent?.id || null,
      topic: "Live carry sessions appear here automatically. Join/leave from the card; private session details stay private.",
      permissionOverwrites: publicReadOnlyOverwrites(guild, guild.client.user.id),
      reason: "Live Carry Tavern session feed",
    });
  } else {
    if (channel.name !== CHANNEL_NAME) await channel.setName(CHANNEL_NAME, "Standardize active carry feed").catch(() => {});
    if (parent && channel.parentId !== parent.id) {
      await channel.setParent(parent.id, { lockPermissions: false, reason: "Move active carries into Carry area" }).catch(() => {});
    }
  }

  for (const overwrite of publicReadOnlyOverwrites(guild, guild.client.user.id)) {
    const permissions = {};
    for (const permission of overwrite.allow || []) permissions[permission] = true;
    for (const permission of overwrite.deny || []) permissions[permission] = false;
    await channel.permissionOverwrites.edit(overwrite.id, permissions, { reason: "Keep active carry feed clean" }).catch(() => {});
  }

  // Older guild_config schemas ignore unknown patch keys, but keeping this call
  // means newer schemas can persist the channel automatically while name-based
  // discovery still prevents duplicates on older installs.
  saveGuildConfig(guild.id, { active_carries_channel_id: channel.id });
  return channel;
}

async function loadActiveSessions() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,started_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("status", "in_progress")
    .not("ticket_channel_id", "is", null)
    .order("started_at", { ascending: true })
    .limit(5000);
  if (error) throw new Error(`Could not load active carries: ${error.message}`);

  const groups = new Map();
  for (const row of data || []) {
    const ticketId = String(row.ticket_channel_id || "");
    if (!ticketId) continue;
    const group = groups.get(ticketId) || {
      ticketId,
      dungeon: row.dungeon,
      difficulty: row.difficulty,
      carrier: row.carrier || null,
      startedAt: row.started_at || null,
      requests: [],
    };
    group.requests.push(row);
    if (!group.startedAt && row.started_at) group.startedAt = row.started_at;
    groups.set(ticketId, group);
  }

  return [...groups.values()];
}

function sessionVoice(ticketId) {
  try {
    return db.prepare(`
      SELECT * FROM carry_voice_sessions
      WHERE ticket_channel=? AND status IN ('claimed','started')
    `).get(String(ticketId)) || null;
  } catch {
    return null;
  }
}

function sessionBelongsToGuild(session, guildId) {
  const voice = sessionVoice(session.ticketId);
  return Boolean(voice && String(voice.guild) === String(guildId));
}

function dropInRows(ticketId) {
  try {
    return db.prepare(`
      SELECT * FROM carry_voice_dropins
      WHERE ticket_channel=? AND status='active'
      ORDER BY joined_at ASC
    `).all(String(ticketId));
  } catch {
    return [];
  }
}

function relative(value) {
  const stamp = new Date(value || 0).getTime();
  return Number.isFinite(stamp) && stamp > 0 ? `<t:${Math.floor(stamp / 1000)}:R>` : "just now";
}

function displayName(profile, fallback = "Unknown") {
  return String(
    profile?.roblox_username
      || profile?.discord_display_name
      || profile?.discord_username
      || fallback,
  ).slice(0, 60);
}

function mention(profile) {
  return profile?.discord_id ? `<@${profile.discord_id}>` : displayName(profile);
}

function requestProgress(row) {
  const completed = Math.max(0, Number(row.runs_completed || 0));
  const total = Math.max(completed, Number(row.runs_requested || 0));
  const planned = Math.max(0, Number(row.session_runs || 0));
  return `${mention(row.requester)} — **${completed}/${total}**${planned ? ` • ${planned} this session` : ""}`;
}

function sessionSummary(session) {
  const completed = session.requests.reduce((sum, row) => sum + Math.max(0, Number(row.runs_completed || 0)), 0);
  const total = session.requests.reduce((sum, row) => sum + Math.max(0, Number(row.runs_requested || 0)), 0);
  const planned = Math.max(1, ...session.requests.map((row) => Number(row.session_runs || 0)));
  return { completed, total, planned };
}

function liveRunProgress(session, guildId) {
  const target = sessionSummary(session).planned;
  let row = db.prepare("SELECT * FROM active_carry_run_progress WHERE ticket_channel=?")
    .get(String(session.ticketId));
  if (!row) {
    db.prepare(`
      INSERT INTO active_carry_run_progress(ticket_channel,guild,runs_done,target_runs,updated_at)
      VALUES(?,?,0,?,?)
    `).run(String(session.ticketId), String(guildId), target, Date.now());
    row = { runs_done: 0, target_runs: target };
  } else if (Number(row.target_runs || 0) !== target) {
    db.prepare("UPDATE active_carry_run_progress SET target_runs=?,updated_at=? WHERE ticket_channel=?")
      .run(target, Date.now(), String(session.ticketId));
    row = { ...row, target_runs: target };
  }
  return {
    done: Math.max(0, Number(row.runs_done || 0)),
    target: Math.max(1, Number(row.target_runs || target || 1)),
  };
}

function cardPayload(guild, session) {
  const voice = sessionVoice(session.ticketId);
  const dropins = dropInRows(session.ticketId);
  const summary = sessionSummary(session);
  const live = liveRunProgress(session, guild.id);
  const requesterIds = [...new Set(session.requests.map((row) => row.requester?.discord_id).filter(Boolean).map(String))];
  const participantIds = [...new Set([...requesterIds, ...dropins.map((row) => String(row.user))])];
  const progress = session.requests.slice(0, 8).map(requestProgress);
  if (session.requests.length > 8) progress.push(`… +${session.requests.length - 8} more requester${session.requests.length - 8 === 1 ? "" : "s"}`);

  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`⚔️ ${session.dungeon || "Carry"} • ${session.difficulty || ""}`.trim())
    .setDescription([
      `**Carrier:** ${mention(session.carrier)}`,
      `**Status:** 🟢 **LIVE** • started ${relative(session.startedAt)}`,
      `**Live run progress:** **${Math.min(live.done, live.target)}/${live.target}**`,
      `**Request progress:** **${summary.completed}/${summary.total}** requester-runs recorded`,
      `**Requesters:** **${session.requests.length}** • **Live participants:** **${participantIds.length}**`,
      voice?.voice_channel ? `**Voice:** <#${voice.voice_channel}> • optional` : "**Voice:** preparing…",
      "",
      progress.length ? progress.join("\n") : "No requester progress available.",
    ].join("\n").slice(0, 4000))
    .setFooter({ text: `${CARD_FOOTER_PREFIX}${session.ticketId}` });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RUN_PREFIX}${session.ticketId}`)
      .setLabel("End Run +1")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success)
      .setDisabled(live.done >= live.target),
    new ButtonBuilder()
      .setCustomId("carry_dropin_open")
      .setLabel("Join Carry")
      .setEmoji("🎮")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`carry_dropin_leave_${session.ticketId}`)
      .setLabel("Leave")
      .setEmoji("🚪")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${MANAGE_PREFIX}${session.ticketId}`)
      .setLabel("Controls")
      .setEmoji("⚙️")
      .setStyle(ButtonStyle.Secondary),
  );

  if (voice?.voice_channel) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("Voice")
        .setEmoji("🔊")
        .setStyle(ButtonStyle.Link)
        .setURL(`https://discord.com/channels/${guild.id}/${voice.voice_channel}`),
    );
  }

  return { embeds: [embed], components: [row] };
}

function payloadHash(payload) {
  return JSON.stringify(payload.embeds?.map((embed) => embed.toJSON()) || [])
    + JSON.stringify(payload.components?.map((row) => row.toJSON()) || []);
}

async function ensureHeader(channel, activeCount) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  let header = recent?.find((message) =>
    message.author?.id === channel.client.user.id
    && message.embeds?.some((embed) => String(embed.footer?.text || "") === HEADER_FOOTER),
  ) || null;

  const payload = {
    embeds: [new EmbedBuilder()
      .setColor(activeCount ? 0x5865f2 : 0x2ecc71)
      .setTitle("⚔️ Active Carries")
      .setDescription([
        "Live sessions appear below as individual cards.",
        "",
        "**Join Carry** lets you drop into a live run without exposing the private requester ticket. **End Run +1** is Carrier/staff only and updates the public live counter; verified completion still happens in the private session.",
        `**Currently live:** ${activeCount.toLocaleString("en-GB")}`,
      ].join("\n"))
      .setFooter({ text: HEADER_FOOTER })],
  };

  if (header) await header.edit(payload).catch(() => {});
  else {
    header = await channel.send(payload);
    await header.pin("Permanent Active Carries header").catch(() => {});
  }
  return header;
}

async function removeEndedCards(client, guildId, activeIds, budget) {
  const rows = db.prepare("SELECT * FROM active_carry_cards WHERE guild=? ORDER BY updated_at ASC")
    .all(String(guildId));
  let mutations = 0;
  for (const row of rows) {
    if (activeIds.has(String(row.ticket_channel))) continue;
    if (mutations >= budget) break;
    const channel = await client.channels.fetch(String(row.channel_id)).catch(() => null);
    const message = channel?.isTextBased?.() ? await channel.messages.fetch(String(row.message_id)).catch(() => null) : null;
    if (message) await message.delete().catch(() => {});
    db.prepare("DELETE FROM active_carry_cards WHERE ticket_channel=?").run(String(row.ticket_channel));
    db.prepare("DELETE FROM active_carry_run_progress WHERE ticket_channel=?").run(String(row.ticket_channel));
    mutations += 1;
  }
  return mutations;
}

async function reconcileActiveCarries(client, guild) {
  if (!guild?.id || locks.has(guild.id)) return { active: 0, mutations: 0 };
  locks.add(guild.id);
  try {
    const channel = await ensureActiveCarriesChannel(guild);
    const allSessions = await loadActiveSessions();
    const sessions = allSessions.filter((session) => sessionBelongsToGuild(session, guild.id));
    await ensureHeader(channel, sessions.length);

    let mutations = 0;
    const activeIds = new Set(sessions.map((session) => String(session.ticketId)));
    mutations += await removeEndedCards(client, guild.id, activeIds, MAX_MUTATIONS_PER_PASS - mutations);

    for (const session of sessions) {
      if (mutations >= MAX_MUTATIONS_PER_PASS) break;
      const payload = cardPayload(guild, session);
      const hash = payloadHash(payload);
      const stored = db.prepare("SELECT * FROM active_carry_cards WHERE ticket_channel=?").get(String(session.ticketId));
      let message = stored?.message_id
        ? await channel.messages.fetch(String(stored.message_id)).catch(() => null)
        : null;

      if (!message) {
        message = await channel.send(payload);
        db.prepare(`
          INSERT INTO active_carry_cards(ticket_channel,guild,channel_id,message_id,payload_hash,updated_at)
          VALUES(?,?,?,?,?,?)
          ON CONFLICT(ticket_channel) DO UPDATE SET
            guild=excluded.guild, channel_id=excluded.channel_id, message_id=excluded.message_id,
            payload_hash=excluded.payload_hash, updated_at=excluded.updated_at
        `).run(String(session.ticketId), String(guild.id), String(channel.id), String(message.id), hash, Date.now());
        mutations += 1;
        continue;
      }

      if (String(stored?.payload_hash || "") !== hash) {
        await message.edit(payload).catch(() => {});
        db.prepare("UPDATE active_carry_cards SET payload_hash=?,updated_at=? WHERE ticket_channel=?")
          .run(hash, Date.now(), String(session.ticketId));
        mutations += 1;
      }
    }

    return { active: sessions.length, mutations, channel };
  } finally {
    locks.delete(guild.id);
  }
}

async function refreshTicketCard(client, ticketChannel) {
  if (!ticketChannel?.guild) return null;
  return reconcileActiveCarries(client, ticketChannel.guild);
}

async function findLiveSessionForGuild(ticketId, guildId) {
  const sessions = await loadActiveSessions();
  return sessions.find((session) =>
    String(session.ticketId) === String(ticketId)
    && sessionBelongsToGuild(session, guildId),
  ) || null;
}

function actorCanRun(interaction, session) {
  const carrierId = String(session?.carrier?.discord_id || "");
  return carrierId === String(interaction.user.id)
    || interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)
    || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

async function handleActiveCarriesInteraction(interaction) {
  if (!interaction.inGuild?.() || !interaction.isButton?.()) return false;
  const id = String(interaction.customId || "");

  if (id.startsWith(RUN_PREFIX)) {
    const ticketId = id.slice(RUN_PREFIX.length);
    const session = await findLiveSessionForGuild(ticketId, interaction.guildId);
    if (!session) {
      await interaction.reply({ content: "❌ That carry is no longer live.", flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!actorCanRun(interaction, session)) {
      await interaction.reply({ content: "❌ Only the assigned Carrier or staff can update live run progress.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const progress = liveRunProgress(session, interaction.guildId);
    const next = Math.min(progress.target, progress.done + 1);
    db.prepare("UPDATE active_carry_run_progress SET runs_done=?,updated_at=? WHERE ticket_channel=?")
      .run(next, Date.now(), String(ticketId));

    await interaction.reply({
      content: next >= progress.target
        ? `✅ Run **${next}/${progress.target}** recorded. The planned live batch is complete — finish the verified session from the private Carry Controls when ready.`
        : `✅ Run **${next}/${progress.target}** recorded on the public live card.`,
      flags: MessageFlags.Ephemeral,
    });
    await reconcileActiveCarries(interaction.client, interaction.guild).catch(() => {});
    return true;
  }

  if (id.startsWith(MANAGE_PREFIX)) {
    const ticketId = id.slice(MANAGE_PREFIX.length);
    const ticket = await interaction.guild.channels.fetch(String(ticketId)).catch(() => null);
    if (!ticket?.isTextBased?.()) {
      await interaction.reply({ content: "❌ That carry is no longer active.", flags: MessageFlags.Ephemeral });
      return true;
    }

    const member = interaction.member;
    const canManage = member?.permissions?.has(PermissionFlagsBits.ManageChannels)
      || member?.permissions?.has(PermissionFlagsBits.Administrator)
      || ticket.permissionsFor?.(member)?.has(PermissionFlagsBits.ViewChannel);
    if (!canManage) {
      await interaction.reply({ content: "❌ Carrier controls are only available to the assigned session participants or staff.", flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.reply({
      content: `⚙️ Open the private session controls in <#${ticket.id}>. Ready Check, verified timer, participant management and final completion stay there.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  return false;
}

function startGuildActiveCarriesBoard(client, guild) {
  if (!guild?.id || timers.has(guild.id)) return;
  void reconcileActiveCarries(client, guild).catch((error) => console.warn(`[ACTIVE CARRIES] ${guild.name}: ${error.message}`));
  const timer = setInterval(() => {
    void reconcileActiveCarries(client, guild).catch((error) => console.warn(`[ACTIVE CARRIES] ${guild.name}: ${error.message}`));
  }, REFRESH_MS);
  timer.unref?.();
  timers.set(guild.id, timer);
}

function startActiveCarriesBoard(client) {
  for (const config of listConfiguredGuilds()) {
    const guild = client.guilds.cache.get(String(config.guild));
    if (guild) startGuildActiveCarriesBoard(client, guild);
  }
}

module.exports = {
  CHANNEL_NAME,
  HEADER_FOOTER,
  ensureActiveCarriesChannel,
  handleActiveCarriesInteraction,
  reconcileActiveCarries,
  refreshTicketCard,
  startActiveCarriesBoard,
  startGuildActiveCarriesBoard,
};