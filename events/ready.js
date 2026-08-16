const { startPlatformSync } = require("../platform/sync");
const { startTreasuryStockPanel } = require("../platform/treasuryStock");

module.exports = {
  name: "ready",
  execute(client) {
    console.log(`${client.user.tag} is online`);
    client.user.setActivity("The Carry Tavern 🍺");
    startPlatformSync(client);
    startTreasuryStockPanel(client);
    console.log("✅ Tavern platform heartbeat, announcement sync and Treasury stock panel started.");
  },
};
