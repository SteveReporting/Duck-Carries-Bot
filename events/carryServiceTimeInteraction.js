const { handleCarryServiceInteraction } = require("../platform/carryServiceTime");
const { handleVerifiedCompletion } = require("../platform/carryServiceCompletion");
const {
  prepareServiceStartInteraction,
  recoverDetachedCarrySession,
} = require("../platform/carrySessionIntegrity");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await prepareServiceStartInteraction(interaction);
      await recoverDetachedCarrySession(interaction);
      if (await handleCarryServiceInteraction(interaction)) return;
      await handleVerifiedCompletion(interaction);
    } catch (error) {
      console.error("[CARRY SERVICE TIME]", error);
      const message = `❌ ${error.message || "Something went wrong with verified carry time."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
