const { ensureCarryControlCenter } = require("../platform/carryControlCenter");

function isCarryTicket(channel) {
  return Boolean(
    channel?.isTextBased?.() &&
      String(channel.name || "").toLowerCase().startsWith("carry-"),
  );
}

function scheduleRefresh(channel, delay) {
  const timer = setTimeout(() => {
    ensureCarryControlCenter(channel, { replace: true }).catch((error) => {
      console.warn(
        `[CARRY CONTROL CENTER] Could not refresh #${channel.name} after request action:`,
        error.message,
      );
    });
  }, delay);
  timer.unref?.();
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    if (!interaction.isButton()) return;

    const id = String(interaction.customId || "");
    if (!id.startsWith("carry_cancel_") && !id.startsWith("carry_delete_")) return;

    const channel = interaction.channel;
    if (!isCarryTicket(channel)) return;

    // The carry action handler temporarily clears the clicked message's components.
    // Rebuild the unified panel after the database mutation has had time to settle.
    // Multiple passes make the repair resilient to Supabase/network latency and to
    // interactionCreate listener ordering. If another requester remains, the same
    // Control Center is edited in place with that requester and all global controls.
    // If none remain, ensureCarryControlCenter is a no-op and normal ticket cleanup wins.
    scheduleRefresh(channel, 750);
    scheduleRefresh(channel, 2_000);
    scheduleRefresh(channel, 5_000);
  },
};
