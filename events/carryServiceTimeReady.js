const { startCarryServiceMonitor } = require("../platform/carryServiceTime");

module.exports = {
  name: "ready",
  once: true,
  execute(client) {
    startCarryServiceMonitor(client);
  },
};
