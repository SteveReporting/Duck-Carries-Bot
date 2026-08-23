const { handleControlCenterSelect } = require("../platform/carryControlCenter");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleControlCenterSelect(interaction);
    } catch (error) {
      console.error("[CARRY CONTROL CENTER] Interaction failed:", error);
      const message = `❌ ${error.message || "Could not update the carry controls."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
