const { handleReadyCheckInteraction } = require("../platform/carryReadyCheck");
const { prepareReadyCheckInteraction } = require("../platform/carrySessionIntegrity");
const { handleReadyCheckRequeueInteraction } = require("../platform/carryReadyCheckRequeue");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await prepareReadyCheckInteraction(interaction);
      if (await handleReadyCheckRequeueInteraction(interaction)) return;
      await handleReadyCheckInteraction(interaction);
    } catch (error) {
      console.error("[CARRY READY CHECK]", error);
      const message = `❌ ${error.message || "Something went wrong with the ready check."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
