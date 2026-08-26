const { MessageFlags } = require("discord.js");
const { handleReadyCheckInteraction } = require("../platform/carryReadyCheck");
const { prepareReadyCheckInteraction } = require("../platform/carrySessionIntegrity");
const { handleReadyCheckRequeueInteraction } = require("../platform/carryReadyCheckRequeue");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      // The integrity check can touch Supabase, so acknowledge Start Ready Check
      // before doing any network work. Discord invalidates unacknowledged
      // interactions after a few seconds.
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
