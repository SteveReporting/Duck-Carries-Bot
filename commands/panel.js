const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
} = require("discord.js");

module.exports = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Create The Carry Tavern request panel"),

  async execute(interaction) {
    const button = new ButtonBuilder()
      .setCustomId("create_carry")
      .setLabel("🍺 Request a Carry")
      .setStyle(ButtonStyle.Primary);

    await interaction.reply({
      content: [
        "# 🍺 The Carry Tavern Carry Queue",
        "",
        "Need a carry? Use the button below.",
        "",
        "**Before requesting:**",
        "• Your Roblox account must be verified with the Tavern bot.",
        "• Requests have a **20 minute cooldown**.",
        "• You can request **1-15 runs**.",
        "• Dungeon abbreviations are cleaned automatically, for example `UW` → `Underworld`.",
        "• Matching dungeon + difficulty requests are merged for Carriers.",
        "• Unclaimed requests expire after **24 hours**.",
        "",
        "When accepted, you and the Carrier get a private ticket. The carry only registers complete after **both sides confirm**.",
      ].join("\n"),
      components: [new ActionRowBuilder().addComponents(button)],
    });
  },
};
