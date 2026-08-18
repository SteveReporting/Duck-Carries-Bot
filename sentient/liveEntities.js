const { Client, GatewayIntentBits } = require("discord.js");
const { liveConfig } = require("./liveConfig");

let bartenderClient = null;
let err02Client = null;
let bartenderReady = false;
let err02Ready = false;
const webhookCache = new Map();

function makeCharacterClient() {
    return new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });
}

async function loginCharacter({ token, label, onReady }) {
    if (!token) return null;
    const client = makeCharacterClient();
    client.once("ready", () => {
        console.log(`👁️ ${label} online as ${client.user.tag}`);
        onReady(true);
    });
    client.on("error", (error) => console.warn(`[SENTIENT] ${label} client error: ${error.message}`));
    try {
        await client.login(token);
        return client;
    } catch (error) {
        console.warn(`[SENTIENT] Could not log in ${label}: ${error.message}`);
        onReady(false);
        client.destroy();
        return null;
    }
}

async function initLiveEntities() {
    if (!bartenderClient && liveConfig.bartenderToken) {
        bartenderClient = await loginCharacter({
            token: liveConfig.bartenderToken,
            label: "Bartender",
            onReady: (value) => { bartenderReady = value; },
        });
    }

    if (!err02Client && liveConfig.err02Token) {
        err02Client = await loginCharacter({
            token: liveConfig.err02Token,
            label: "ERR_02",
            onReady: (value) => { err02Ready = value; },
        });
    }
}

async function sendWithClient(client, channelId, content) {
    if (!client?.user) return null;
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return null;
    return channel.send({
        content,
        allowedMentions: { parse: [] },
    });
}

async function getWebhook(mainClient, channelId) {
    if (webhookCache.has(channelId)) return webhookCache.get(channelId);
    const channel = await mainClient.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.fetchWebhooks !== "function") return null;

    const hooks = await channel.fetchWebhooks().catch(() => null);
    if (!hooks) return null;

    let hook = hooks.find((item) => item.owner?.id === mainClient.user.id && item.name === "Sentient Relay");
    if (!hook && typeof channel.createWebhook === "function") {
        hook = await channel.createWebhook({
            name: "Sentient Relay",
            reason: "Project Sentient entity delivery",
        }).catch(() => null);
    }

    if (hook) webhookCache.set(channelId, hook);
    return hook || null;
}

async function sendBartender(mainClient, channelId, content) {
    if (bartenderReady && bartenderClient) {
        const sent = await sendWithClient(bartenderClient, channelId, content).catch(() => null);
        if (sent) return sent;
    }

    const channel = await mainClient.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text based.`);
    return channel.send({
        content: `**${liveConfig.bartenderName}**\n${content}`,
        allowedMentions: { parse: [] },
    });
}

async function sendErr02(mainClient, channelId, content) {
    if (err02Ready && err02Client) {
        const sent = await sendWithClient(err02Client, channelId, content).catch(() => null);
        if (sent) return sent;
    }

    const hook = await getWebhook(mainClient, channelId);
    if (hook) {
        return hook.send({
            content,
            username: liveConfig.err02Name,
            avatarURL: liveConfig.err02AvatarUrl || undefined,
            allowedMentions: { parse: [] },
        });
    }

    const channel = await mainClient.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text based.`);
    return channel.send({
        content: `**${liveConfig.err02Name}**\n${content}`,
        allowedMentions: { parse: [] },
    });
}

function bartenderUserId() {
    return bartenderClient?.user?.id || null;
}

function status() {
    return {
        bartenderReady,
        bartenderUserId: bartenderUserId(),
        err02Ready,
        err02UserId: err02Client?.user?.id || null,
        err02Mode: err02Ready ? "bot" : "webhook-fallback",
    };
}

function shutdown() {
    bartenderClient?.destroy();
    err02Client?.destroy();
    bartenderClient = null;
    err02Client = null;
    bartenderReady = false;
    err02Ready = false;
}

module.exports = {
    initLiveEntities,
    sendBartender,
    sendErr02,
    bartenderUserId,
    status,
    shutdown,
};
