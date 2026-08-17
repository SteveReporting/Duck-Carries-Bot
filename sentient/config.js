function parseIds(value) {
    return String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
}

function envTrue(name, fallback = false) {
    const raw = process.env[name];
    if (raw == null || raw === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(raw).toLowerCase());
}

const config = {
    guildId: process.env.GUILD_ID,
    ownerIds: parseIds(process.env.SENTIENT_OWNER_IDS),

    channels: {
        tavernChat: process.env.SENTIENT_TAVERN_CHAT_CHANNEL_ID,
        images: process.env.SENTIENT_IMAGES_CHANNEL_ID,
        carryEvents: process.env.SENTIENT_CARRY_EVENTS_CHANNEL_ID || process.env.EVENT_FEED_CHANNEL_ID,
        announcements: process.env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID || process.env.ANNOUNCEMENT_CHANNEL_ID,
    },

    bartenderToken: process.env.SENTIENT_BARTENDER_TOKEN,
    bartenderName: process.env.SENTIENT_BARTENDER_NAME || "[ERR_] Th3_B4rt3nd3r",
    bartenderAvatarUrl: process.env.SENTIENT_BARTENDER_AVATAR_URL,
    treasuryImageUrl: process.env.SENTIENT_TREASURY_IMAGE_URL,
    arcaneBotId: process.env.SENTIENT_ARCANE_BOT_ID,

    aiReplies: envTrue("SENTIENT_AI_REPLIES", true),
    allowChannelRenames: envTrue("SENTIENT_ALLOW_CHANNEL_RENAMES", false),
    webhookFallback: envTrue("SENTIENT_WEBHOOK_FALLBACK", true),
    webhookName: process.env.SENTIENT_WEBHOOK_NAME || "Tavern Integrations",
};

const schedules = {
    // Day 1 was already performed manually. FAST finishes the remaining buildup in ~5 hours.
    fast: [
        { id: "watching", afterMs: 5 * 60 * 1000 },
        { id: "vault_echo", afterMs: 35 * 60 * 1000 },
        { id: "second_signal", afterMs: 90 * 60 * 1000 },
        { id: "breach", afterMs: 3 * 60 * 60 * 1000 },
        { id: "finale", afterMs: 5 * 60 * 60 * 1000 },
    ],

    // NORMAL still compresses the original multi-day idea into less than a day.
    normal: [
        { id: "watching", afterMs: 30 * 60 * 1000 },
        { id: "vault_echo", afterMs: 3 * 60 * 60 * 1000 },
        { id: "second_signal", afterMs: 7 * 60 * 60 * 1000 },
        { id: "breach", afterMs: 12 * 60 * 60 * 1000 },
        { id: "finale", afterMs: 18 * 60 * 60 * 1000 },
    ],
};

function getSchedule(pace) {
    return schedules[pace] || schedules.fast;
}

function channelId(key) {
    return config.channels[key] || null;
}

function getMissingRequiredChannels() {
    const missing = [];
    if (!config.channels.tavernChat) missing.push("SENTIENT_TAVERN_CHAT_CHANNEL_ID");
    if (!config.channels.announcements) missing.push("SENTIENT_ANNOUNCEMENTS_CHANNEL_ID (or ANNOUNCEMENT_CHANNEL_ID)");
    return missing;
}

module.exports = {
    config,
    getSchedule,
    channelId,
    getMissingRequiredChannels,
};
