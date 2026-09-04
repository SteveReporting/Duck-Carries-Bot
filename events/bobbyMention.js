const { liveConfig } = require("../sentient/liveConfig");
const liveStore = require("../sentient/liveStore");
const { sendBartender } = require("../sentient/liveEntities");

const BOBBY_TRIGGER = /\bbobby\b/i;
const BOBBY_REPLY = "what does bro even do";

module.exports = {
    name: "messageCreate",
    async execute(message, client) {
        if (!message?.guild || message.guild.id !== liveConfig.guildId) return;
        if (!message.author || message.author.bot) return;
        if (!BOBBY_TRIGGER.test(message.content || "")) return;
        if (!liveConfig.allowedChannelIds.includes(message.channel.id)) return;

        const state = liveStore.get(liveConfig.guildId);
        if (!state.enabled) return;

        // Prevent the normal Sentient AI handler from also replying to this message.
        message.__bartenderBobbyHandled = true;
        await sendBartender(client, message.channel.id, BOBBY_REPLY);
    },
};
