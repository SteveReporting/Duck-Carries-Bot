const { ensureCarryControlCenter } = require("../platform/carryControlCenter");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    if (!interaction.isButton()) return;
    const id = String(interaction.customId || "");
    if (!id.startsWith("carry_cancel_") && !id.startsWith("carry_delete_")) return;

    const channel = interaction.channel;
    if (!channel?.isTextBased?.() || !String(channel.name || "").toLowerCase().startsWith("carry-")) return;

    setTimeout(() => {
      ensureCarryControlCenter(channel, { replace: true }).catch((error) => {
        console.warn(`[CARRY CONTROL CENTER] Could not refresh #${channel.name}:`, error.message);
      });
    }, 1200).unref?.();
  },
};
