const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { marketplaceBaseUrl } = require("../platform/helpers");

const FOOTER = "The Carry Tavern • Operations Hub";

function buildPanel() {
  const embed = new EmbedBuilder()
    .setColor(0xf2b705)
    .setAuthor({ name: "THE CARRY TAVERN • OPERATIONS" })
    .setTitle("🍺 Tavern Command Center")
    .setDescription([
      "Everything members and Carriers need, without a wall of commands.",
      "",
      "### ⚔️ Carries",
      "Request a carry in one popup, check the live queue, or open your personal carry dashboard.",
      "",
      "### 🍻 Carriers",
      "Claim compatible queue groups, manage active sessions and let the system handle tickets, ready checks, progress and cleanup.",
      "",
      "### 🛟 Support",
      "Open a private support case directly from this panel.",
      "",
      "**The complicated systems stay underneath. The buttons stay simple.**",
    ].join("\n"))
    .addFields(
      { name: "Queue", value: "Smart grouped matching", inline: true },
      { name: "Tickets", value: "Automatic private sessions", inline: true },
      { name: "Status", value: "🟢 Operational", inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  const primary = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("carry_request_start_v4")
      .setLabel("Request Carry")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("premium_queue_open")
      .setLabel("Live Queue")
      .setEmoji("📡")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("premium_my_carries")
      .setLabel("My Carries")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("support_ticket_open")
      .setLabel("Support")
      .setEmoji("🛟")
      .setStyle(ButtonStyle.Secondary),
  );

  const secondary = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_carrier_desk")
      .setLabel("Carrier Desk")
      .setEmoji("🍻")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("tavern_help_open")
      .setLabel("Help")
      .setEmoji("❓")
      .setStyle(ButtonStyle.Secondary),
  );

  const base = marketplaceBaseUrl();
  if (base) {
    secondary.addComponents(
      new ButtonBuilder()
        .setLabel("Marketplace")
        .setEmoji("💰")
        .setStyle(ButtonStyle.Link)
        .setURL(`${base}/marketplace`),
    );
  }

  return { embeds: [embed], components: [primary, secondary] };
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Publish The Carry Tavern operations hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  buildPanel,

  async execute(interaction) {
    await interaction.reply(buildPanel());
    const message = await interaction.fetchReply().catch(() => null);
    if (message) {
      await message.pin("Permanent Carry Tavern operations hub").catch(() => {});
    }
  },
};
