const { removeOrphanedCarryTicket } = require("../platform/carryTicketLifecycleGuard");

module.exports = {
  name: "channelCreate",

  async execute(channel) {
    if (!channel?.isTextBased?.() || !String(channel.name || "").toLowerCase().startsWith("carry-")) return;

    // Legitimate carry tickets are linked to their request immediately after creation.
    // Anti-nuke restores of already-closed tickets receive a brand-new channel ID and
    // therefore have no active request linked to them. Give normal ticket creation a
    // few seconds to finish before deciding whether this new channel is orphaned.
    const timer = setTimeout(async () => {
      const current = await channel.guild.channels.fetch(channel.id).catch(() => null);
      if (!current) return;

      try {
        await removeOrphanedCarryTicket(
          current,
          "Closed Carry Tavern ticket must not be reopened/restored",
        );
      } catch (error) {
        console.warn(`[CARRY TICKET GUARD] Channel-create check failed for #${channel.name}: ${error.message}`);
      }
    }, 7_500);

    timer.unref?.();
  },
};
