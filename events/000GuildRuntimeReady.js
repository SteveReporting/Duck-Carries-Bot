const { initializeRuntimeSelection } = require("../platform/guildRuntime");

module.exports = {
  name: "clientReady",
  once: true,
  execute(client) {
    // Runs first because of the 000 prefix. It chooses a configured compatibility
    // guild before legacy clientReady modules read process.env.GUILD_ID.
    initializeRuntimeSelection(client);
  },
};
