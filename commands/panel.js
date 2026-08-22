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
      .setCustomId("carry_request_start_v2")
      .setLabel("🍺 Request a Carry")
      .setStyle(ButtonStyle.Primary);

    await interaction.reply({
      content: [
        "# 🍺 The Carry Tavern Carry Queue",
        "",
        "Need a carry? Use the button below.",
        "",
        "**How requesting works:**",
        "• Choose your **Dungeon** from a list.",
        "• Choose the valid **Difficulty** for that dungeon.",
        "• Enter only your runs, availability and optional notes.",
        "• You can keep up to **2 active requests** at once.",
        "• You can request **1-15 runs** per request.",
        "• Desert Temple and Winter Outpost support **Easy, Medium, Hard, Insane and Nightmare**.",
        "• Other progression dungeons support **Insane and Nightmare**.",
        "• Requests and stale legacy queue data older than **24 hours** are automatically cleaned up.",
        "",
        "When a Carrier claims the request, the shared Tavern queue and Discord ticket system handle the rest.",
      ].join("\n"),
      components: [new ActionRowBuilder().addComponents(button)],
    });
  },
};
