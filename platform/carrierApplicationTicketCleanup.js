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

function hasMemberSpecificOverwrite(channel) {
  return Boolean(
    channel?.permissionOverwrites?.cache?.some((overwrite) => Number(overwrite.type) === 1),
  );
}

function parentLooksLikeCarrierRecruitment(channel) {
  const parentName = normalize(channel?.parent?.name || "");
  return Boolean(
    parentName.includes("carrierteam") ||
    parentName.includes("carrierapplication") ||
    parentName.includes("carrierrecruitment") ||
    parentName.includes("applications") ||
    parentName.includes("recruitment") ||
    parentName.includes("applicant")
  );
}

function nameLooksLikeApplicationTicket(channel) {
  const channelName = normalize(channel?.name || "");
  return Boolean(
    channelName.includes("carrierapplication") ||
    channelName.includes("application") ||
    channelName.includes("applicant") ||
    channelName.includes("interview") ||
    channelName.startsWith("carrierapp") ||
    channelName.startsWith("app") ||
    channelName.startsWith("ticket")
  );
}

function topicLooksLikeApplicationTicket(channel) {
  const topic = normalize(channel?.topic || "");
  return Boolean(
    topic.includes("carrierapplication") ||
    topic.includes("carrierteamapplication") ||
    topic.includes("applicationticket") ||
    topic.includes("applicant") ||
    topic.includes("carrierrecruitment") ||
    topic.includes("interview")
  );
}

function messageText(message) {
  const parts = [message?.content || ""];

  for (const embed of message?.embeds || []) {
    parts.push(embed.title || "", embed.description || "", embed.footer?.text || "");
    for (const field of embed.fields || []) {
      parts.push(field.name || "", field.value || "");
    }
  }

  return normalize(parts.join(" "));
}

function historyLooksLikeCarrierApplication(messages) {
  if (!messages) return false;

  const combined = [...messages.values()]
    .map(messageText)
    .join("");

  return Boolean(
    combined.includes("carrierteamapplication") ||
    combined.includes("carrierapplication") ||
    combined.includes("applyforcarrier") ||
    combined.includes("applyingforcarrier") ||
    combined.includes("carrierapplicant") ||
    combined.includes("carrierrecruitment") ||
    combined.includes("whywouldyouliketobeacarrier") ||
    combined.includes("whydoyouwanttobeacarrier") ||
    combined.includes("carrierapplicationticket")
  );
}

async function looksLikeLegacyApplicationTicket(channel) {
  if (!channel || channel.type !== ChannelType.GuildText) return false;

  const channelName = normalize(channel.name);
  if (!channelName || PERMANENT_CHANNEL_NAMES.has(channelName)) return false;

  const memberSpecific = hasMemberSpecificOverwrite(channel);
  const parentRelevant = parentLooksLikeCarrierRecruitment(channel);
  const nameRelevant = nameLooksLikeApplicationTicket(channel);
  const topicRelevant = topicLooksLikeApplicationTicket(channel);

  // Normal legacy layouts: applicant/user-named private channels inside a Carrier
  // recruitment category, or explicitly named application/interview ticket channels.
  if ((parentRelevant && memberSpecific) ||
      (nameRelevant && (parentRelevant || memberSpecific)) ||
      (topicRelevant && (parentRelevant || memberSpecific))) {
    return true;
  }

  // Older ticket bots often named channels only after the applicant, and sometimes
  // moved them into generic ticket categories. For private/member-specific channels,
  // inspect recent ticket content for unmistakable Carrier application language.
  if (memberSpecific && channel.isTextBased?.()) {
    const messages = await channel.messages.fetch({ limit: 35 }).catch(() => null);
    if (historyLooksLikeCarrierApplication(messages)) return true;
  }

  return false;
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
    await interaction.editReply("❌ This is not recognised as a legacy Carrier application ticket.");
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

async function retrofitCarrierApplicationTicketClosePanels(client) {
  if (!process.env.GUILD_ID) return { checked: 0, added: 0, matched: [] };

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return { checked: 0, added: 0, matched: [] };

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return { checked: 0, added: 0, matched: [] };

  let checked = 0;
  let added = 0;
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

    if (!legacy) continue;
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

  return { checked, added, matched };
}

module.exports = {
  CLOSE_ID,
  looksLikeLegacyApplicationTicket,
  ensureCarrierApplicationClosePanel,
  handleCarrierApplicationTicketClose,
  retrofitCarrierApplicationTicketClosePanels,
};
