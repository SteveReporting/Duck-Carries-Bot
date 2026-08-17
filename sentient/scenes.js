const { EmbedBuilder } = require("discord.js");
const { config, channelId } = require("./config");
const store = require("./store");
const { sendAsEntity } = require("./bartender");

function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickChannel(primary, fallback = "tavernChat") {
    return channelId(primary) || channelId(fallback);
}

async function getTextChannel(client, id) {
    if (!id) return null;
    const channel = await client.channels.fetch(id).catch(() => null);
    return channel?.isTextBased?.() ? channel : null;
}

async function snapshotChannelName(client, guildId, channel) {
    if (!channel || typeof channel.setName !== "function") return;

    const state = store.getState(guildId);
    const snapshot = { ...state.snapshot };
    snapshot.channels = { ...(snapshot.channels || {}) };

    if (!snapshot.channels[channel.id]) {
        snapshot.channels[channel.id] = { name: channel.name };
        store.setSnapshot(guildId, snapshot);
    }
}

async function restoreSnapshot(client, guildId) {
    const state = store.getState(guildId);
    const channels = state.snapshot?.channels || {};

    for (const [id, saved] of Object.entries(channels)) {
        const channel = await client.channels.fetch(id).catch(() => null);
        if (!channel || typeof channel.setName !== "function" || !saved?.name) continue;
        if (channel.name === saved.name) continue;

        try {
            await channel.setName(saved.name, "Project Sentient restore");
        } catch (error) {
            console.warn(`[SENTIENT] Failed to restore channel ${id}: ${error.message}`);
        }
    }

    store.clearSnapshot(guildId);
}

async function sceneWatching(client) {
    await sendAsEntity(client, {
        channelId: pickChannel("tavernChat"),
        content: "You lot went back to talking rather quickly.",
    });
}

async function sceneVaultEcho(client) {
    const embeds = [];

    if (config.treasuryImageUrl) {
        embeds.push(
            new EmbedBuilder()
                .setImage(config.treasuryImageUrl)
                .setFooter({ text: "FILE RECOVERED // TREASURY" })
        );
    }

    await sendAsEntity(client, {
        channelId: pickChannel("images"),
        content: config.treasuryImageUrl ? "Found one." : "The vault was open for a reason.",
        embeds,
    });
}

async function sceneSecondSignal(client) {
    const target = pickChannel("tavernChat");

    const signal = await sendAsEntity(client, {
        channelId: target,
        content: "hello?",
        displayName: "[ERR_02]",
        kind: "entity_02",
        forceWebhook: true,
    });

    await wait(6500);

    await sendAsEntity(client, {
        channelId: target,
        content: "Don't answer it.",
    });

    setTimeout(() => {
        signal?.delete?.().catch(() => {});
    }, 30000).unref?.();
}

async function sceneBreach(client) {
    const guildId = config.guildId;
    const tavernChatId = pickChannel("tavernChat");
    const eventChannelId = pickChannel("carryEvents");

    await sendAsEntity(client, {
        channelId: eventChannelId,
        content: "Cellar door is open again.",
    });

    if (config.allowChannelRenames) {
        const tavernChannel = await getTextChannel(client, tavernChatId);
        if (tavernChannel && typeof tavernChannel.setName === "function") {
            await snapshotChannelName(client, guildId, tavernChannel);
            await tavernChannel.setName("the-gates-are-open", "Project Sentient breach scene");
        }
    }

    const target = await getTextChannel(client, tavernChatId);
    if (target) {
        await target.send({
            content: "# THE GATES ARE OPEN.\n`PROJECT SENTIENT // BREACH DETECTED`",
            allowedMentions: { parse: [] },
        });
    }
}

async function sceneFinale(client) {
    const announcementId = pickChannel("announcements");

    await sendAsEntity(client, {
        channelId: announcementId,
        content: "@everyone they're here.",
        allowedMentions: { parse: ["everyone"] },
    });

    // Keep the breach look around long enough to be noticed, then put temporary names back.
    setTimeout(() => {
        restoreSnapshot(client, config.guildId).catch((error) => {
            console.warn(`[SENTIENT] Delayed restore failed: ${error.message}`);
        });
    }, 90000).unref?.();
}

const SCENES = {
    watching: sceneWatching,
    vault_echo: sceneVaultEcho,
    second_signal: sceneSecondSignal,
    breach: sceneBreach,
    finale: sceneFinale,
};

async function executeScene(sceneId, client) {
    const scene = SCENES[sceneId];
    if (!scene) throw new Error(`Unknown Project Sentient scene: ${sceneId}`);

    console.log(`[SENTIENT] Executing scene: ${sceneId}`);
    await scene(client);
}

module.exports = {
    executeScene,
    restoreSnapshot,
    SCENES,
};
