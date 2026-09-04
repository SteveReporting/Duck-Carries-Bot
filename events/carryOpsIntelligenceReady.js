const { startCarryOpsIntelligence } = require("../platform/carryOpsIntelligence");

module.exports = {
  name: "clientReady",
  once: true,
  execute(client) {
    const timer = setTimeout(() => startCarryOpsIntelligence(client), 12_000);
    timer.unref?.();
  },
};
