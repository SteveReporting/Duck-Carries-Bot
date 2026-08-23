const { MessageFlags } = require("discord.js");

const queue2 = require("./queue2");
const { claimSpecificCarryWithTicket } = require("../platform/singleCarryTicket");

module.exports = {
  data: queue2.data,

  async autocomplete(interaction) {
    return queue2.autocomplete(interaction);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand !== "claim") {
      return queue2.execute(interaction);
    }

    try {
      return await claimSpecificCarryWithTicket(interaction);
    } catch (error) {
      console.error("[QUEUE CLAIM TICKET]", error);
      const message = `❌ ${error.message || "Could not claim the carry and create its private ticket."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, components: [], embeds: [] }).catch(() => null);
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },

  handleQueueComponent: queue2.handleQueueComponent,
};
