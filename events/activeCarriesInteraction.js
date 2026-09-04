const { handleActiveCarriesInteraction } = require("../platform/activeCarriesBoard");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    try {
      await handleActiveCarriesInteraction(interaction);
    } catch (error) {
      console.warn(`[ACTIVE CARRIES] Interaction failed: ${error.message}`);
    }
  },
};
