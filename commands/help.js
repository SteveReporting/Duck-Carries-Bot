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
    text: "Choose a section below. The bot now combines carries, Carrier tools, Roblox verification, trading, moderation and Tavern platform features.",
  },
  carries: {
    title: "⚔️ Carries & Queue",
    text: [
      "`/queue request` - request 1-15 runs using dungeon autocomplete.",
      "`/queue view` - grouped queue, priority and estimated wait time.",
      "`/queue cancel` - cancel your request when allowed.",
      "Carry tickets require both Carrier and requester confirmation.",
      "Unclaimed requests time out after 24 hours.",
      "The request panel can also be created with `/panel`.",
    ].join("\n"),
  },
  carrier: {
    title: "🍻 Carrier Tools",
    text: [
      "`/carrier available` / `/carrier unavailable` - control smart-match DMs.",
      "`/carrier session-start` - focus on one dungeon + difficulty.",
      "`/carrier session-end` - end the focused session.",
      "`/carrier profile` - ratings, stats, no-shows and dungeon permissions.",
      "`/leaderboard` - daily, weekly, monthly and all-time Carrier boards.",
      "Staff: `/carrier-admin` manages allowed/denied dungeons.",
    ].join("\n"),
  },
  roblox: {
    title: "🟥 Roblox & Onboarding",
    text: [
      "`/onboarding guide` - your server unlock checklist.",
      "`/roblox link` - connect a Roblox username.",
      "`/roblox verify` - verify through your Roblox About code.",
      "`/roblox profile` - view a linked Roblox/Tavern profile card.",
      "Verified members have their server nickname synced to their Roblox username.",
    ].join("\n"),
  },
  trade: {
    title: "💰 Trading & Reputation",
    text: [
      "`/marketplace` - marketplace listings, offers and watchlist.",
      "`/trade rate` - leave 1-5 star feedback after a trade.",
      "`/trade reputation` - view a trader's reputation.",
      "`/report scam` - report suspected scamming.",
      "`/report dispute` - open a trade dispute for staff review.",
    ].join("\n"),
  },
  community: {
    title: "🏆 Tavern & Community",
    text: [
      "`/tavern profile` - your Tavern platform profile.",
      "`/tavern events` - events and Event channel feed.",
      "`/tavern announcements` - important announcements.",
      "`/tavern status` - platform status.",
      "`/stats` - legacy carry statistics.",
      "`/leaderboard` - Carrier leaderboard.",
    ].join("\n"),
  },
  staff: {
    title: "🛡️ Staff & Safety",
    text: [
      "`/warn add/list/remove` - staff warning system.",
      "`/carrier-admin` - Carrier dungeon permissions.",
      "`/report resolve` - close reviewed disputes.",
      "Anti-abuse monitoring combines repeated no-shows, claim releases, warnings, request bursts and reports into staff-only flags.",
      "`/ai` - controlled Tavern AI management tools for authorised managers.",
    ].join("\n"),
  },
  treasury: {
    title: "🏦 Treasury",
    text: [
      "`/treasury-setup` - Treasury configuration.",
      "`/treasury-admin` - Treasury management.",
      "`/treasury-close` - close Treasury flows.",
      "Website Treasury pages handle loans, donations and item records.",
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
        { label: "Roblox & Onboarding", value: "roblox", emoji: "🟥" },
        { label: "Trading & Reputation", value: "trade", emoji: "💰" },
        { label: "Tavern & Community", value: "community", emoji: "🏆" },
        { label: "Treasury", value: "treasury", emoji: "🏦" },
        { label: "Staff & Safety", value: "staff", emoji: "🛡️" },
      ),
  );
}

function embedFor(section) {
  const item = HELP[section] || HELP.home;
  return new EmbedBuilder()
    .setTitle(item.title)
    .setDescription(item.text)
    .setFooter({ text: "The Carry Tavern • use the menu to switch sections" });
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
