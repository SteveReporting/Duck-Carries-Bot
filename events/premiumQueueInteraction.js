const { handlePremiumQueueComponent } = require("../platform/premiumQueueUi");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handlePremiumQueueComponent(interaction);
    } catch (error) {
      console.error("[PREMIUM QUEUE UI]", error);
      const message = `❌ ${error.message || "Could not open that carry dashboard."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
