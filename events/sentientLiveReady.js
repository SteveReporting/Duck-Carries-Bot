const { startLiveSentient } = require("../sentient/liveDirector");

module.exports = {
    name: "ready",
    once: true,
    async execute() {
        await startLiveSentient();
    },
};
