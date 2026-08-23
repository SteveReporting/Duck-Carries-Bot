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
    .select("id,status")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"]);
  if (error) throw new Error(`Could not check active carry requests: ${error.message}`);
  return data || [];
}

function activeLegacyRequests(channelId) {
  try {
    return db.prepare(`
      SELECT id,status
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

async function sendCloseLog(interaction) {
  if (!process.env.MOD_LOG_CHANNEL_ID) return;
  const logChannel = await interaction.client.channels
    .fetch(process.env.MOD_LOG_CHANNEL_ID)
    .catch(() => null);
  if (!logChannel?.isTextBased?.()) return;

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("🔒 Carry Ticket Closed")
    .setDescription([
      `**Ticket:** #${interaction.channel?.name || interaction.channelId}`,
      `**Channel ID:** \`${interaction.channelId}\``,
      `**Closed by:** <@${interaction.user.id}>`,
      "**Reason:** No active carry requests remained in the ticket.",
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

  const [platformRows, legacyRows] = await Promise.all([
    activePlatformRequests(interaction.channelId),
    Promise.resolve(activeLegacyRequests(interaction.channelId)),
  ]);

  const active = [...platformRows, ...legacyRows];
  if (active.length) {
    await interaction.editReply(
      `❌ This ticket still has **${active.length} active carry request${active.length === 1 ? "" : "s"}**. Complete, release or cancel the active request before closing the channel.`,
    );
    return true;
  }

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [closeRow(true)] }).catch(() => {});
  }

  await sendCloseLog(interaction).catch(() => {});
  await interaction.editReply("🔒 No active carry requests remain. This ticket will close in **10 seconds**.");

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
      "When this carry has no active requests left, the Carrier or staff can close the ticket here.",
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
