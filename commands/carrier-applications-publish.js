const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const CATEGORY_NORMALIZED = "carrierteam";
const PUBLIC_CHANNEL = "becomeacarrier";
const REVIEW_CHANNEL = "applicationreviews";
const GOLD = 0xF2B705;
const WEBHOOK_NAME = "The Carry Tavern";

const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdIT98g11GKA2uJ9iTDGrOIHgK3FNrj-oo94g56JJBws8S-rQ/viewform";
const RECRUITMENT_SOP_URL = "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk";

const PUBLIC_TAG = "CARRIER-APPLICATIONS-PUBLIC-V4";
const REVIEW_TAG = "CARRIER-APPLICATIONS-STAFF-V5";
const PREVIOUS_PUBLIC_TAGS = [
  "CARRIER-APPLICATIONS-PUBLIC-V2",
  "CARRIER-APPLICATIONS-PUBLIC-V3",
];
const PREVIOUS_REVIEW_TAGS = [
  "CARRIER-APPLICATIONS-STAFF-V2",
  "CARRIER-APPLICATIONS-STAFF-V3",
  "CARRIER-APPLICATIONS-STAFF-V4",
];

const LEGACY_PUBLIC_FOOTER = "The Carry Tavern • Carrier Department • channel-become-v1";
const LEGACY_REVIEW_FOOTER = "The Carry Tavern • Carrier Department • channel-app-reviews-v1";

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function canRun(interaction) {
  if (!interaction.inGuild()) return false;
  return interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    Boolean(process.env.AI_MANAGER_ROLE_ID && interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID));
}

function findCarrierCategory(guild) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && normalize(channel.name) === CATEGORY_NORMALIZED,
  ) || null;
}

function findChannel(guild, category, normalizedName) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.parentId === category.id && normalize(channel.name) === normalizedName,
  ) || null;
}

function linkButton(label, url, emoji) {
  const button = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) button.setEmoji(emoji);
  return button;
}

function reviewButton() {
  return new ButtonBuilder()
    .setCustomId("carrier_review_open")
    .setStyle(ButtonStyle.Primary)
    .setLabel("Open Review Panel")
    .setEmoji("📋");
}

function row(...buttons) {
  return new ActionRowBuilder().addComponents(...buttons);
}

function baseEmbed(title, description, tag) {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER DEPARTMENT" })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: `The Carry Tavern • ${tag}` })
    .setTimestamp();
}

async function removePrevious(channel, currentTag, previousTags, legacyFooter) {
  const acceptedFooters = new Set([
    `The Carry Tavern • ${currentTag}`,
    ...previousTags.map((tag) => `The Carry Tavern • ${tag}`),
    legacyFooter,
  ]);

  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return 0;

  let removed = 0;
  for (const message of recent.values()) {
    const footer = message.embeds.find((embed) => embed.footer?.text)?.footer?.text || "";
    if (!acceptedFooters.has(footer)) continue;

    const isBotMessage = message.author.id === channel.client.user.id;
    const isWebhookMessage = Boolean(message.webhookId);
    if (!isBotMessage && !isWebhookMessage) continue;

    await message.delete().catch(() => {});
    removed += 1;
  }

  return removed;
}

async function existingBrandedWebhook(channel) {
  const webhooks = await channel.fetchWebhooks().catch(() => null);
  if (!webhooks) return null;

  return webhooks.find((webhook) =>
    webhook.name === WEBHOOK_NAME &&
    webhook.owner?.id === channel.client.user.id,
  ) || null;
}

async function sendBranded(channel, payload, { forceBot = false } = {}) {
  if (!forceBot) {
    const webhook = await existingBrandedWebhook(channel);
    if (webhook) {
      const message = await webhook.send(payload);
      return { message, via: "webhook" };
    }
  }

  const message = await channel.send(payload);
  return { message, via: "bot" };
}

function publicPayload() {
  return {
    embeds: [baseEmbed(
      "⚔️ Carrier Team Applications",
      [
        "Applications are open for **The Carry Tavern Carrier Team**.",
        "",
        "Our Carriers provide completely free Dungeon Quest carries. We are looking for people who are capable, reliable, mature, helpful and willing to work as part of an organised team.",
        "",
        "### 📋 Recruitment Process",
        "`Application → Review → Interview if required → Trainee Carrier → Training → Practical Assessment → 7-Day Probation → Full Carrier`",
        "",
        "### 🍺 Before You Apply",
        "• Give truthful and detailed answers.",
        "• Use your correct Discord User ID and Roblox username.",
        "• Be realistic about which dungeons you can reliably carry.",
        "• You must be willing to complete training and a practical assessment.",
        "• Do not repeatedly DM management asking for a review.",
        "",
        "### 💰 Free Carry Policy",
        "Official Tavern carries are **100% free**. Carriers may never demand Robux, gold, items, gifts or any other payment for an official carry.",
      ].join("\n"),
      PUBLIC_TAG,
    )],
    components: [row(
      linkButton("Apply for Carrier Team", FORM_URL, "📝"),
      linkButton("Recruitment Process", RECRUITMENT_SOP_URL, "📚"),
    )],
    allowedMentions: { parse: [] },
  };
}

function reviewPayload() {
  return {
    embeds: [baseEmbed(
      "📋 Carrier Recruitment Review Centre",
      [
        "This channel is the private workspace for **Carrier Recruitment staff**.",
        "",
        "Google Forms and Sheets stay in the background. Reviewers use the Discord review console so applicant answers, scoring, private notes and decisions are handled in one place.",
        "",
        "### 🔎 Review Applications",
        "Click **Open Review Panel** below. The bot will open a private review console visible only to you.",
        "",
        "The private review console includes:",
        "• Applicant dropdown with current applications",
        "• Exact Google Form answers displayed inside Discord",
        "• Previous / Next pages for long applications",
        "• Grading controls for the full /20 rubric",
        "• Private staff notes and decision reasoning",
        "• Accept / Trial / Interview / Deny controls",
        "• Automatic save-back to Staff Review and Review History",
        "",
        "### 📊 Application Scoring • /20",
        "**Capability** /5 • **Reliability & Activity** /4 • **Communication** /3",
        "**Attitude & Maturity** /3 • **Dungeon Quest Knowledge** /3 • **Application Effort** /2",
        "",
        "**17-20** Strong Accept • **14-16** Accept / Trial • **11-13** Interview • **0-10** Normally Deny",
        "",
        "### 🔐 Staff Standard",
        "Applicant answers are read-only. Internal notes, scoring and decisions stay private to authorised recruitment staff. Always read the full application before making a final decision.",
      ].join("\n"),
      REVIEW_TAG,
    )],
    components: [
      row(
        reviewButton(),
        linkButton("Live Application Form", FORM_URL, "📝"),
        linkButton("Recruitment SOP", RECRUITMENT_SOP_URL, "📚"),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

async function publishOne(channel, payload, currentTag, previousTags, legacyFooter, reason, options = {}) {
  await removePrevious(channel, currentTag, previousTags, legacyFooter);
  const sent = await sendBranded(channel, payload, options);
  await channel.messages.pin(sent.message.id, reason).catch(() => {});
  return sent;
}

async function publishCarrierApplicationPanels(guild, reason = "Carrier application system refresh") {
  const category = findCarrierCategory(guild);
  if (!category) throw new Error("Could not find the exact 🍺・CARRIER TEAM category.");

  const publicChannel = findChannel(guild, category, PUBLIC_CHANNEL);
  const reviewChannel = findChannel(guild, category, REVIEW_CHANNEL);
  if (!publicChannel) throw new Error("Could not find 🥚・become-a-carrier inside Carrier Team.");
  if (!reviewChannel) throw new Error("Could not find 📋・application-reviews inside Carrier Team.");

  const publicResult = await publishOne(
    publicChannel,
    publicPayload(),
    PUBLIC_TAG,
    PREVIOUS_PUBLIC_TAGS,
    LEGACY_PUBLIC_FOOTER,
    reason,
  );

  // Interactive custom-id buttons must be owned by the application. Use a bot
  // message for the review centre even when a branded channel webhook exists.
  const reviewResult = await publishOne(
    reviewChannel,
    reviewPayload(),
    REVIEW_TAG,
    PREVIOUS_REVIEW_TAGS,
    LEGACY_REVIEW_FOOTER,
    reason,
    { forceBot: true },
  );

  return {
    publicChannel,
    reviewChannel,
    publicMessage: publicResult.message,
    reviewMessage: reviewResult.message,
    publicVia: publicResult.via,
    reviewVia: reviewResult.via,
  };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-applications-publish")
    .setDescription("Publish the Carrier application and Discord review system panels"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canRun(interaction)) return interaction.editReply("❌ You do not have permission to publish the Carrier application system.");

    try {
      const result = await publishCarrierApplicationPanels(
        interaction.guild,
        `Carrier application system publish by ${interaction.user.tag}`,
      );

      return interaction.editReply([
        "✅ **Carrier application system published**",
        "",
        `Public applications: ${result.publicChannel} • ${result.publicMessage.url}`,
        `Staff reviews: ${result.reviewChannel} • ${result.reviewMessage.url}`,
        `Branding: public **${result.publicVia}** • reviews **${result.reviewVia}**`,
        "",
        "Staff can click **Open Review Panel** directly in the review channel. `/carrier-app-review` remains available as a backup.",
        "Google Sheets is backend-only. Old application-review posts were removed. Carrier News and unrelated channels were not touched.",
      ].join("\n"));
    } catch (error) {
      console.error("[CARRIER APPLICATIONS PUBLISH]", error);
      return interaction.editReply(`❌ Publish failed: ${error.message || "Unknown error"}`.slice(0, 1900));
    }
  },

  publishCarrierApplicationPanels,
};
