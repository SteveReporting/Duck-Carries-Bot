const {
    ensureGoldDonationButtonOnPanels,
    startGoldDonationSheetSync,
} = require("../treasury/goldDonations");

module.exports = {
    name: "clientReady",
    once: true,

    async execute(client) {
        startGoldDonationSheetSync();
        await ensureGoldDonationButtonOnPanels(client);
    },
};
