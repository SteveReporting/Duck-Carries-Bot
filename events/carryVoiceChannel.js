const { ensureSessionVoice } = require("../platform/carryVoiceSystem");

function isCarryTicket(channel) {
  return Boolean(
    channel?.isTextBased?.() &&
    String(channel.name || "").toLowerCase().startsWith("carry-"),
  );
}

function schedule(channel, delay) {
  const timer = setTimeout(() => {
    ensureSessionVoice(channel).catch((error) => {
      console.warn(`[CARRY VOICE] Could not provision voice for #${channel.name}: ${error.message}`);
    });
  }, delay);
  timer.unref?.();
}

module.exports = {
  name: "channelCreate",
  async execute(channel) {
    if (!isCarryTicket(channel)) return;
    if (process.env.GUILD_ID && String(channel.guildId) !== String(process.env.GUILD_ID)) return;

    // The text ticket is created just before its carry rows are attached in Supabase.
    // Retry a few times so voice provisioning does not depend on Discord/network timing.
    schedule(channel, 2500);
    schedule(channel, 5000);
    schedule(channel, 9000);
  },
};
