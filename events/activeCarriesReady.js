const { startActiveCarriesBoard } = require("../platform/activeCarriesBoard");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    setTimeout(() => {
      startActiveCarriesBoard(client);
    }, 8000).unref?.();
  },
};
