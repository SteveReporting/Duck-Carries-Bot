const { AuditLogEvent } = require("discord.js");
const { removeOrphanedCarryTicket } = require("../platform/carryTicketLifecycleGuard");

async function wasAntiNukeRestore(channel) {
  try {
    const logs = await channel.guild.fetchAuditLogs({
      type: AuditLogEvent.ChannelCreate,
      limit: 8,
    });

    const now = Date.now();
    const entry = logs.entries.find(
      (item) =>
        String(item.targetId) === String(channel.id) &&
        now - item.createdTimestamp <= 15_000,
    );

    return Boolean(
      entry &&
      String(entry.reason || "").startsWith("Anti-nuke restore of deleted channel"),
    );
  } catch {
    return false;
  }
}

module.exports = {
  name: "channelCreate",

  async execute(channel) {
    if (!channel?.isTextBased?.() || !String(channel.name || "").toLowerCase().startsWith("carry-")) return;

    // The security system can restore a deleted ticket from its anti-nuke snapshot.
    // If this exact channel creation is an anti-nuke restore, remove it immediately.
    const immediateTimer = setTimeout(async () => {
      const current = await channel.guild.channels.fetch(channel.id).catch(() => null);
      if (!current) return;

      try {
        if (await wasAntiNukeRestore(current)) {
          await current.delete("Closed Carry Tavern ticket must not be restored by anti-nuke");
          console.log(`[CARRY TICKET GUARD] Removed anti-nuke restored ticket #${current.name} (${current.id}).`);
        }
      } catch (error) {
        console.warn(`[CARRY TICKET GUARD] Anti-nuke restore check failed for #${channel.name}: ${error.message}`);
      }
    }, 1_000);
    immediateTimer.unref?.();

    // Fallback: legitimate tickets are linked to an active request immediately after
    // creation. A restored/closed ticket gets a fresh channel ID and no active DB link.
    const orphanTimer = setTimeout(async () => {
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

    orphanTimer.unref?.();
  },
};
