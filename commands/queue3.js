const { MessageFlags } = require("discord.js");

const queue2 = require("./queue2");
const { claimSpecificCarryWithTicket } = require("../platform/singleCarryTicket");
const { viewOrRepairActiveClaims } = require("../platform/activeCarryClaim");

const data = queue2.data.addSubcommand((subcommand) =>
  subcommand
    .setName("active")
    .setDescription("View your active carry claims and recover any missing ticket"),
);

module.exports = {
  data,

  async autocomplete(interaction) {
    return queue2.autocomplete(interaction);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "claim") {
        return await claimSpecificCarryWithTicket(interaction);
      }

      if (subcommand === "active") {
        return await viewOrRepairActiveClaims(interaction);
      }

      return queue2.execute(interaction);
    } catch (error) {
      const scope = subcommand === "active" ? "ACTIVE" : "CLAIM TICKET";
      console.error(`[QUEUE ${scope}]`, error);
      const message = subcommand === "active"
        ? `❌ ${error.message || "Could not load or recover your active carry claims."}`
        : `❌ ${error.message || "Could not claim the carry and create its private ticket."}`;

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, components: [], embeds: [] }).catch(() => null);
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },

  handleQueueComponent: queue2.handleQueueComponent,
};
