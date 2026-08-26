const {
  retrofitCarrierApplicationTicketClosePanels,
} = require("../platform/carrierApplicationTicketCleanup");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        const result = await retrofitCarrierApplicationTicketClosePanels(client);
        console.log(
          `✅ [CARRIER APPLICATION TICKETS] Startup retrofit checked ${result.checked} legacy application ticket(s), added ${result.added} close control panel(s).`,
        );
      } catch (error) {
        console.warn(`[CARRIER APPLICATION TICKETS] Startup retrofit failed: ${error.message}`);
      }
    }, 6_000);

    timer.unref?.();
  },
};
