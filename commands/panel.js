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
      .setCustomId("carry_request_start_v3")
      .setLabel("🍺 Request a Carry")
      .setStyle(ButtonStyle.Primary);

    await interaction.reply({
      content: [
        "# 🍺 The Carry Tavern Carry Queue",
        "",
        "Need a carry? Use the button below.",
        "",
        "**How requesting works:**",
        "• Select your **Dungeon** from the dropdown, from **Desert Temple → Enchanted Forest**.",
        "• Select the valid **Difficulty** from the next dropdown.",
        "• **Desert Temple** and **Winter Outpost**: Easy, Medium, Hard, Insane or Nightmare.",
        "• **Every other listed dungeon**: Insane or Nightmare only.",
        "• You only type the number of runs, availability and optional notes.",
        "• You can keep up to **2 active requests** at once.",
        "• You can request **1-15 runs** per request.",
        "• Requests and stale legacy queue data older than **24 hours** are automatically cleaned up.",
        "",
        "When a Carrier claims the request, the shared Tavern queue and Discord ticket system handle the rest.",
      ].join("\n"),
      components: [new ActionRowBuilder().addComponents(button)],
    });
  },
};
