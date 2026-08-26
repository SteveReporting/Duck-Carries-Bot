const { cleanupOrphanedCarryTickets } = require("../platform/carryTicketLifecycleGuard");

module.exports = {
  name: "clientReady",
  once: true,

  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        const result = await cleanupOrphanedCarryTickets(client);
        console.log(
          `✅ [CARRY TICKET GUARD] Startup cleanup checked ${result.checked} carry ticket(s), removed ${result.removed} closed/orphaned ticket(s), ${result.failed} failure(s).`,
        );
      } catch (error) {
        console.warn(`[CARRY TICKET GUARD] Startup cleanup failed: ${error.message}`);
      }
    }, 12_000);

    timer.unref?.();
  },
};
