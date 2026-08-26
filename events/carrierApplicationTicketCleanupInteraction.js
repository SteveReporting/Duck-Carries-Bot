const {
  handleCarrierApplicationTicketClose,
} = require("../platform/carrierApplicationTicketCleanup");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleCarrierApplicationTicketClose(interaction);
    } catch (error) {
      console.error("[CARRIER APPLICATION TICKET] Close interaction failed:", error);
      const message = `❌ ${error.message || "Could not close this Carrier application ticket."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
