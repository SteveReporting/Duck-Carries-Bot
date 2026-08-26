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
const REVIEW_SHEET_URL = "https://docs.google.com/spreadsheets/d/1RvkYMyIjT7SGbu4nq5Pnqk2p2r6MnWLdXH17r1VI0fU/edit#gid=206972658";
const STAFF_REVIEW_URL = "https://docs.google.com/spreadsheets/d/1RvkYMyIjT7SGbu4nq5Pnqk2p2r6MnWLdXH17r1VI0fU/edit#gid=2128408041";
const REVIEW_HISTORY_URL = "https://docs.google.com/spreadsheets/d/1RvkYMyIjT7SGbu4nq5Pnqk2p2r6MnWLdXH17r1VI0fU/edit#gid=1934649437";
const RECRUITMENT_SOP_URL = "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk";

const PUBLIC_TAG = "CARRIER-APPLICATIONS-PUBLIC-V2";
const REVIEW_TAG = "CARRIER-APPLICATIONS-STAFF-V2";

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
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.parentId === category.id &&
      normalize(channel.name) === normalizedName,
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

async function removePrevious(channel, tag) {
  const marker = `The Carry Tavern • ${tag}`;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return 0;

  let removed = 0;
  for (const message of recent.values()) {
    if (message.author.id !== channel.client.user.id) continue;
    if (!message.embeds.some((embed) => embed.footer?.text === marker)) continue;
    await message.delete().catch(() => {});
    removed += 1;
  }
  return removed;
}

function publicPayload() {
  const embed = baseEmbed(
    "⚔️ Carrier Team Applications",
    [
      "Applications are now open for **The Carry Tavern Carrier Team**.",
      "",
      "Our Carriers provide **completely free Dungeon Quest carries** to members of the Tavern. We are looking for people who are capable, reliable, mature, helpful and willing to work as part of an organised team.",
      "",
      "### 📋 Recruitment Process",
      "`Application → Review → Interview if required → Trainee Carrier → Training → Practical Assessment → 7-Day Probation → Full Carrier`",
      "",
      "### 🍺 Before You Apply",
      "• Give truthful and detailed answers.",
      "• Use your correct Discord User ID and Roblox username.",
      "• Be realistic about which dungeons you can reliably carry.",
      "• You must be willing to complete training and a practical assessment.",
      "• Do not repeatedly DM management asking for your application to be reviewed.",
      "",
      "### 💰 Free Carry Policy",
      "Official Tavern carries are **100% free**. Carriers may never demand Robux, gold, items, gifts or any other payment for an official carry.",
      "",
      "Your application will be reviewed by Carrier Recruitment. If successful, you will enter the Trainee Carrier process rather than receiving the full Carrier role immediately.",
    ].join("\n"),
    PUBLIC_TAG,
  );

  return {
    embeds: [embed],
    components: [
      row(
        linkButton("Apply for Carrier Team", FORM_URL, "📝"),
        linkButton("Recruitment Process", RECRUITMENT_SOP_URL, "📚"),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

function reviewPayload() {
  const embed = baseEmbed(
    "📋 Carrier Recruitment Review Centre",
    [
      "This channel is the private staff workspace for reviewing **Carrier Team applications**.",
      "",
      "Every submitted Google Form application is recorded in the Carrier Applications workbook. Applications receive an ID such as `APP-2026-0001`, and the original answers remain separate from staff scoring and notes.",
      "",
      "### 🔎 Review Workflow",
      "1. Open the **Review Panel**.",
      "2. Select or enter the applicant's `APP-...` ID.",
      "3. Read the applicant's full Form answers before scoring.",
      "4. Score each category using the agreed rubric.",
      "5. Add private notes and final reasoning.",
      "6. Set the decision and next action.",
      "7. Keep important changes documented in Review History.",
      "",
      "### 📊 Application Scoring • /20",
      "**Capability** /5",
      "**Reliability & Activity** /4",
      "**Communication** /3",
      "**Attitude & Maturity** /3",
      "**Dungeon Quest Knowledge** /3",
      "**Application Effort** /2",
      "",
      "**17–20** • Strong Accept",
      "**14–16** • Accept / Trial",
      "**11–13** • Interview / Further Review",
      "**0–10** • Normally Deny",
      "",
      "### 🔐 Review Standards",
      "Applicant answers must not be altered. Staff notes, concerns and internal reasoning stay private. A high score does not force acceptance if there is a documented conduct, honesty or suitability concern.",
    ].join("\n"),
    REVIEW_TAG,
  );

  return {
    embeds: [embed],
    components: [
      row(
        linkButton("Open Review Panel", REVIEW_SHEET_URL, "📋"),
        linkButton("Staff Review Table", STAFF_REVIEW_URL, "📊"),
        linkButton("Review History", REVIEW_HISTORY_URL, "🗃️"),
      ),
      row(
        linkButton("Live Application Form", FORM_URL, "📝"),
        linkButton("Recruitment SOP", RECRUITMENT_SOP_URL, "📚"),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

async function publishOne(channel, payload, tag, reason) {
  await removePrevious(channel, tag);
  const message = await channel.send(payload);
  await message.pin(reason).catch(() => {});
  return message;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-applications-publish")
    .setDescription("Publish the final Carrier application and recruitment review panels"),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!canRun(interaction)) {
      return interaction.editReply("❌ You do not have permission to publish the Carrier application system.");
    }

    try {
      const guild = interaction.guild;
      const category = findCarrierCategory(guild);
      if (!category) throw new Error("Could not find the exact 🍺・CARRIER TEAM category.");

      const publicChannel = findChannel(guild, category, PUBLIC_CHANNEL);
      const reviewChannel = findChannel(guild, category, REVIEW_CHANNEL);

      if (!publicChannel) throw new Error("Could not find 🥚・become-a-carrier inside the Carrier Team category.");
      if (!reviewChannel) throw new Error("Could not find 📋・application-reviews inside the Carrier Team category.");

      const reason = `Final Carrier application system publish by ${interaction.user.tag}`;

      const publicMessage = await publishOne(publicChannel, publicPayload(), PUBLIC_TAG, reason);
      const reviewMessage = await publishOne(reviewChannel, reviewPayload(), REVIEW_TAG, reason);

      return interaction.editReply([
        "✅ **Carrier application system published**",
        "",
        `Public applications: ${publicChannel} • ${publicMessage.url}`,
        `Staff reviews: ${reviewChannel} • ${reviewMessage.url}`,
        "",
        "Only those two Carrier Department channels were touched. Carrier News and unrelated webhook posts were not changed.",
      ].join("\n"));
    } catch (error) {
      console.error("[CARRIER APPLICATIONS PUBLISH]", error);
      return interaction.editReply(`❌ Publish failed: ${error.message || "Unknown error"}`.slice(0, 1900));
    }
  },
};
