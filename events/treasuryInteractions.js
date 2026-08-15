const { handleTreasuryInteraction } = require("../treasury/treasury");

module.exports = {
    name: "interactionCreate",

    async execute(interaction) {
        await handleTreasuryInteraction(interaction);
    },
};