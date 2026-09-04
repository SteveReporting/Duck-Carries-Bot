const { MessageFlags } = require("discord.js");

const queue2 = require("./queue2");
const { reportCommand: reportNoShow } = require("./noshow");
const { claimSpecificCarryWithTicket } = require("../platform/singleCarryTicket");
const { viewOrRepairActiveClaims } = require("../platform/activeCarryClaim");
const {
  renderPremiumQueue,
  handlePremiumQueueComponent,
} = require("../platform/premiumQueueUi");

const data = queue2.data
  .setDescription("The Carry Tavern carry system")
  .addSubcommand((subcommand) =>
    subcommand
      .setName("active")
      .setDescription("Open your active carry dashboard and recover missing tickets"),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("noshow")
      .setDescription("Report a no-show for a claimed carry")
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
      if (subcommand === "view") {
        return await renderPremiumQueue(interaction);
      }

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
      const scope = subcommand === "view"
        ? "VIEW"
        : subcommand === "active"
          ? "ACTIVE"
          : subcommand === "noshow"
            ? "NO-SHOW"
            : "CLAIM TICKET";
      console.error(`[QUEUE ${scope}]`, error);

      const message = subcommand === "view"
        ? `❌ ${error.message || "Could not load the live carry queue."}`
        : subcommand === "active"
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

  async handleQueueComponent(interaction) {
    if (await handlePremiumQueueComponent(interaction)) return true;
    return queue2.handleQueueComponent(interaction);
  },
};
