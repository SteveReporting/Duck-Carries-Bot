const { handlePulseInteraction } = require("../platform/carryOpsIntelligence");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handlePulseInteraction(interaction);
    } catch (error) {
      console.error("[OPS INTELLIGENCE] Pulse interaction failed:", error);
      const message = `❌ ${error.message || "Could not load Tavern Pulse."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
