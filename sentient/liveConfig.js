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

function envNumber(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}

const allowedChannelIds = parseIds(process.env.SENTIENT_AI_CHANNEL_IDS);
if (!allowedChannelIds.length && process.env.SENTIENT_TAVERN_CHAT_CHANNEL_ID) {
    allowedChannelIds.push(process.env.SENTIENT_TAVERN_CHAT_CHANNEL_ID);
}

const liveConfig = {
    guildId: process.env.GUILD_ID,
    ownerIds: parseIds(process.env.SENTIENT_OWNER_IDS),

    bartenderToken: process.env.SENTIENT_BARTENDER_TOKEN,
    bartenderName: process.env.SENTIENT_BARTENDER_NAME || "[ERR_] Th3_B4rt3nd3r",

    err02Token: process.env.SENTIENT_ERR02_TOKEN,
    err02Name: process.env.SENTIENT_ERR02_NAME || "[ERR_02]",
    err02AvatarUrl: process.env.SENTIENT_ERR02_AVATAR_URL || "",

    aiEnabledByDefault: envTrue("SENTIENT_LIVE_AI_ENABLED", false),
    allowedChannelIds,
    spontaneousChance: Math.max(0, Math.min(1, envNumber("SENTIENT_SPONTANEOUS_CHANCE", 0.12))),
    directGlobalCooldownMs: Math.max(5000, envNumber("SENTIENT_DIRECT_GLOBAL_COOLDOWN_MS", 15000)),
    directUserCooldownMs: Math.max(10000, envNumber("SENTIENT_DIRECT_USER_COOLDOWN_MS", 45000)),
    spontaneousGlobalCooldownMs: Math.max(30000, envNumber("SENTIENT_SPONTANEOUS_GLOBAL_COOLDOWN_MS", 90000)),

    model: process.env.OPENAI_MODEL || "gpt-5.6",
    reasoningEffort: process.env.OPENAI_REASONING_EFFORT || "low",
};

module.exports = { liveConfig };
