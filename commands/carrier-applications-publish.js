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

const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdIT98g11GKA2uJ9iTDGrOIHgK3FNrj-oo94g56JJBws8S-rQ/viewform";
const RECRUITMENT_SOP_URL = "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk";

const PUBLIC_TAG = "CARRIER-APPLICATIONS-PUBLIC-V3";
const REVIEW_TAG = "CARRIER-APPLICATIONS-STAFF-V3";

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

async function removePrevious(channel, tags) {
  const markers = tags.map((tag) => `The Carry Tavern • ${tag}`);
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return 0;
  let removed = 0;
  for (const message of recent.values()) {
    if (message.author.id !== channel.client.user.id) continue;
    if (!message.embeds.some((embed) => markers.includes(embed.footer?.text))) continue;
    await message.delete().catch(() => {});
    removed += 1;
  }
  return removed;
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
        "Google Forms and Sheets now stay in the background. Reviewers should use the Discord review console so applicant answers, scoring, private notes and decisions are handled in one place.",
        "",
        "### 🔎 Open a Review",
        "Run **`/carrier-app-review`** in this channel.",
        "",
        "The private console gives you:",
        "• an applicant dropdown",
        "• the applicant's exact Google Form answers inside Discord",
        "• Previous / Next pages for long applications",
        "• a grading popup",
        "• private notes and decision reasoning",
        "• Accept / Trial / Interview / Deny controls",
        "• automatic save-back to the Staff Review sheet and Review History",
        "",
        "### 📊 Application Scoring • /20",
        "**Capability** /5 • **Reliability & Activity** /4 • **Communication** /3",
        "**Attitude & Maturity** /3 • **Dungeon Quest Knowledge** /3 • **Application Effort** /2",
        "",
        "**17–20** Strong Accept • **14–16** Accept / Trial • **11–13** Interview • **0–10** Normally Deny",
        "",
        "Applicant answers are read-only. Staff notes and review decisions remain private to authorised recruitment staff.",
      ].join("\n"),
      REVIEW_TAG,
    )],
    components: [row(
      linkButton("Live Application Form", FORM_URL, "📝"),
      linkButton("Recruitment SOP", RECRUITMENT_SOP_URL, "📚"),
    )],
    allowedMentions: { parse: [] },
  };
}

async function publishOne(channel, payload, currentTag, oldTag, reason) {
  await removePrevious(channel, [currentTag, oldTag]);
  const message = await channel.send(payload);
  await message.pin(reason).catch(() => {});
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-applications-publish")
    .setDescription("Publish the Carrier application and Discord review system panels"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canRun(interaction)) return interaction.editReply("❌ You do not have permission to publish the Carrier application system.");

    try {
      const guild = interaction.guild;
      const category = findCarrierCategory(guild);
      if (!category) throw new Error("Could not find the exact 🍺・CARRIER TEAM category.");

      const publicChannel = findChannel(guild, category, PUBLIC_CHANNEL);
      const reviewChannel = findChannel(guild, category, REVIEW_CHANNEL);
      if (!publicChannel) throw new Error("Could not find 🥚・become-a-carrier inside Carrier Team.");
      if (!reviewChannel) throw new Error("Could not find 📋・application-reviews inside Carrier Team.");

      const reason = `Carrier application system publish by ${interaction.user.tag}`;
      const publicMessage = await publishOne(publicChannel, publicPayload(), PUBLIC_TAG, "CARRIER-APPLICATIONS-PUBLIC-V2", reason);
      const reviewMessage = await publishOne(reviewChannel, reviewPayload(), REVIEW_TAG, "CARRIER-APPLICATIONS-STAFF-V2", reason);

      return interaction.editReply([
        "✅ **Carrier application system published**",
        "",
        `Public applications: ${publicChannel} • ${publicMessage.url}`,
        `Staff reviews: ${reviewChannel} • ${reviewMessage.url}`,
        "",
        "Staff reviews now happen in Discord through `/carrier-app-review`. Google Sheets is backend-only.",
        "Carrier News and unrelated Carrier channels were not touched.",
      ].join("\n"));
    } catch (error) {
      console.error("[CARRIER APPLICATIONS PUBLISH]", error);
      return interaction.editReply(`❌ Publish failed: ${error.message || "Unknown error"}`.slice(0, 1900));
    }
  },
};
