const { ensureSupportTicketSystem } = require("../platform/supportTicketSystem");
const { refreshPremiumSupportPanel } = require("../platform/premiumSupportUi");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        const result = await ensureSupportTicketSystem(client);
        await refreshPremiumSupportPanel(result?.publicChannel, client.user.id).catch((error) => {
          console.warn(`[SUPPORT TICKETS] Premium panel refresh failed: ${error.message}`);
        });
      } catch (error) {
        console.error(`[SUPPORT TICKETS] Startup failed: ${error.message}`);
      }
    }, 4_000);

    timer.unref?.();
  },
};
