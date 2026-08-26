const carrierAppReview = require("../commands/carrier-app-review");

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    if (interaction.customId !== "carrier_review_open") return;

    return carrierAppReview.execute(interaction);
  },
};
