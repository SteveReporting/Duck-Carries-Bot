const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");
const { canonicalizeDungeon, canonicalizeDifficulty } = require("./dungeons");

const VOICE_CATEGORY_NAME = "🔊・CARRY VOICE";
const WAITING_VOICE_NAME = "⏳・waiting-for-carry";
const VOICE_CARD_FOOTER = "The Carry Tavern • Session Voice";
const STAFF_ROLES = ["moderator", "administrator", "owner"];
const START_BUTTON_ID = "carry_service_start";
const DROPIN_OPEN_ID = "carry_dropin_open";
const DROPIN_SELECT_ID = "carry_dropin_select";
const WAITING_OPEN_ID = "carry_waiting_vc";
const MANAGE_ID = "carry_voice_manage";
const MEMBER_SELECT_ID = "carry_voice_member_select";
const SYNC_WAITING_ID = "carry_voice_sync_waiting";

const provisionLocks = new Map();
let refreshTimer = null;

db.exec(`
  CREATE TABLE IF NOT EXISTS carry_voice_sessions (
    ticket_channel TEXT PRIMARY KEY,
    guild TEXT NOT NULL,
    voice_channel TEXT NOT NULL,
    dungeon TEXT,
    difficulty TEXT,
    carrier TEXT,
    status TEXT NOT NULL DEFAULT 'claimed',
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    closed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS carry_voice_dropins (
    ticket_channel TEXT NOT NULL,
    guild TEXT NOT NULL,
    user TEXT NOT NULL,
    dungeon TEXT,
    difficulty TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    joined_at INTEGER NOT NULL,
    left_at INTEGER,
    PRIMARY KEY(ticket_channel, user)
  );

  CREATE INDEX IF NOT EXISTS carry_voice_dropins_user_idx
    ON carry_voice_dropins(guild, user, status);
`);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function safePart(value, max = 34) {
  return String(value || "carry")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max) || "carry";
}

function voiceUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function sessionRow(ticketId) {
  return db.prepare("SELECT * FROM carry_voice_sessions WHERE ticket_channel=?")
    .get(String(ticketId)) || null;
}

function activeDropins(ticketId) {
  return db.prepare(`
    SELECT * FROM carry_voice_dropins
    WHERE ticket_channel=? AND status='active'
    ORDER BY joined_at ASC
  `).all(String(ticketId));
}

async function loadTicketRequests(ticketId, statuses = ["claimed", "in_progress"]) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(ticketId))
    .in("status", statuses)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load carry voice participants: ${error.message}`);
  return data || [];
}

async function actorCanManage(interaction, requests) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }
  if (requests.some((request) => String(request.carrier?.discord_id || "") === String(interaction.user.id))) {
    return true;
  }
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) return false;
  return hasAnyPlatformRole(profile.id, STAFF_ROLES).catch(() => false);
}

async function ensureVoiceCategory(guild) {
  if (process.env.CARRY_VOICE_CATEGORY_ID) {
    const configured = await guild.channels.fetch(process.env.CARRY_VOICE_CATEGORY_ID).catch(() => null);
    if (configured?.type === ChannelType.GuildCategory) return configured;
  }

  let category = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && normalize(channel.name) === normalize(VOICE_CATEGORY_NAME));

  if (!category) {
    category = await guild.channels.create({
      name: VOICE_CATEGORY_NAME,
      type: ChannelType.GuildCategory,
      reason: "The Carry Tavern automated carry voice system",
    });
  }
  return category;
}

async function ensureWaitingVoice(guild) {
  if (process.env.CARRY_WAITING_VC_ID) {
    const configured = await guild.channels.fetch(process.env.CARRY_WAITING_VC_ID).catch(() => null);
    if (configured?.type === ChannelType.GuildVoice) return configured;
  }

  const category = await ensureVoiceCategory(guild);
  let channel = guild.channels.cache.find((item) =>
    item.type === ChannelType.GuildVoice && normalize(item.name) === normalize(WAITING_VOICE_NAME));

  if (!channel) {
    channel = await guild.channels.create({
      name: WAITING_VOICE_NAME,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: [
        {
          id: guild.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak],
        },
        {
          id: guild.client.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ManageChannels,
          ],
        },
      ],
      reason: "Optional waiting room for queued carries",
    });
  }

  return channel;
}

function requesterDiscordIds(requests) {
  return [...new Set(requests.map((request) => request.requester?.discord_id).filter(Boolean).map(String))];
}

function carrierDiscordId(requests) {
  return requests.map((request) => request.carrier?.discord_id).find(Boolean) || null;
}

async function syncParticipantPermissions(voice, requests, dropins = activeDropins(voice.id)) {
  const allowed = new Set([
    String(voice.client.user.id),
    ...requesterDiscordIds(requests),
    ...requests.map((request) => request.carrier?.discord_id).filter(Boolean).map(String),
    ...dropins.map((row) => String(row.user)),
  ]);

  for (const userId of allowed) {
    if (userId === String(voice.guild.id)) continue;
    await voice.permissionOverwrites.edit(userId, {
      ViewChannel: true,
      Connect: true,
      Speak: true,
      Stream: true,
    }, { reason: "Carry voice participant sync" }).catch(() => {});
  }
}

async function moveWaitingParticipants(guild, requests, voice) {
  const waiting = await ensureWaitingVoice(guild);
  const ids = new Set([
    ...requesterDiscordIds(requests),
    ...requests.map((request) => request.carrier?.discord_id).filter(Boolean).map(String),
  ]);

  let moved = 0;
  for (const id of ids) {
    const member = await guild.members.fetch(id).catch(() => null);
    if (!member?.voice?.channelId || member.voice.channelId !== waiting.id) continue;
    await member.voice.setChannel(voice, "Carry claimed — move from waiting room to session VC")
      .then(() => { moved += 1; })
      .catch(() => {});
  }
  return moved;
}

async function ensureSessionVoice(ticketChannel) {
  if (!ticketChannel?.guild || !ticketChannel?.isTextBased?.()) return null;
  const ticketId = String(ticketChannel.id);

  if (provisionLocks.has(ticketId)) return provisionLocks.get(ticketId);

  const work = (async () => {
    const requests = await loadTicketRequests(ticketId);
    if (!requests.length) return null;

    const guild = ticketChannel.guild;
    const stored = sessionRow(ticketId);
    let voice = stored?.voice_channel
      ? await guild.channels.fetch(String(stored.voice_channel)).catch(() => null)
      : null;

    if (!voice || voice.type !== ChannelType.GuildVoice) {
      const category = await ensureVoiceCategory(guild);
      const first = requests[0];
      const participantIds = new Set([
        ...requesterDiscordIds(requests),
        ...requests.map((request) => request.carrier?.discord_id).filter(Boolean).map(String),
      ]);

      voice = await guild.channels.create({
        name: `🍺・${safePart(first.dungeon)}-${String(ticketId).slice(-4)}`,
        type: ChannelType.GuildVoice,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
          {
            id: guild.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.MoveMembers,
              PermissionFlagsBits.ManageChannels,
            ],
          },
          ...[...participantIds].map((id) => ({
            id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.Connect,
              PermissionFlagsBits.Speak,
              PermissionFlagsBits.Stream,
            ],
          })),
        ],
        reason: `Private carry voice for ${ticketChannel.name}`,
      });

      db.prepare(`
        INSERT INTO carry_voice_sessions(
          ticket_channel,guild,voice_channel,dungeon,difficulty,carrier,status,created_at,started_at,closed_at
        ) VALUES(?,?,?,?,?,?, 'claimed', ?, NULL, NULL)
        ON CONFLICT(ticket_channel) DO UPDATE SET
          guild=excluded.guild,
          voice_channel=excluded.voice_channel,
          dungeon=excluded.dungeon,
          difficulty=excluded.difficulty,
          carrier=excluded.carrier,
          status=CASE WHEN carry_voice_sessions.status='closed' THEN 'claimed' ELSE carry_voice_sessions.status END,
          closed_at=NULL
      `).run(
        ticketId,
        String(guild.id),
        String(voice.id),
        canonicalizeDungeon(first.dungeon),
        canonicalizeDifficulty(first.difficulty),
        String(carrierDiscordId(requests) || ""),
        Date.now(),
      );
    }

    await syncParticipantPermissions(voice, requests, activeDropins(ticketId));
    await moveWaitingParticipants(guild, requests, voice);
    await ensureVoiceCard(ticketChannel, voice, requests);
    return voice;
  })().finally(() => provisionLocks.delete(ticketId));

  provisionLocks.set(ticketId, work);
  return work;
}

function progressLine(request) {
  const completed = Math.max(0, Number(request.runs_completed || 0));
  const total = Math.max(0, Number(request.runs_requested || 0));
  const planned = Math.max(0, Number(request.session_runs || 0));
  const who = request.requester?.roblox_username || request.requester?.discord_display_name || request.requester?.discord_username || "Requester";
  return `• **${who}** — ${completed}/${total} complete${planned ? ` • ${planned} planned this session` : ""}`;
}

function voiceCardPayload(ticketChannel, voice, requests) {
  const dropins = activeDropins(ticketChannel.id);
  let timerText = "Not started";
  try {
    const { getServiceSnapshot, formatMinutes } = require("./carryServiceTime");
    const snapshot = getServiceSnapshot(ticketChannel.id);
    if (snapshot.status === "running") timerText = `🟢 Live • ${formatMinutes(snapshot.minutes)} verified`;
    else if (snapshot.status === "checkpoint") timerText = `🟠 Verification checkpoint • ${formatMinutes(snapshot.minutes)}`;
    else if (snapshot.status === "stopped") timerText = `⏸️ Frozen • ${formatMinutes(snapshot.minutes)}`;
    else if (snapshot.status === "completed") timerText = `✅ Completed • ${formatMinutes(snapshot.minutes)}`;
  } catch {}

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: "THE CARRY TAVERN • LIVE SESSION" })
    .setTitle("🔊 Session Voice & Live Progress")
    .setDescription([
      `**Carry VC:** <#${voice.id}>`,
      `**Voice is optional.** If you never join VC, carry-start pings and the ticket still work normally.`,
      "",
      `**Session:** ${timerText}`,
      `**Requesters:** ${requests.length} • **Drop-ins:** ${dropins.length}`,
      "",
      ...requests.slice(0, 12).map(progressLine),
      "",
      "Queued members sitting in **Waiting for Carry** are moved here automatically when their session is claimed. Mid-run visitors can join from the Operations Hub without seeing private ticket notes.",
    ].join("\n").slice(0, 4000))
    .setFooter({ text: VOICE_CARD_FOOTER })
    .setTimestamp();

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Join Carry VC")
          .setEmoji("🔊")
          .setStyle(ButtonStyle.Link)
          .setURL(voiceUrl(ticketChannel.guildId, voice.id)),
        new ButtonBuilder()
          .setCustomId(MANAGE_ID)
          .setLabel("Manage Members")
          .setEmoji("👥")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(SYNC_WAITING_ID)
          .setLabel("Sync Waiting VC")
          .setEmoji("🔄")
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

async function ensureVoiceCard(ticketChannel, voice, requests = null) {
  if (!ticketChannel?.isTextBased?.() || !voice) return null;
  const active = requests || await loadTicketRequests(ticketChannel.id);
  if (!active.length) return null;

  const recent = await ticketChannel.messages.fetch({ limit: 50 }).catch(() => null);
  const current = recent?.find((message) =>
    message.author?.id === ticketChannel.client.user.id &&
    message.embeds?.some((embed) => String(embed.footer?.text || "") === VOICE_CARD_FOOTER));

  const payload = voiceCardPayload(ticketChannel, voice, active);
  if (current) {
    await current.edit(payload).catch(() => {});
    return current;
  }
  return ticketChannel.send(payload);
}

async function openWaitingVoice(interaction) {
  const voice = await ensureWaitingVoice(interaction.guild);
  return interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("⏳ Waiting for Carry")
        .setDescription([
          `Join <#${voice.id}> while your request is waiting.`,
          "",
          "If you are still in that VC when a Carrier claims your carry, the bot moves you into the private session VC automatically.",
          "**You never have to join VC.** If you skip it, you still get pinged when the carry starts.",
        ].join("\n")),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setLabel("Join Waiting VC")
          .setEmoji("⏳")
          .setStyle(ButtonStyle.Link)
          .setURL(voiceUrl(interaction.guildId, voice.id)),
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

async function activeCarrySessions(guildId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,dungeon,difficulty,status,ticket_channel_id,started_at,carrier:profiles!carry_requests_carrier_id_fkey(discord_id,discord_username,discord_display_name)")
    .eq("status", "in_progress")
    .not("ticket_channel_id", "is", null)
    .order("started_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not load active drop-in sessions: ${error.message}`);

  const groups = new Map();
  for (const row of data || []) {
    if (!row.ticket_channel_id) continue;
    const key = String(row.ticket_channel_id);
    const group = groups.get(key) || {
      ticketId: key,
      dungeon: canonicalizeDungeon(row.dungeon),
      difficulty: canonicalizeDifficulty(row.difficulty),
      carrier: row.carrier || null,
      requesters: 0,
      startedAt: row.started_at || null,
    };
    group.requesters += 1;
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function joinDropIn(interaction, ticketId) {
  const ticket = await interaction.guild.channels.fetch(String(ticketId)).catch(() => null);
  if (!ticket?.isTextBased?.()) {
    return interaction.reply({ content: "❌ That carry just ended or is no longer available.", flags: MessageFlags.Ephemeral });
  }

  const requests = await loadTicketRequests(ticketId, ["in_progress"]);
  if (!requests.length) {
    return interaction.reply({ content: "❌ That carry is no longer in progress.", flags: MessageFlags.Ephemeral });
  }

  if (requests.some((request) => String(request.requester?.discord_id || "") === String(interaction.user.id))) {
    const voice = await ensureSessionVoice(ticket);
    return interaction.reply({
      content: "You are already part of this carry session.",
      components: voice ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel("Join Carry VC").setStyle(ButtonStyle.Link).setURL(voiceUrl(interaction.guildId, voice.id)),
      )] : [],
      flags: MessageFlags.Ephemeral,
    });
  }

  const other = db.prepare(`
    SELECT * FROM carry_voice_dropins
    WHERE guild=? AND user=? AND status='active' AND ticket_channel<>?
    LIMIT 1
  `).get(String(interaction.guildId), String(interaction.user.id), String(ticketId));
  if (other) {
    const otherSession = sessionRow(other.ticket_channel);
    return interaction.reply({
      content: otherSession?.voice_channel
        ? `❌ You are already dropped into <#${otherSession.voice_channel}>. Leave that session before joining another.`
        : "❌ You are already joined to another active carry session.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const first = requests[0];
  const voice = await ensureSessionVoice(ticket);
  if (!voice) {
    return interaction.reply({ content: "❌ The session VC is still being prepared. Try again in a moment.", flags: MessageFlags.Ephemeral });
  }

  db.prepare(`
    INSERT INTO carry_voice_dropins(ticket_channel,guild,user,dungeon,difficulty,status,joined_at,left_at)
    VALUES(?,?,?,?,?,'active',?,NULL)
    ON CONFLICT(ticket_channel,user) DO UPDATE SET
      status='active', joined_at=excluded.joined_at, left_at=NULL,
      dungeon=excluded.dungeon, difficulty=excluded.difficulty
  `).run(
    String(ticketId),
    String(interaction.guildId),
    String(interaction.user.id),
    canonicalizeDungeon(first.dungeon),
    canonicalizeDifficulty(first.difficulty),
    Date.now(),
  );

  await voice.permissionOverwrites.edit(interaction.user.id, {
    ViewChannel: true,
    Connect: true,
    Speak: true,
    Stream: true,
  }, { reason: "Member joined an active carry as a drop-in" });

  const waiting = await ensureWaitingVoice(interaction.guild);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (member?.voice?.channelId === waiting.id) {
    await member.voice.setChannel(voice, "Drop-in joined active carry").catch(() => {});
  }

  const carrier = carrierDiscordId(requests);
  await ticket.send({
    content: carrier ? `<@${carrier}>` : undefined,
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setDescription(`👋 <@${interaction.user.id}> joined this **${first.dungeon} • ${first.difficulty}** carry as a voice drop-in.`)],
    allowedMentions: carrier ? { users: [String(carrier)] } : undefined,
  }).catch(() => {});

  await ensureVoiceCard(ticket, voice, requests).catch(() => {});
  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ Joined Active Carry")
      .setDescription([
        `**${first.dungeon} • ${first.difficulty}**`,
        `Session VC: <#${voice.id}>`,
        "",
        "You were added to the voice session without being given access to the private requester ticket. Drop-ins do not alter Carrier service-time or requester run statistics.",
      ].join("\n"))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Session VC").setEmoji("🔊").setStyle(ButtonStyle.Link).setURL(voiceUrl(interaction.guildId, voice.id)),
      new ButtonBuilder().setCustomId(`carry_dropin_leave_${ticketId}`).setLabel("Leave Drop-In").setStyle(ButtonStyle.Secondary),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function openDropIn(interaction) {
  const sessions = await activeCarrySessions(interaction.guildId);
  const available = [];
  for (const session of sessions) {
    const ticket = await interaction.guild.channels.fetch(session.ticketId).catch(() => null);
    if (ticket?.isTextBased?.()) available.push(session);
  }

  if (!available.length) {
    return interaction.reply({ content: "🍺 There are no live carry sessions accepting drop-ins right now.", flags: MessageFlags.Ephemeral });
  }

  if (available.length === 1) return joinDropIn(interaction, available[0].ticketId);

  const select = new StringSelectMenuBuilder()
    .setCustomId(DROPIN_SELECT_ID)
    .setPlaceholder("Choose the dungeon you want to join")
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(available.slice(0, 25).map((session) => ({
      label: `${session.dungeon} • ${session.difficulty}`.slice(0, 100),
      description: `${session.requesters} requester${session.requesters === 1 ? "" : "s"} already in this live carry`.slice(0, 100),
      value: session.ticketId,
      emoji: "⚔️",
    })));

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🌐 Join a Carry Mid-Run")
      .setDescription("Pick a live dungeon below. You get access to its optional session VC without exposing the private requester ticket or changing carry statistics.")],
    components: [new ActionRowBuilder().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

async function leaveDropIn(interaction, ticketId) {
  const row = db.prepare(`
    SELECT * FROM carry_voice_dropins
    WHERE ticket_channel=? AND user=? AND status='active'
  `).get(String(ticketId), String(interaction.user.id));
  if (!row) {
    return interaction.reply({ content: "You are not currently a drop-in for that carry.", flags: MessageFlags.Ephemeral });
  }

  db.prepare(`
    UPDATE carry_voice_dropins SET status='left',left_at=?
    WHERE ticket_channel=? AND user=?
  `).run(Date.now(), String(ticketId), String(interaction.user.id));

  const session = sessionRow(ticketId);
  const voice = session?.voice_channel
    ? await interaction.guild.channels.fetch(String(session.voice_channel)).catch(() => null)
    : null;
  if (voice?.type === ChannelType.GuildVoice) {
    await voice.permissionOverwrites.delete(interaction.user.id, "Drop-in left carry").catch(() => {});
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (member?.voice?.channelId === voice.id) await member.voice.disconnect("Drop-in left carry").catch(() => {});
  }

  const ticket = await interaction.guild.channels.fetch(String(ticketId)).catch(() => null);
  if (ticket?.isTextBased?.() && voice) await ensureVoiceCard(ticket, voice).catch(() => {});
  return interaction.reply({ content: "✅ You left that carry drop-in session.", flags: MessageFlags.Ephemeral });
}

async function openParticipantManager(interaction) {
  const requests = await loadTicketRequests(interaction.channelId);
  if (!requests.length) return interaction.reply({ content: "❌ No active participants remain.", flags: MessageFlags.Ephemeral });
  if (!(await actorCanManage(interaction, requests))) {
    return interaction.reply({ content: "❌ Only the assigned Carrier or staff can manage session members.", flags: MessageFlags.Ephemeral });
  }

  const options = requests.slice(0, 20).map((request) => ({
    label: String(request.requester?.roblox_username || request.requester?.discord_display_name || request.requester?.discord_username || "Requester").slice(0, 100),
    description: `Requester • ${request.dungeon} • ${Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0))} runs left`.slice(0, 100),
    value: `request:${request.id}`,
    emoji: "⚔️",
  }));

  for (const row of activeDropins(interaction.channelId)) {
    if (options.length >= 25) break;
    const member = await interaction.guild.members.fetch(row.user).catch(() => null);
    options.push({
      label: String(member?.displayName || member?.user?.username || row.user).slice(0, 100),
      description: "Voice drop-in • no private ticket access",
      value: `dropin:${row.user}`,
      emoji: "🔊",
    });
  }

  return interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0xf2b705)
      .setTitle("👥 Session Participant Manager")
      .setDescription([
        "Choose somebody to remove from the **current session**.",
        "",
        "Removing a requester does **not** erase their carry request — it returns them to the queue with remaining progress preserved. No-show reporting stays separate so a removal is not treated as an automatic punishment.",
      ].join("\n"))],
    components: [new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(MEMBER_SELECT_ID)
        .setPlaceholder("Choose a session member")
        .addOptions(options),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function confirmParticipantRemoval(interaction) {
  const value = interaction.values?.[0] || "";
  const [kind, id] = value.split(":", 2);
  if (!id || !["request", "dropin"].includes(kind)) return false;

  const requests = await loadTicketRequests(interaction.channelId);
  if (!(await actorCanManage(interaction, requests))) {
    await interaction.reply({ content: "❌ Only the assigned Carrier or staff can manage session members.", flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.update({
    embeds: [new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle("Remove from current carry?")
      .setDescription(kind === "request"
        ? "Their active request will be detached from this Carrier and returned to the queue with remaining run progress preserved."
        : "Their drop-in voice access will be removed immediately.")],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`carry_voice_remove_${kind}_${id}`)
        .setLabel("Remove From Session")
        .setEmoji("🚪")
        .setStyle(ButtonStyle.Danger),
    )],
  });
  return true;
}

async function removeParticipant(interaction, kind, id) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const requests = await loadTicketRequests(interaction.channelId);
  if (!(await actorCanManage(interaction, requests))) {
    await interaction.editReply("❌ Only the assigned Carrier or staff can manage session members.");
    return true;
  }

  const session = sessionRow(interaction.channelId);
  const voice = session?.voice_channel
    ? await interaction.guild.channels.fetch(String(session.voice_channel)).catch(() => null)
    : null;

  if (kind === "dropin") {
    const row = db.prepare(`SELECT * FROM carry_voice_dropins WHERE ticket_channel=? AND user=? AND status='active'`)
      .get(String(interaction.channelId), String(id));
    if (!row) {
      await interaction.editReply("❌ That drop-in is no longer active.");
      return true;
    }
    db.prepare(`UPDATE carry_voice_dropins SET status='removed',left_at=? WHERE ticket_channel=? AND user=?`)
      .run(Date.now(), String(interaction.channelId), String(id));
    if (voice?.type === ChannelType.GuildVoice) {
      await voice.permissionOverwrites.delete(String(id), "Carrier removed drop-in").catch(() => {});
      const member = await interaction.guild.members.fetch(String(id)).catch(() => null);
      if (member?.voice?.channelId === voice.id) await member.voice.disconnect("Removed from carry session").catch(() => {});
    }
    const user = await interaction.client.users.fetch(String(id)).catch(() => null);
    await user?.send("🚪 You were removed from the current Carry Tavern drop-in voice session by the Carrier/staff.").catch(() => {});
    await interaction.channel.send(`🚪 <@${id}> was removed from the session drop-ins by <@${interaction.user.id}>.`).catch(() => {});
  } else {
    const request = requests.find((row) => String(row.id) === String(id));
    if (!request) {
      await interaction.editReply("❌ That requester is no longer in this active session.");
      return true;
    }

    const supabase = getSupabase();
    const stamp = new Date().toISOString();
    const { error } = await supabase
      .from("carry_requests")
      .update({
        carrier_id: null,
        status: "queued",
        claimed_at: null,
        started_at: null,
        carrier_confirmed_at: null,
        requester_confirmed_at: null,
        ticket_channel_id: null,
        session_runs: null,
        updated_at: stamp,
      })
      .eq("id", String(id))
      .eq("ticket_channel_id", String(interaction.channelId))
      .in("status", ["claimed", "in_progress"]);
    if (error) throw new Error(error.message);

    const requesterId = request.requester?.discord_id;
    const remaining = await loadTicketRequests(interaction.channelId);
    const stillPresent = requesterId && remaining.some((row) => String(row.requester?.discord_id || "") === String(requesterId));
    if (voice?.type === ChannelType.GuildVoice && requesterId && !stillPresent) {
      await voice.permissionOverwrites.delete(String(requesterId), "Requester returned to carry queue").catch(() => {});
      const member = await interaction.guild.members.fetch(String(requesterId)).catch(() => null);
      if (member?.voice?.channelId === voice.id) await member.voice.disconnect("Returned to carry queue").catch(() => {});
    }

    if (requesterId) {
      const user = await interaction.client.users.fetch(String(requesterId)).catch(() => null);
      await user?.send([
        `🔁 **Your ${request.dungeon} carry was removed from the current session.**`,
        "Your request was **not deleted**. Remaining progress was preserved and you are back in the queue for another Carrier.",
      ].join("\n")).catch(() => {});
    }
    await interaction.channel.send(`🔁 ${requesterId ? `<@${requesterId}>` : "Requester"} was removed from this session and returned to the carry queue by <@${interaction.user.id}>.`).catch(() => {});

    if (!remaining.length) {
      try {
        const { stopServiceSession } = require("./carryServiceTime");
        stopServiceSession(interaction.channelId, "All requesters were removed from the session");
      } catch {}
    }
  }

  if (voice?.type === ChannelType.GuildVoice) await ensureVoiceCard(interaction.channel, voice).catch(() => {});
  try {
    const { ensureCarryControlCenter } = require("./carryControlCenter");
    await ensureCarryControlCenter(interaction.channel, { replace: true, ping: false });
  } catch {}

  await interaction.editReply("✅ Session participant updated.");
  return true;
}

async function syncWaitingForTicket(interaction) {
  const requests = await loadTicketRequests(interaction.channelId);
  if (!(await actorCanManage(interaction, requests))) {
    return interaction.reply({ content: "❌ Only the assigned Carrier or staff can sync the waiting VC.", flags: MessageFlags.Ephemeral });
  }
  const voice = await ensureSessionVoice(interaction.channel);
  if (!voice) return interaction.reply({ content: "❌ Session voice is not available yet.", flags: MessageFlags.Ephemeral });
  const moved = await moveWaitingParticipants(interaction.guild, requests, voice);
  return interaction.reply({ content: `🔄 Voice sync complete. **${moved}** participant${moved === 1 ? "" : "s"} moved from Waiting VC.`, flags: MessageFlags.Ephemeral });
}

async function announceCarryStarted(ticketChannel) {
  if (!ticketChannel?.isTextBased?.()) return false;
  const requests = await loadTicketRequests(ticketChannel.id, ["in_progress"]);
  if (!requests.length) return false;
  const voice = await ensureSessionVoice(ticketChannel);
  if (!voice) return false;

  await moveWaitingParticipants(ticketChannel.guild, requests, voice);
  const existing = sessionRow(ticketChannel.id);
  if (existing?.started_at) {
    await ensureVoiceCard(ticketChannel, voice, requests);
    return true;
  }

  db.prepare(`UPDATE carry_voice_sessions SET status='started',started_at=? WHERE ticket_channel=?`)
    .run(Date.now(), String(ticketChannel.id));

  const ids = requesterDiscordIds(requests);
  await ticketChannel.send({
    content: ids.map((id) => `<@${id}>`).join(" "),
    embeds: [new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("▶️ Carry Started")
      .setDescription([
        `The **${requests[0].dungeon} • ${requests[0].difficulty}** carry is live now.`,
        `Optional session VC: <#${voice.id}>`,
        "",
        "Not in VC? Nothing changes — you were still pinged here and the carry ticket continues normally.",
      ].join("\n"))],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Join Carry VC").setEmoji("🔊").setStyle(ButtonStyle.Link).setURL(voiceUrl(ticketChannel.guildId, voice.id)),
    )],
    allowedMentions: { users: ids },
  }).catch(() => {});

  for (const id of ids) {
    const user = await ticketChannel.client.users.fetch(id).catch(() => null);
    await user?.send({
      content: `▶️ **Your ${requests[0].dungeon} carry just started.**\nVoice is optional: ${voiceUrl(ticketChannel.guildId, voice.id)}`,
    }).catch(() => {});
  }

  await ensureVoiceCard(ticketChannel, voice, requests);
  return true;
}

async function closeVoiceForTicket(client, ticketId, reason = "Carry ticket closed") {
  const row = sessionRow(ticketId);
  if (!row) return false;
  const guild = client.guilds.cache.get(String(row.guild)) || await client.guilds.fetch(String(row.guild)).catch(() => null);
  const voice = guild ? await guild.channels.fetch(String(row.voice_channel)).catch(() => null) : null;

  for (const dropin of activeDropins(ticketId)) {
    const user = await client.users.fetch(String(dropin.user)).catch(() => null);
    await user?.send("🔒 The carry session you dropped into has ended. Your temporary voice access was removed.").catch(() => {});
  }

  if (voice?.type === ChannelType.GuildVoice) await voice.delete(reason).catch(() => {});
  db.prepare(`UPDATE carry_voice_sessions SET status='closed',closed_at=? WHERE ticket_channel=?`)
    .run(Date.now(), String(ticketId));
  db.prepare(`UPDATE carry_voice_dropins SET status='closed',left_at=COALESCE(left_at,?) WHERE ticket_channel=? AND status='active'`)
    .run(Date.now(), String(ticketId));
  return true;
}

async function refreshAllVoiceCards(client) {
  const rows = db.prepare(`SELECT * FROM carry_voice_sessions WHERE status IN ('claimed','started')`).all();
  for (const row of rows) {
    const ticket = await client.channels.fetch(String(row.ticket_channel)).catch(() => null);
    if (!ticket?.isTextBased?.()) continue;
    const voice = await ticket.guild.channels.fetch(String(row.voice_channel)).catch(() => null);
    if (voice?.type !== ChannelType.GuildVoice) continue;
    const requests = await loadTicketRequests(ticket.id).catch(() => []);
    if (!requests.length) continue;
    await ensureVoiceCard(ticket, voice, requests).catch(() => {});
  }
}

async function retrofitCarryVoices(client) {
  if (!process.env.GUILD_ID) return { waiting: null, sessions: 0 };
  const guild = client.guilds.cache.get(process.env.GUILD_ID) || await client.guilds.fetch(process.env.GUILD_ID);
  await guild.channels.fetch();
  await guild.members.fetch().catch(() => {});
  const waiting = await ensureWaitingVoice(guild);
  let sessions = 0;

  for (const channel of guild.channels.cache.values()) {
    if (!channel?.isTextBased?.() || !String(channel.name || "").toLowerCase().startsWith("carry-")) continue;
    const requests = await loadTicketRequests(channel.id).catch(() => []);
    if (!requests.length) continue;
    const voice = await ensureSessionVoice(channel).catch(() => null);
    if (voice) sessions += 1;
  }

  if (!refreshTimer) {
    refreshTimer = setInterval(() => {
      refreshAllVoiceCards(client).catch((error) => console.warn(`[CARRY VOICE] Refresh failed: ${error.message}`));
    }, 60_000);
    refreshTimer.unref?.();
  }

  return { waiting, sessions };
}

async function handleCarryVoiceInteraction(interaction) {
  if (!interaction.inGuild?.()) return false;

  if (interaction.isButton?.() && interaction.customId === WAITING_OPEN_ID) {
    await openWaitingVoice(interaction);
    return true;
  }
  if (interaction.isButton?.() && interaction.customId === DROPIN_OPEN_ID) {
    await openDropIn(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu?.() && interaction.customId === DROPIN_SELECT_ID) {
    await joinDropIn(interaction, interaction.values[0]);
    return true;
  }
  if (interaction.isButton?.() && interaction.customId.startsWith("carry_dropin_leave_")) {
    await leaveDropIn(interaction, interaction.customId.slice("carry_dropin_leave_".length));
    return true;
  }
  if (interaction.isButton?.() && interaction.customId === MANAGE_ID) {
    await openParticipantManager(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu?.() && interaction.customId === MEMBER_SELECT_ID) {
    return confirmParticipantRemoval(interaction);
  }
  if (interaction.isButton?.() && interaction.customId.startsWith("carry_voice_remove_request_")) {
    return removeParticipant(interaction, "request", interaction.customId.slice("carry_voice_remove_request_".length));
  }
  if (interaction.isButton?.() && interaction.customId.startsWith("carry_voice_remove_dropin_")) {
    return removeParticipant(interaction, "dropin", interaction.customId.slice("carry_voice_remove_dropin_".length));
  }
  if (interaction.isButton?.() && interaction.customId === SYNC_WAITING_ID) {
    await syncWaitingForTicket(interaction);
    return true;
  }

  return false;
}

function observeCarryInteraction(interaction) {
  if (!interaction?.isButton?.()) return;
  const id = String(interaction.customId || "");

  if (id === START_BUTTON_ID) {
    const channel = interaction.channel;
    const timer = setTimeout(() => {
      announceCarryStarted(channel).catch((error) => console.warn(`[CARRY VOICE] Start sync failed: ${error.message}`));
    }, 1500);
    timer.unref?.();
    return;
  }

  if (id.startsWith("carry_cancel_") || id.startsWith("carry_delete_")) {
    const channel = interaction.channel;
    const timer = setTimeout(async () => {
      if (!channel?.isTextBased?.()) return;
      const voice = await ensureSessionVoice(channel).catch(() => null);
      if (voice) await ensureVoiceCard(channel, voice).catch(() => {});
    }, 2000);
    timer.unref?.();
  }
}

module.exports = {
  DROPIN_OPEN_ID,
  START_BUTTON_ID,
  WAITING_OPEN_ID,
  announceCarryStarted,
  closeVoiceForTicket,
  ensureSessionVoice,
  ensureWaitingVoice,
  handleCarryVoiceInteraction,
  observeCarryInteraction,
  retrofitCarryVoices,
};
