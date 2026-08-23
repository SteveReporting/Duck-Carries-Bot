const { ensureReadyCheckPanel } = require("../platform/carryReadyCheck");

module.exports = {
  name: "channelCreate",
  async execute(channel) {
    if (!channel?.isTextBased?.() || !String(channel.name || "").startsWith("carry-")) return;
    await ensureReadyCheckPanel(channel, { retries: 8, retryDelay: 1500 }).catch((error) => {
      console.warn("[CARRY READY CHECK] Could not add panel to new ticket:", error.message);
    });
  },
};
