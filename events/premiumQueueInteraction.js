const baseQueueCommand = require("../commands/queue");
const { handlePremiumQueueComponent } = require("../platform/premiumQueueUi");

// The canonical interaction router imports commands/queue directly for backwards
// compatibility. Patch that shared module object once so the premium experience
// handles modern queue controls first, while every legacy control still falls
// through to the original implementation.
if (!baseQueueCommand.__premiumQueuePatched) {
  const original = baseQueueCommand.handleQueueComponent.bind(baseQueueCommand);
  baseQueueCommand.handleQueueComponent = async (interaction) => {
    try {
      if (await handlePremiumQueueComponent(interaction)) return true;
    } catch (error) {
      console.error("[PREMIUM QUEUE UI]", error);
      const message = `❌ ${error.message || "Could not open that carry dashboard."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
      } else {
        await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
      return true;
    }
    return original(interaction);
  };

  Object.defineProperty(baseQueueCommand, "__premiumQueuePatched", {
    value: true,
    enumerable: false,
  });
}

module.exports = {
  name: "interactionCreate",
  async execute() {
    // Routing is patched at module load so the canonical listener owns the
    // acknowledgement and this secondary listener intentionally does nothing.
  },
};
