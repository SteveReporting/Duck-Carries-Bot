const { MessageFlags } = require("discord.js");

const queue2 = require("./queue2");
const { reportCommand: reportNoShow } = require("./noshow");
const { claimSpecificCarryWithTicket } = require("../platform/singleCarryTicket");
const { viewOrRepairActiveClaims } = require("../platform/activeCarryClaim");

const data = queue2.data
  .addSubcommand((subcommand) =>
    subcommand
      .setName("active")
      .setDescription("View your active carry claims and recover any missing ticket"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("noshow")
      .setDescription("Report the other side for not showing up to a claimed carry")
      .addStringOption((option) =>
        option
          .setName("request")
          .setDescription("Carry request UUID; optional inside its carry ticket")
          .setRequired(false)
          .setMinLength(36)
          .setMaxLength(36),
      )
      .addStringOption((option) =>
        option
          .setName("reason")
          .setDescription("Optional details")
          .setMaxLength(500),
      ),
  );

async function warmGuildMembers(interaction) {
  if (!interaction.guild) return;
  await interaction.guild.members.fetch().catch((error) => {
    console.warn(`[QUEUE TICKET CACHE] Could not prefetch guild members: ${error.message}`);
  });
}

module.exports = {
  data,

  async autocomplete(interaction) {
    return queue2.autocomplete(interaction);
  },

  async execute(interaction) {
    const subcommand = interaction.options.getSubcommand();

    try {
      if (subcommand === "claim") {
        await warmGuildMembers(interaction);
        return await claimSpecificCarryWithTicket(interaction);
      }

      if (subcommand === "active") {
        await warmGuildMembers(interaction);
        return await viewOrRepairActiveClaims(interaction);
      }

      if (subcommand === "noshow") {
        return await reportNoShow(interaction);
      }

      return queue2.execute(interaction);
    } catch (error) {
      const scope = subcommand === "active"
        ? "ACTIVE"
        : subcommand === "noshow"
          ? "NO-SHOW"
          : "CLAIM TICKET";
      console.error(`[QUEUE ${scope}]`, error);
      const message = subcommand === "active"
        ? `❌ ${error.message || "Could not load or recover your active carry claims."}`
        : subcommand === "noshow"
          ? `❌ ${error.message || "Could not record the carry no-show."}`
          : `❌ ${error.message || "Could not claim the carry and create its private ticket."}`;

      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, components: [], embeds: [] }).catch(() => null);
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },

  handleQueueComponent: queue2.handleQueueComponent,
};
