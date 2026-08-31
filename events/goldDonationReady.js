const {
    startGoldDonationSheetSync,
} = require("../treasury/goldDonations");

module.exports = {
    name: "clientReady",
    once: true,

    execute() {
        startGoldDonationSheetSync();
    },
};