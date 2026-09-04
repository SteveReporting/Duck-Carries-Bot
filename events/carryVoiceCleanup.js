const { closeVoiceForTicket } = require("../platform/carryVoiceSystem");

module.exports = {
  name: "channelDelete",
  async execute(channel) {
    if (!channel?.id) return;
    if (process.env.GUILD_ID && channel.guildId && String(channel.guildId) !== String(process.env.GUILD_ID)) return;

    try {
      await closeVoiceForTicket(channel.client, channel.id, "Carry ticket closed");
    } catch (error) {
      console.warn(`[CARRY VOICE] Ticket cleanup failed for ${channel.id}: ${error.message}`);
    }
  },
};
