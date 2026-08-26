const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require("discord.js");

const CLOSE_ID = "carrier_application_ticket_close";

const STAFF_ROLE_NAMES = new Set([
  "headofcarriers",
  "deputyheadofcarriers",
  "recruitmentlead",
  "traininglead",
  "carriersupervisor",
  "carriermentor",
]);

// These are permanent Carrier Department channels, never applicant tickets.
const PERMANENT_CHANNEL_NAMES = new Set([
  "becomeacarrier",
  "applicationreviews",
  "carriernews",
  "carrierannouncements",
  "carriertraining",
  "training",
  "carrierlogs",
  "carrierchat",
  "carriercommands",
  "carrierdirectory",
  "carrierleaderboard",
  "carrierresources",
  "carrierguides",
  "carrierinfo",
  "carrierrules",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function parentLooksLikeCarrierRecruitment(channel) {
  const parentName = normalize(channel?.parent?.name || "");
  if (!parentName) return false;

  // Explicitly ignore unrelated ticket areas and test/demo categories.
  if (
    parentName.includes("supportticket") ||
    parentName.includes("ticketv2test") ||
    parentName.includes("test") ||
    parentName.includes("demo")
  ) {
    return false;
  }

  // The old application system used "Carrier Team Tickets" with channels such
  // as duck-request-208. Also support clearly named Carrier recruitment areas.
  return Boolean(
    parentName.includes("carrierteamticket") ||
    parentName.includes("carrierapplication") ||
    parentName.includes("carrierrecruitment") ||
    (parentName.includes("carrier") && parentName.includes("application")) ||
    (parentName.includes("carrier") && parentName.includes("recruitment"))
  );
}

function nameLooksLikeApplicationTicket(channel) {
  const channelName = normalize(channel?.name || "");
  return Boolean(
    channelName.startsWith("duckrequest") ||
    channelName.includes("carrierapplication") ||
    channelName.includes("carrierapplicant") ||
    channelName.includes("carrierinterview") ||
    channelName.startsWith("carrierapp")
  );
}

function topicLooksLikeApplicationTicket(channel) {
  const topic = normalize(channel?.topic || "");
  return Boolean(
    topic.includes("carrierapplication") ||
    topic.includes("carrierteamapplication") ||
    topic.includes("carrierrecruitment") ||
    topic.includes("carrierapplicant")
  );
}

function isKnownFalsePositiveArea(channel) {
  const parentName = normalize(channel?.parent?.name || "");
  return Boolean(
    parentName.includes("supportticket") ||
    parentName.includes("ticketv2test") ||
    parentName.includes("test") ||
    parentName.includes("demo")
  );
}

async function looksLikeLegacyApplicationTicket(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;

  const channelName = normalize(channel.name);
  if (!channelName || PERMANENT_CHANNEL_NAMES.has(channelName)) return false;

  const parentRelevant = parentLooksLikeCarrierRecruitment(channel);
  if (!parentRelevant) return false;

  // Every old duck-request-* channel under Carrier Team Tickets is a legacy
  // Carrier Team application ticket. Other Carrier recruitment categories need
  // either an application-looking channel name or application topic.
  const parentName = normalize(channel.parent?.name || "");
  if (parentName.includes("carrierteamticket")) return true;

  return nameLooksLikeApplicationTicket(channel) || topicLooksLikeApplicationTicket(channel);
}

function closeRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CLOSE_ID)
      .setLabel(disabled ? "Closing Application Ticket..." : "Close Application Ticket")
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

function canCloseApplicationTicket(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;

  return interaction.member?.roles?.cache?.some((role) =>
    STAFF_ROLE_NAMES.has(normalize(role.name)),
  ) || false;
}

async function sendCloseLog(interaction) {
  if (!process.env.MOD_LOG_CHANNEL_ID) return;

  const logChannel = await interaction.client.channels
    .fetch(process.env.MOD_LOG_CHANNEL_ID)
    .catch(() => null);
  if (!logChannel?.isTextBased?.()) return;

  const embed = new EmbedBuilder()
    .setColor(0xdc2626)
    .setTitle("🔒 Legacy Carrier Application Ticket Closed")
    .setDescription([
      `**Ticket:** #${interaction.channel?.name || interaction.channelId}`,
      `**Channel ID:** \`${interaction.channelId}\``,
      `**Closed by:** <@${interaction.user.id}>`,
      "**Reason:** Legacy Carrier Team application ticket manually closed.",
    ].join("\n"))
    .setFooter({ text: "The Carry Tavern • Carrier Recruitment" })
    .setTimestamp();

  await logChannel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}

async function handleCarrierApplicationTicketClose(interaction) {
  if (!interaction.isButton() || interaction.customId !== CLOSE_ID) return false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!(await looksLikeLegacyApplicationTicket(interaction.channel))) {
    await interaction.editReply("❌ This is not recognised as a legacy Carrier Team application ticket.");
    return true;
  }

  if (!canCloseApplicationTicket(interaction)) {
    await interaction.editReply("❌ Only Carrier Recruitment management or staff with Manage Channels can close this application ticket.");
    return true;
  }

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [closeRow(true)] }).catch(() => {});
  }

  await sendCloseLog(interaction).catch(() => {});
  await interaction.editReply("🔒 This legacy Carrier application ticket will close in **10 seconds**.");

  const channel = interaction.channel;
  setTimeout(() => {
    channel?.delete?.(`Legacy Carrier application ticket closed by ${interaction.user.tag}`).catch((error) => {
      console.warn(`[CARRIER APPLICATION TICKET] Could not delete #${channel?.name || channel?.id}: ${error.message}`);
    });
  }, 10_000).unref?.();

  return true;
}

async function ensureCarrierApplicationClosePanel(channel) {
  if (!(await looksLikeLegacyApplicationTicket(channel)) || !channel.isTextBased?.()) return false;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (messages?.some((message) => message.author?.id === channel.client.user.id && hasCloseButton(message))) {
    return false;
  }

  await channel.send({
    content: [
      "🔒 **Legacy Carrier Application Ticket Controls**",
      "Carrier Recruitment management can close this old application ticket here.",
    ].join("\n"),
    components: [closeRow(false)],
    allowedMentions: { parse: [] },
  });

  return true;
}

async function removeStrayClosePanels(channel) {
  if (!channel?.isTextBased?.()) return 0;

  const messages = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!messages) return 0;

  let removed = 0;
  for (const message of messages.values()) {
    if (message.author?.id !== channel.client.user.id || !hasCloseButton(message)) continue;

    try {
      await message.delete();
      removed += 1;
      console.log(
        `[CARRIER APPLICATION TICKET] Removed stray close panel from #${channel.name} under ${channel.parent?.name || "no category"}.`,
      );
    } catch (error) {
      console.warn(
        `[CARRIER APPLICATION TICKET] Could not remove stray panel from #${channel.name}: ${error.message}`,
      );
    }
  }

  return removed;
}

async function retrofitCarrierApplicationTicketClosePanels(client) {
  if (!process.env.GUILD_ID) return { checked: 0, added: 0, removed: 0, matched: [] };

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return { checked: 0, added: 0, removed: 0, matched: [] };

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return { checked: 0, added: 0, removed: 0, matched: [] };

  let checked = 0;
  let added = 0;
  let removed = 0;
  const matched = [];

  for (const channel of channels.values()) {
    if (!channel || channel.type !== ChannelType.GuildText) continue;

    let legacy = false;
    try {
      legacy = await looksLikeLegacyApplicationTicket(channel);
    } catch (error) {
      console.warn(`[CARRIER APPLICATION TICKET] Could not inspect #${channel?.name || channel?.id}: ${error.message}`);
      continue;
    }

    if (!legacy) {
      // Clean the false-positive panels created by the previous broad detector.
      if (isKnownFalsePositiveArea(channel)) {
        removed += await removeStrayClosePanels(channel);
      }
      continue;
    }

    checked += 1;
    matched.push(channel.name);
    console.log(
      `[CARRIER APPLICATION TICKET] Matched legacy ticket #${channel.name} under ${channel.parent?.name || "no category"}.`,
    );

    try {
      if (await ensureCarrierApplicationClosePanel(channel)) added += 1;
    } catch (error) {
      console.warn(`[CARRIER APPLICATION TICKET] Could not retrofit #${channel?.name || channel?.id}: ${error.message}`);
    }
  }

  return { checked, added, removed, matched };
}

module.exports = {
  CLOSE_ID,
  looksLikeLegacyApplicationTicket,
  ensureCarrierApplicationClosePanel,
  handleCarrierApplicationTicketClose,
  retrofitCarrierApplicationTicketClosePanels,
};
