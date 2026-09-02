const liveStore = require("../sentient/liveStore");
const { liveConfig } = require("../sentient/liveConfig");
const { initLiveEntities } = require("../sentient/liveEntities");

module.exports = {
    name: "clientReady",
    once: true,
    async execute() {
        // Never auto-enable Project Sentient when the Carry Tavern bot restarts.
        // Keep generated AI chatter off, but connect the already-installed
        // Bartender application so its own slash commands can be registered and
        // handled even though the main Carry Tavern application is not in-guild.
        if (liveConfig.guildId) {
            liveStore.setEnabled(liveConfig.guildId, false);
        }

        await initLiveEntities();
        console.log("🔇 Project Sentient live AI left OFF on bot startup.");
    },
};
