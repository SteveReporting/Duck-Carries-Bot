const {
  handleCarryVoiceInteraction,
  observeCarryInteraction,
} = require("../platform/carryVoiceSystem");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      // Passive hooks such as Start Carry never acknowledge the interaction here;
      // the existing carry handler remains authoritative and this only schedules
      // voice/ping synchronization after its state mutation settles.
      observeCarryInteraction(interaction);
      await handleCarryVoiceInteraction(interaction);
    } catch (error) {
      console.error("[CARRY VOICE] Interaction failed:", error);
      const message = `❌ ${error.message || "Carry voice action failed."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
