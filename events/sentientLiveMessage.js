const { handleLiveMessage } = require("../sentient/liveDirector");

module.exports = {
    name: "messageCreate",
    async execute(message, client) {
        if (message?.__bartenderBobbyHandled) return;
        await handleLiveMessage(message, client);
    },
};
