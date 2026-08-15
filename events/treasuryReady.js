const { startTreasuryMonitor } = require("../treasury/treasury");

module.exports = {
    name: "clientReady",
    once: true,

    execute(client) {
        startTreasuryMonitor(client);
    },
};