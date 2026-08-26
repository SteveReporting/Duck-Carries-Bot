const { handleSupportTicketInteraction } = require("../platform/supportTicketSystem");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleSupportTicketInteraction(interaction);
    } catch (error) {
      console.error("[SUPPORT TICKETS] Interaction failed:", error);
      const message = `❌ ${error.message || "Support ticket action failed."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, flags: 64 }).catch(() => {});
      }
    }
  },
};
