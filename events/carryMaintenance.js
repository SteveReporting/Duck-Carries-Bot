const { expireTimedOutCarries } = require("../platform/carryQueue");

let timer = null;

module.exports = {
  name: "ready",

  execute(client) {
    if (timer) return;

    const run = async () => {
      try {
        await expireTimedOutCarries(client);
      } catch (error) {
        console.error("[CARRY MAINTENANCE]", error);
      }
    };

    void run();
    timer = setInterval(() => void run(), 60_000);
    timer.unref?.();
    console.log("✅ Carry timeout maintenance started.");
  },
};
