const { handleCarryTicketClose } = require("../platform/carryTicketCleanup");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleCarryTicketClose(interaction);
    } catch (error) {
      console.error("[CARRY TICKET CLOSE]", error);
      const message = `❌ ${error.message || "Could not close this carry ticket."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
