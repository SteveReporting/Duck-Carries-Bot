const { startCarryServiceMonitor } = require("../platform/carryServiceTime");

module.exports = {
  name: "clientReady",
  once: true,
  execute(client) {
    startCarryServiceMonitor(client);
  },
};
