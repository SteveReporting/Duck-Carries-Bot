const liveStore = require("../sentient/liveStore");
const { liveConfig } = require("../sentient/liveConfig");

module.exports = {
    name: "ready",
    once: true,
    async execute() {
        // Never auto-enable Project Sentient when the Carry Tavern bot restarts.
        // This prevents generated startup/reconnect chatter from pinging members.
        // Staff can still explicitly enable it later with !sentientlive on.
        if (liveConfig.guildId) {
            liveStore.setEnabled(liveConfig.guildId, false);
        }
        console.log("🔇 Project Sentient live AI left OFF on bot startup.");
    },
};
