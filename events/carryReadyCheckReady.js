const { ensureReadyCheckPanelsForClient } = require("../platform/carryReadyCheck");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    try {
      const added = await ensureReadyCheckPanelsForClient(client);
      console.log(`✅ Carry ready-check system started${added ? ` and added ${added} missing panel(s)` : ""}.`);
    } catch (error) {
      console.warn("[CARRY READY CHECK] Startup scan failed:", error.message);
    }
  },
};
