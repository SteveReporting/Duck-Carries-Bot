const { Client, GatewayIntentBits } = require("discord.js");
const { liveConfig } = require("./liveConfig");
const liveStore = require("./liveStore");
const giveawayTicketCommand = require("../commands/giveaway-ticket");

let bartenderClient = null;
let err02Client = null;
let coreClient = null;
let bartenderReady = false;
let err02Ready = false;
let coreReady = false;
const webhookCache = new Map();

function makeCharacterClient() {
    // Character clients do not listen to public message content. Bartender also
    // owns a guild slash command, which only requires the Guilds intent.
    return new Client({ intents: [GatewayIntentBits.Guilds] });
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

async function registerBartenderGiveawayCommand(client) {
    if (!client?.application || !liveConfig.guildId) return;

    try {
        const data = giveawayTicketCommand.data.toJSON();
        const existing = await client.application.commands.fetch({ guildId: liveConfig.guildId });
        const current = existing.find((command) => command.name === data.name);

        if (current) {
            await client.application.commands.edit(current.id, data, liveConfig.guildId);
        } else {
            await client.application.commands.create(data, liveConfig.guildId);
        }

        console.log(`🍺 Bartender registered /${data.name} in guild ${liveConfig.guildId}.`);
    } catch (error) {
        console.warn(`[SENTIENT] Bartender command registration failed: ${error.message}`);
    }
}

function installBartenderCommandHandler(client) {
    if (!client || client.__bartenderGiveawayHandlerInstalled) return;
    client.__bartenderGiveawayHandlerInstalled = true;

    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isChatInputCommand?.()) return;
        if (interaction.commandName !== giveawayTicketCommand.data.name) return;

        try {
            await giveawayTicketCommand.execute(interaction);
        } catch (error) {
            console.error("[BARTENDER GIVEAWAY TICKET]", error);
            const payload = { content: `❌ ${error.message || "Giveaway ticket command failed."}`, ephemeral: true };
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(payload).catch(() => {});
            } else {
                await interaction.reply(payload).catch(() => {});
            }
        }
    });

    const register = () => void registerBartenderGiveawayCommand(client);
    if (client.isReady?.()) register();
    else client.once("ready", register);
}

async function initLiveEntities() {
    if (!bartenderClient && liveConfig.bartenderToken) {
        bartenderClient = await loginCharacter({
            token: liveConfig.bartenderToken,
            label: "Bartender",
            onReady: (value) => { bartenderReady = value; },
        });
        if (bartenderClient) installBartenderCommandHandler(bartenderClient);
    }

    if (!err02Client && liveConfig.err02Token) {
        err02Client = await loginCharacter({
            token: liveConfig.err02Token,
            label: "ERR_02",
            onReady: (value) => { err02Ready = value; },
        });
    }

    if (!coreClient && liveConfig.coreToken) {
        coreClient = await loginCharacter({
            token: liveConfig.coreToken,
            label: "TAVERN CORE",
            onReady: (value) => { coreReady = value; },
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

async function sendWebhookEntity(mainClient, channelId, { username, avatarURL, content }) {
    const hook = await getWebhook(mainClient, channelId);
    if (hook) {
        return hook.send({
            content,
            username,
            avatarURL: avatarURL || undefined,
            allowedMentions: { parse: [] },
        });
    }

    const channel = await mainClient.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) throw new Error(`Channel ${channelId} is not text based.`);
    return channel.send({
        content: `**${username}**\n${content}`,
        allowedMentions: { parse: [] },
    });
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

function err02Enabled() {
    if (!liveConfig.guildId) return true;
    return Boolean(liveStore.get(liveConfig.guildId).err02_enabled);
}

async function sendErr02(mainClient, channelId, content) {
    // This is the final gate for every ERR_02 send path, including scripted
    // sequences and webhook fallback. Turning ERR_02 off therefore silences it
    // without disconnecting the character client or stopping the other entities.
    if (!err02Enabled()) return null;

    if (err02Ready && err02Client) {
        const sent = await sendWithClient(err02Client, channelId, content).catch(() => null);
        if (sent) return sent;
    }

    return sendWebhookEntity(mainClient, channelId, {
        username: liveConfig.err02Name,
        avatarURL: liveConfig.err02AvatarUrl,
        content,
    });
}

async function sendCore(mainClient, channelId, content) {
    if (coreReady && coreClient) {
        const sent = await sendWithClient(coreClient, channelId, content).catch(() => null);
        if (sent) return sent;
    }

    return sendWebhookEntity(mainClient, channelId, {
        username: liveConfig.coreName,
        avatarURL: liveConfig.coreAvatarUrl,
        content,
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
        err02Enabled: err02Enabled(),
        err02UserId: err02Client?.user?.id || null,
        err02Mode: err02Ready ? "bot" : "webhook-fallback",
        coreReady,
        coreUserId: coreClient?.user?.id || null,
        coreMode: coreReady ? "bot" : "webhook-fallback",
    };
}

function shutdown() {
    bartenderClient?.destroy();
    err02Client?.destroy();
    coreClient?.destroy();
    bartenderClient = null;
    err02Client = null;
    coreClient = null;
    bartenderReady = false;
    err02Ready = false;
    coreReady = false;
}

module.exports = {
    initLiveEntities,
    sendBartender,
    sendErr02,
    sendCore,
    bartenderUserId,
    status,
    shutdown,
};
