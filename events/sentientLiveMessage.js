const { handleLiveMessage } = require("../sentient/liveDirector");

module.exports = {
    name: "messageCreate",
    async execute(message, client) {
        await handleLiveMessage(message, client);
    },
};
