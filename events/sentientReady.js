const { startDirector } = require("../sentient/director");

module.exports = {
    name: "ready",
    async execute(client) {
        await startDirector(client);
        console.log("✅ Project Sentient director ready.");
    },
};
