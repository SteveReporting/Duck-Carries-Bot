const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const HELP = {
  home: {
    title: "🍺 The Carry Tavern Help",
    text: "The command list has been cleaned up. Choose a section below to see the production commands that remain.",
  },
  carries: {
    title: "⚔️ Carries & Queue",
    text: [
      "`/queue request` - request a carry.",
      "`/queue view` - view the grouped live queue.",
      "`/queue active` - view/recover your active claims.",
      "`/queue claim` - claim a specific carry.",
      "`/queue start` - start a claimed carry.",
      "`/queue complete` - confirm completed runs.",
      "`/queue cancel` - cancel your own request.",
      "`/queue noshow` - report the other side after a claimed carry no-show.",
    ].join("\n"),
  },
  carrier: {
    title: "🍻 Carrier Tools",
    text: [
      "`/carrier available` / `/carrier unavailable` - control smart-match availability.",
      "`/carrier session-start` / `session-end` - manage a focused Carrier session.",
      "`/carrier profile` - ratings, service, permissions and no-show information.",
      "`/leaderboard` - Carrier rankings by timeframe and metric.",
      "Staff use `/carrier-admin` for permissions, role assignment, hierarchy and no-show summaries.",
    ].join("\n"),
  },
  marketplace: {
    title: "💰 Marketplace & Reputation",
    text: [
      "`/marketplace add` / `mine` / `remove` - manage your listings.",
      "`/marketplace search` - find active listings.",
      "`/marketplace offer` / `offers` - manage offers.",
      "`/marketplace watch` / `renew` - watch or renew listings.",
      "`/marketplace rate` - rate someone after a completed trade.",
      "`/marketplace reputation` - view trade reputation.",
      "`/report scam` / `dispute` - open a staff case.",
    ].join("\n"),
  },
  tavern: {
    title: "🏆 Tavern Account",
    text: [
      "`/tavern profile` - view your Tavern profile.",
      "`/tavern status` - view platform status.",
      "`/tavern roblox-sync` - sync your Roblox identity from Bloxlink.",
      "`/tavern roblox-profile` - view a member's Roblox + Tavern profile.",
    ].join("\n"),
  },
  treasury: {
    title: "🏦 Treasury",
    text: [
      "`/treasury stock` - browse Treasury stock.",
      "`/treasury close` - close a resolved Treasury ticket.",
      "Treasury staff: `/treasury admin view`, `/treasury admin trust`, `/treasury admin clear-scam`.",
    ].join("\n"),
  },
  staff: {
    title: "🛡️ Staff & Security",
    text: [
      "`/warn add` / `list` / `remove` - moderation warnings.",
      "`/report resolve` - resolve reviewed report cases.",
      "`/carrier-admin` - Carrier staff controls.",
      "`/security` - anti-raid, audit search, bot/app allowlist and lockdown controls.",
      "`/botfix` - owner-only emergency bot repair.",
    ].join("\n"),
  },
};

function menu() {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("help_section")
      .setPlaceholder("Choose a help section")
      .addOptions(
        { label: "Carries & Queue", value: "carries", emoji: "⚔️" },
        { label: "Carrier Tools", value: "carrier", emoji: "🍻" },
        { label: "Marketplace & Reputation", value: "marketplace", emoji: "💰" },
        { label: "Tavern Account", value: "tavern", emoji: "🏆" },
        { label: "Treasury", value: "treasury", emoji: "🏦" },
        { label: "Staff & Security", value: "staff", emoji: "🛡️" },
      ),
  );
}

function embedFor(section) {
  const item = HELP[section] || HELP.home;
  return new EmbedBuilder()
    .setTitle(item.title)
    .setDescription(item.text)
    .setFooter({ text: "The Carry Tavern • cleaned production command set" });
}

async function handleHelpComponent(interaction) {
  if (!interaction.isStringSelectMenu() || interaction.customId !== "help_section") return false;
  const section = interaction.values?.[0] || "home";
  await interaction.update({ embeds: [embedFor(section)], components: [menu()] });
  return true;
}

module.exports = {
  data: new SlashCommandBuilder().setName("help").setDescription("Interactive guide to The Carry Tavern bot"),
  handleHelpComponent,
  async execute(interaction) {
    return interaction.reply({ embeds: [embedFor("home")], components: [menu()], flags: MessageFlags.Ephemeral });
  },
};
