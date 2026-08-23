const { ChannelType } = require("discord.js");
const { ensureCarryTicketClosePanel } = require("../platform/carryTicketCleanup");

module.exports = {
  name: "channelCreate",
  async execute(channel) {
    if (channel.type !== ChannelType.GuildText) return;
    if (!String(channel.name || "").toLowerCase().startsWith("carry-")) return;
    if (process.env.GUILD_ID && channel.guildId !== process.env.GUILD_ID) return;

    setTimeout(() => {
      ensureCarryTicketClosePanel(channel).catch((error) => {
        console.warn(`[CARRY TICKET CLOSE] Could not add controls to #${channel.name}:`, error.message);
      });
    }, 2500).unref?.();
  },
};
