const { retrofitCarryVoices } = require("../platform/carryVoiceSystem");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        const result = await retrofitCarryVoices(client);
        console.log(`🔊 Carry voice system ready • waiting VC ${result.waiting ? "online" : "unavailable"} • ${result.sessions} active session VC(s) synced.`);
      } catch (error) {
        console.warn(`[CARRY VOICE] Startup failed: ${error.message}`);
      }
    }, 7000);
    timer.unref?.();
  },
};
