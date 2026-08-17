const { handleMessage } = require("../sentient/director");

module.exports = {
    name: "messageCreate",
    async execute(message, client) {
        await handleMessage(message, client);
    },
};
