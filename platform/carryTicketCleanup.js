const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");

const CLOSE_ID = "carry_close_ticket";
const CARRIER_PLATFORM_ROLES = ["carrier", "moderator", "administrator", "owner"];

function isCarryTicket(channel) {
  return Boolean(
    channel &&
    channel.type === ChannelType.GuildText &&
    String(channel.name || "").toLowerCase().startsWith("carry-")
  );
}

function closeRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_ID)
      .setLabel(disabled ? "Closing Ticket..." : "Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled),
  );
}

function hasCloseButton(message) {
  return (message?.components || []).some((row) =>
    (row.components || []).some((component) => component.customId === CLOSE_ID),
  );
}

async function activePlatformRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,status,requester_id,carrier_id,runs_requested,runs_completed")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"]);
  if (error) throw new Error(`Could not check active carry requests: ${error.message}`);
  return data || [];
}

function activeLegacyRequests(channelId) {
  try {
    return db.prepare(`
      SELECT id,status,user,carrier,runs
      FROM queue
      WHERE ticket_channel = ? AND status = 'claimed'
    `).all(String(channelId));
  } catch (error) {
    if (String(error.message || "").includes("no such column")) return [];
    throw error;
  }
}

async function canManageTicket(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;

  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) return false;
  return hasAnyPlatformRole(profile.id, CARRIER_PLATFORM_ROLES);
}

async function requeueActivePlatformRequests(channelId) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("carry_requests")
    .update({
      status: "queued",
      carrier_id: null,
      claimed_at: null,
      started_at: null,
      ticket_channel_id: null,
      session_runs: null,
      carrier_confirmed_at: null,
      requester_confirmed_at: null,
      updated_at: now,
    })
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .select("id,requester_id,status,runs_requested,runs_completed");

  if (error) throw new Error(`Could not return active platform requests to the queue: ${error.message}`);
  return data || [];
}

function requeueActiveLegacyRequests(channelId) {
  try {
    const rows = activeLegacyRequests(channelId);
    if (!rows.length) return [];

    db.prepare(`
      UPDATE queue
      SET carrier = NULL,
          status = 'waiting',
          ticket_channel = NULL,
          carrier_confirmed = 0,
          requester_confirmed = 0
      WHERE ticket_channel = ? AND status = 'claimed'
    `).run(String(channelId));

    return rows;
  } catch (error) {
    if (String(error.message || "").includes("no such column")) return [];
    throw error;
  }
}

async function notifyRequeuedPlatformRequesters(interaction, rows) {
  if (!rows.length) return;

  const supabase = getSupabase();
  const requesterIds = [...new Set(rows.map((row) => row.requester_id).filter(Boolean))];
  if (!requesterIds.length) return;

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,discord_id")
    .in("id", requesterIds);
  if (error) {
    console.warn(`[CARRY TICKET CLOSE] Could not load requester profiles for requeue DMs: ${error.message}`);
    return;
  }

  const discordByProfile = new Map((profiles || []).map((profile) => [profile.id, profile.discord_id]));
  for (const row of rows) {
    const discordId = discordByProfile.get(row.requester_id);
    if (!discordId) continue;

    try {
      const user = await interaction.client.users.fetch(discordId);
      const left = Math.max(0, Number(row.runs_requested || 0) - Number(row.runs_completed || 0));
      await user.send([
        "🔒 **Your carry ticket was closed by a Carrier or staff member.**",
        `Your request has been returned to the queue${left ? ` with **${left} run${left === 1 ? "" : "s"} remaining**` : ""}.`,
        "You do not need to submit a new request.",
      ].join("\n"));
    } catch {}
  }
}

async function sendCloseLog(interaction, { platformRequeued = 0, legacyRequeued = 0 } = {}) {
  if (!process.env.MOD_LOG_CHANNEL_ID) return;
  const logChannel = await interaction.client.channels
    .fetch(process.env.MOD_LOG_CHANNEL_ID)
    .catch(() => null);
  if (!logChannel?.isTextBased?.()) return;

  const totalRequeued = platformRequeued + legacyRequeued;
  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("🔒 Carry Ticket Closed")
    .setDescription([
      `**Ticket:** #${interaction.channel?.name || interaction.channelId}`,
      `**Channel ID:** \`${interaction.channelId}\``,
      `**Closed by:** <@${interaction.user.id}>`,
      `**Active requests returned to queue:** ${totalRequeued}`,
    ].join("\n"))
    .setFooter({ text: "The Carry Tavern • Carry Logs" })
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

async function handleCarryTicketClose(interaction) {
  if (!interaction.isButton() || interaction.customId !== CLOSE_ID) return false;

  await interaction.deferReply({ ephemeral: true });

  if (!isCarryTicket(interaction.channel)) {
    await interaction.editReply("❌ This button can only be used inside a Carry Tavern ticket.");
    return true;
  }

  if (!(await canManageTicket(interaction))) {
    await interaction.editReply("❌ Only a Carrier or staff member can close a carry ticket.");
    return true;
  }

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [closeRow(true)] }).catch(() => {});
  }

  const [platformRows, legacyRows] = await Promise.all([
    activePlatformRequests(interaction.channelId),
    Promise.resolve(activeLegacyRequests(interaction.channelId)),
  ]);

  let platformRequeued = [];
  let legacyRequeued = [];

  if (platformRows.length) {
    platformRequeued = await requeueActivePlatformRequests(interaction.channelId);
    await notifyRequeuedPlatformRequesters(interaction, platformRequeued).catch(() => {});
  }

  if (legacyRows.length) {
    legacyRequeued = requeueActiveLegacyRequests(interaction.channelId);
  }

  await sendCloseLog(interaction, {
    platformRequeued: platformRequeued.length,
    legacyRequeued: legacyRequeued.length,
  }).catch(() => {});

  const totalRequeued = platformRequeued.length + legacyRequeued.length;
  await interaction.editReply(
    totalRequeued
      ? `🔒 Closing this ticket in **10 seconds**. **${totalRequeued} active carry request${totalRequeued === 1 ? " was" : "s were"} returned to the queue** so no request is lost.`
      : "🔒 This ticket will close in **10 seconds**.",
  );

  const channel = interaction.channel;
  setTimeout(() => {
    channel?.delete?.(`Carry ticket closed by ${interaction.user.tag}`).catch(() => {});
  }, 10_000).unref?.();

  return true;
}

async function ensureCarryTicketClosePanel(channel) {
  if (!isCarryTicket(channel) || !channel.isTextBased?.()) return false;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages?.some((message) => message.author?.id === channel.client.user.id && hasCloseButton(message))) {
    return false;
  }

  await channel.send({
    content: [
      "🔒 **Ticket Controls**",
      "Carriers or staff can close the ticket at any time.",
      "If active carry requests are still attached, they are safely returned to the queue with their existing progress preserved.",
    ].join("\n"),
    components: [closeRow(false)],
  });
  return true;
}

async function retrofitCarryTicketClosePanels(client) {
  if (!process.env.GUILD_ID) return 0;
  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return 0;

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return 0;

  let added = 0;
  for (const channel of channels.values()) {
    if (!isCarryTicket(channel)) continue;
    try {
      if (await ensureCarryTicketClosePanel(channel)) added += 1;
    } catch (error) {
      console.warn(`[CARRY TICKET CLOSE] Could not update #${channel?.name || channel?.id}:`, error.message);
    }
  }
  return added;
}

module.exports = {
  CLOSE_ID,
  ensureCarryTicketClosePanel,
  handleCarryTicketClose,
  retrofitCarryTicketClosePanels,
};
