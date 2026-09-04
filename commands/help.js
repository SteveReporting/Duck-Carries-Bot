const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const FOOTER = "The Carry Tavern • Help Center";

const HELP = {
  home: {
    title: "🍺 The Carry Tavern",
    text: [
      "The bot is built around **panels and buttons first**. Commands are there when you need precision, not because you should have to memorise them.",
      "",
      "**Start here:** use the Tavern Command Center for carries, your active sessions, Carrier tools and Support.",
      "",
      "Choose a section below for the small set of commands worth remembering.",
    ].join("\n"),
  },
  carries: {
    title: "⚔️ Carries",
    text: [
      "**Normal member flow:** **Request Carry → get matched → private ticket → ready check → carry → automatic completion/progress.**",
      "",
      "`/queue view` — live operations board",
      "`/queue request` — precision carry request",
      "`/queue active` — active/recovered Carrier claims",
      "`/queue cancel` — cancel your request",
      "`/queue noshow` — report a no-show",
      "",
      "Most people should simply use **Request Carry** from the main panel.",
    ].join("\n"),
  },
  carrier: {
    title: "🍻 Carrier Desk",
    text: [
      "**Carrier flow:** **Available → choose queue group → choose run batch → private session → complete.**",
      "",
      "`/carrier available` — enter smart matching",
      "`/carrier unavailable` — stop new matches",
      "`/carrier profile` — service time, ratings and permissions",
      "`/leaderboard` — Carrier rankings",
      "",
      "Staff configuration lives under `/carrier-admin` so normal Carriers never see admin clutter.",
    ].join("\n"),
  },
  marketplace: {
    title: "💰 Marketplace",
    text: [
      "`/marketplace search` — find listings",
      "`/marketplace add` — create a listing",
      "`/marketplace mine` — manage your listings",
      "`/marketplace offers` — manage offers",
      "`/marketplace reputation` — view trade reputation",
      "",
      "Scams and disputes go through `/report` so marketplace moderation stays separate from normal trading.",
    ].join("\n"),
  },
  account: {
    title: "🏆 Tavern Account",
    text: [
      "`/tavern profile` — your Tavern profile",
      "`/tavern status` — platform status",
      "`/tavern roblox-sync` — refresh Roblox identity from Bloxlink",
      "`/tavern roblox-profile` — view a member's Roblox/Tavern profile",
    ].join("\n"),
  },
  treasury: {
    title: "🏦 Treasury",
    text: [
      "`/treasury stock` — browse current stock",
      "`/treasury close` — close a resolved Treasury case",
      "",
      "Administrative stock/trust controls stay nested under `/treasury admin`.",
    ].join("\n"),
  },
  staff: {
    title: "🛡️ Staff Operations",
    text: [
      "`/warn` — moderation warnings",
      "`/report` — reports and disputes",
      "`/carrier-admin` — Carrier department controls",
      "`/security` — standalone anti-raid/security controls",
      "`/botfix` — owner emergency repair",
      "",
      "The goal is deliberate: **few top-level commands, deep controls only where staff need them.**",
    ].join("\n"),
  },
};

function menu(section = "home") {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_section")
      .setPlaceholder("Choose a help section")
      .addOptions(
        { label: "Carries", value: "carries", emoji: "⚔️", default: section === "carries" },
        { label: "Carrier Desk", value: "carrier", emoji: "🍻", default: section === "carrier" },
        { label: "Marketplace", value: "marketplace", emoji: "💰", default: section === "marketplace" },
        { label: "Tavern Account", value: "account", emoji: "🏆", default: section === "account" },
        { label: "Treasury", value: "treasury", emoji: "🏦", default: section === "treasury" },
        { label: "Staff Operations", value: "staff", emoji: "🛡️", default: section === "staff" },
      ),
  );
}

function embedFor(section) {
  const item = HELP[section] || HELP.home;
  return new EmbedBuilder()
    .setColor(0xf2b705)
    .setAuthor({ name: "THE CARRY TAVERN • HELP CENTER" })
    .setTitle(item.title)
    .setDescription(item.text)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

async function handleHelpComponent(interaction) {
  if (interaction.isButton() && interaction.customId === "tavern_help_open") {
    await interaction.reply({
      embeds: [embedFor("home")],
      components: [menu("home")],
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!interaction.isStringSelectMenu() || interaction.customId !== "help_section") return false;
  const section = interaction.values?.[0] || "home";
  await interaction.update({ embeds: [embedFor(section)], components: [menu(section)] });
  return true;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Open The Carry Tavern help center"),
  handleHelpComponent,
  embedFor,
  menu,
  async execute(interaction) {
    return interaction.reply({
      embeds: [embedFor("home")],
      components: [menu("home")],
      flags: MessageFlags.Ephemeral,
    });
  },
};
