const {
  ensureActiveCarriesChannel,
  startGuildActiveCarriesBoard,
} = require("../platform/activeCarriesBoard");
const { isGuildConfigured } = require("../platform/guildConfig");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    if (!interaction.isChatInputCommand?.() || interaction.commandName !== "setup" || !interaction.guild) return;

    const timer = setTimeout(async () => {
      if (!isGuildConfigured(interaction.guild.id)) return;
      try {
        await ensureActiveCarriesChannel(interaction.guild);
        startGuildActiveCarriesBoard(interaction.client, interaction.guild);
      } catch (error) {
        console.warn(`[ACTIVE CARRIES] Setup follow-up failed in ${interaction.guild.name}: ${error.message}`);
      }
    }, 12_000);
    timer.unref?.();
  },
};
