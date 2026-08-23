const { ensureCarryControlCenter } = require("../platform/carryControlCenter");

module.exports = {
  name: "channelCreate",
  async execute(channel) {
    if (!channel?.isTextBased?.() || !String(channel.name || "").toLowerCase().startsWith("carry-")) return;
    if (process.env.GUILD_ID && channel.guildId !== process.env.GUILD_ID) return;

    setTimeout(() => {
      ensureCarryControlCenter(channel, { replace: true }).catch((error) => {
        console.warn(`[CARRY CONTROL CENTER] Could not unify #${channel.name}:`, error.message);
      });
    }, 5000).unref?.();
  },
};
