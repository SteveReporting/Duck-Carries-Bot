const { retrofitCarryControlCenters } = require("../platform/carryControlCenter");

module.exports = {
  name: "ready",
  once: true,
  async execute(client) {
    setTimeout(async () => {
      try {
        const result = await retrofitCarryControlCenters(client);
        console.log(`🍺 Carry Control Center ready • updated ${result.updated} ticket(s) • removed ${result.deleted} old panel(s).`);
      } catch (error) {
        console.warn("[CARRY CONTROL CENTER] Startup retrofit failed:", error.message);
      }
    }, 5000).unref?.();
  },
};
