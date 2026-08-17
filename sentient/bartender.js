const {
    Client,
    GatewayIntentBits,
} = require("discord.js");
const { config } = require("./config");
const store = require("./store");

let bartenderClient = null;
let bartenderReady = false;
const webhookCache = new Map();

async function initBartender() {
    if (!config.bartenderToken || bartenderClient) return;

    bartenderClient = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMessages,
            GatewayIntentBits.MessageContent,
        ],
    });

    bartenderClient.once("ready", () => {
        bartenderReady = true;
        console.log(`🍺 Project Sentient character online as ${bartenderClient.user.tag}`);
    });

    bartenderClient.on("error", (error) => {
        console.warn("[SENTIENT] Bartender client error:", error.message);
    });

    try {
        await bartenderClient.login(config.bartenderToken);
    } catch (error) {
        bartenderReady = false;
        console.warn(`[SENTIENT] Could not log in the Bartender bot: ${error.message}`);
    }
}

async function getWebhook(mainClient, channelId) {
    if (!config.webhookFallback) return null;
    if (webhookCache.has(channelId)) return webhookCache.get(channelId);

    const channel = await mainClient.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.() || typeof channel.fetchWebhooks !== "function") return null;

    const hooks = await channel.fetchWebhooks();
    let hook = hooks.find((item) => item.owner?.id === mainClient.user.id && item.name === config.webhookName);

    if (!hook && typeof channel.createWebhook === "function") {
        hook = await channel.createWebhook({
            name: config.webhookName,
            avatar: config.bartenderAvatarUrl || undefined,
            reason: "Project Sentient character delivery",
        });
    }

    if (hook) webhookCache.set(channelId, hook);
    return hook || null;
}

async function sendViaMainBot(mainClient, channelId, content, options = {}) {
    const channel = await mainClient.channels.fetch(channelId);
    if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text based.`);

    return channel.send({
        content: `**${options.displayName || config.bartenderName}**\n${content}`,
        allowedMentions: options.allowedMentions,
        embeds: options.embeds,
        files: options.files,
    });
}

async function sendAsEntity(mainClient, {
    channelId,
    content,
    displayName = config.bartenderName,
    avatarURL = config.bartenderAvatarUrl,
    kind = "bartender",
    allowedMentions,
    embeds,
    files,
    forceWebhook = false,
}) {
    if (!channelId) throw new Error("No channel ID was provided for a Sentient message.");

    let message = null;

    if (!forceWebhook && kind === "bartender" && bartenderReady && bartenderClient) {
        const channel = await bartenderClient.channels.fetch(channelId).catch(() => null);
        if (channel?.isTextBased?.()) {
            message = await channel.send({ content, allowedMentions, embeds, files });
        }
    }

    if (!message && config.webhookFallback) {
        const hook = await getWebhook(mainClient, channelId).catch((error) => {
            console.warn(`[SENTIENT] Webhook fallback unavailable in ${channelId}: ${error.message}`);
            return null;
        });

        if (hook) {
            message = await hook.send({
                content,
                username: displayName,
                avatarURL: avatarURL || undefined,
                allowedMentions,
                embeds,
                files,
                wait: true,
            });
        }
    }

    if (!message) {
        message = await sendViaMainBot(mainClient, channelId, content, {
            displayName,
            allowedMentions,
            embeds,
            files,
        });
    }

    if (message?.id) {
        store.recordMessage({
            messageId: message.id,
            guildId: config.guildId,
            channelId,
            kind,
        });
    }

    return message;
}

async function shutdownBartender() {
    if (!bartenderClient) return;
    try {
        bartenderClient.destroy();
    } finally {
        bartenderClient = null;
        bartenderReady = false;
    }
}

function isBartenderReady() {
    return bartenderReady;
}

module.exports = {
    initBartender,
    sendAsEntity,
    shutdownBartender,
    isBartenderReady,
};
