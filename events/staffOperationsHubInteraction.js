const {
  handleStaffOperationsHubInteraction,
} = require("../platform/staffOperationsHub");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleStaffOperationsHubInteraction(interaction);
    } catch (error) {
      console.error("[STAFF HUB] Interaction failed:", error);
      const message = `❌ ${error.message || "Could not refresh the Staff Operations Hub."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
