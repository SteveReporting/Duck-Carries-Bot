const { startStaffOperationsHub } = require("../platform/staffOperationsHub");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        await startStaffOperationsHub(client);
      } catch (error) {
        console.warn(`[STAFF HUB] Startup failed: ${error.message}`);
      }
    }, 9_000);

    timer.unref?.();
  },
};
