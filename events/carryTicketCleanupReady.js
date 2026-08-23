const { retrofitCarryTicketClosePanels } = require("../platform/carryTicketCleanup");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    try {
      const added = await retrofitCarryTicketClosePanels(client);
      console.log(`🔒 Carry ticket close controls ready${added ? ` • added to ${added} ticket${added === 1 ? "" : "s"}` : ""}.`);
    } catch (error) {
      console.warn("[CARRY TICKET CLOSE] Startup retrofit failed:", error.message);
    }
  },
};
