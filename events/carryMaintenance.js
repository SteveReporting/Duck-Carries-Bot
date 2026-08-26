const { expireTimedOutCarries } = require("../platform/carryQueue");
const { expireReadyChecks } = require("../platform/carryReadyCheckRequeue");

let timer = null;

module.exports = {
  name: "clientReady",

  execute(client) {
    if (timer) return;

    const run = async () => {
      try {
        await expireTimedOutCarries(client);
        await expireReadyChecks(client);
      } catch (error) {
        console.error("[CARRY MAINTENANCE]", error);
      }
    };

    void run();
    timer = setInterval(() => void run(), 60_000);
    timer.unref?.();
    console.log("✅ Carry timeout and ready-check maintenance started.");
  },
};
