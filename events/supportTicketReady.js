const { ensureSupportTicketSystem } = require("../platform/supportTicketSystem");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        await ensureSupportTicketSystem(client);
      } catch (error) {
        console.error(`[SUPPORT TICKETS] Startup failed: ${error.message}`);
      }
    }, 4_000);

    timer.unref?.();
  },
};
