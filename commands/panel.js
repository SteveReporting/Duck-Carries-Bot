const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
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
      "Request in one popup, watch the live queue, wait in the optional VC, or drop into a compatible carry that is already running.",
      "",
      "### 🔊 Session Automation",
      "Claimed carries get a private session VC automatically. Waiting members are moved across automatically, everyone is pinged when the carry starts, and VC remains completely optional.",
      "",
      "### 🍻 Carriers",
      "Claim compatible groups and let the system handle private tickets, ready checks, verified time, participant access, progress, requeues and cleanup.",
      "",
      "### 🛟 Support",
      "Open a private support case directly from this panel.",
      "",
      "**The complicated systems stay underneath. The buttons stay simple.**",
    ].join("\n"))
    .addFields(
      { name: "Queue", value: "Smart grouped matching", inline: true },
      { name: "Voice", value: "Automatic session syncing", inline: true },
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
      .setCustomId("carry_dropin_open")
      .setLabel("Join Live Carry")
      .setEmoji("🌐")
      .setStyle(ButtonStyle.Success),
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
      .setCustomId("carry_waiting_vc")
      .setLabel("Waiting VC")
      .setEmoji("⏳")
      .setStyle(ButtonStyle.Secondary),
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
        .setURL(base),
    );
  }

  return { embeds: [embed], components: [primary, secondary] };
}

function isOperationsHub(message, botId) {
  return Boolean(
    message?.author?.id === botId &&
    (message.embeds || []).some((embed) => String(embed.footer?.text || "") === FOOTER),
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Publish or refresh the Tavern operations hub")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  buildPanel,

  async execute(interaction) {
    if (!interaction.channel?.isTextBased?.()) {
      return interaction.reply({
        content: "❌ Publish the Operations Hub inside a text channel.",
        flags: MessageFlags.Ephemeral,
      });
    }

    const recent = await interaction.channel.messages.fetch({ limit: 50 }).catch(() => null);
    const existing = recent?.find((message) => isOperationsHub(message, interaction.client.user.id)) || null;

    if (existing) {
      await existing.edit(buildPanel());
      if (!existing.pinned) await existing.pin("Permanent Carry Tavern operations hub").catch(() => {});
      return interaction.reply({
        content: `✅ Operations Hub refreshed: ${existing.url}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply(buildPanel());
    const message = await interaction.fetchReply().catch(() => null);
    if (message) {
      await message.pin("Permanent Carry Tavern operations hub").catch(() => {});
    }
  },
};
