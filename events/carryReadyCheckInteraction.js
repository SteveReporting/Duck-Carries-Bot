const { MessageFlags } = require("discord.js");
const { handleReadyCheckInteraction } = require("../platform/carryReadyCheck");
const { prepareReadyCheckInteraction } = require("../platform/carrySessionIntegrity");
const { handleReadyCheckRequeueInteraction } = require("../platform/carryReadyCheckRequeue");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      // index.js pre-acknowledges latency-sensitive ready-check buttons before
      // the modular interaction listeners run. Wait for that acknowledgement so
      // downstream handlers never race it with a second deferReply().
      if (interaction.__carryFastAckPromise) {
        await interaction.__carryFastAckPromise;
      }

      // Fallback for Start Ready Check when this module is used without the
      // index-level pre-ack hook.
      if (
        interaction.isButton?.() &&
        interaction.customId === "carry_readycheck_start" &&
        !interaction.deferred &&
        !interaction.replied
      ) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      }

      await prepareReadyCheckInteraction(interaction);
      if (await handleReadyCheckRequeueInteraction(interaction)) return;
      await handleReadyCheckInteraction(interaction);
    } catch (error) {
      console.error("[CARRY READY CHECK]", error);
      const message = `❌ ${error.message || "Something went wrong with the ready check."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  },
};
