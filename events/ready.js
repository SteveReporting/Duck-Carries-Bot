const { startPlatformSync } = require("../platform/sync");

module.exports = {
  name: "ready",
  execute(client) {
    console.log(`${client.user.tag} is online`);
    client.user.setActivity("The Carry Tavern 🍺");
    startPlatformSync(client);
    console.log("✅ Tavern platform heartbeat and announcement sync started.");
  },
};
