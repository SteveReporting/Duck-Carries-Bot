const { startLiveCarryBoard } = require("../platform/liveCarryBoard");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    startLiveCarryBoard(client);
    console.log("✅ Live Carry Board updater started.");
  },
};
