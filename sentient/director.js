const { config, getSchedule, getMissingRequiredChannels } = require("./config");
const store = require("./store");
const { initBartender, sendAsEntity, isBartenderReady } = require("./bartender");
const { executeScene, restoreSnapshot, SCENES } = require("./scenes");
const { generateBartenderReply } = require("./ai");

const TICK_MS = 10000;
const GLOBAL_AI_COOLDOWN_MS = 90 * 1000;
const USER_AI_COOLDOWN_MS = 8 * 60 * 1000;

let tickTimer = null;
let ticking = false;
let lastAiAt = 0;
const userAiCooldown = new Map();

function formatDuration(ms) {
    if (ms <= 0) return "now";
    const minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

async function notifyOwners(client, text) {
    const ids = new Set(config.ownerIds);
    const guild = config.guildId
        ? await client.guilds.fetch(config.guildId).catch(() => null)
        : null;

    if (guild?.ownerId) ids.add(guild.ownerId);

    for (const id of ids) {
        const user = await client.users.fetch(id).catch(() => null);
        if (!user) continue;
        await user.send(`🍺 **Project Sentient**\n${text}`).catch(() => {});
    }
}

function isOwnerMessage(message) {
    if (!message?.author || message.author.bot) return false;
    if (config.ownerIds.includes(message.author.id)) return true;
    return Boolean(message.guild?.ownerId && message.guild.ownerId === message.author.id);
}

async function quietlyRemoveControlMessage(message) {
    if (!message.deletable) return;
    await message.delete().catch(() => {});
}

async function runScene(client, state, scene, { manual = false } = {}) {
    try {
        await executeScene(scene.id, client);
        const updated = store.advance(config.guildId, scene.id);

        if (scene.id === "finale") {
            store.stop(config.guildId);
            await notifyOwners(
                client,
                "The finale fired successfully. `@everyone they're here.` is live. Post the human **PROJECT SENTIENT** reveal now."
            );
        } else if (manual) {
            await notifyOwners(client, `Forced scene **${scene.id}**. Next scene index is ${updated.nextScene}.`);
        }

        return true;
    } catch (error) {
        store.setPaused(config.guildId, true);
        console.error(`[SENTIENT] Scene ${scene.id} failed:`, error);
        await notifyOwners(
            client,
            `Scene **${scene.id}** failed and the director paused itself.\n\`${error.message}\``
        );
        return false;
    }
}

async function tick(client) {
    if (ticking || !config.guildId) return;
    ticking = true;

    try {
        const state = store.getState(config.guildId);
        if (!state.active || state.paused || !state.startedAt) return;

        const schedule = getSchedule(state.pace);
        const scene = schedule[state.nextScene];

        if (!scene) {
            store.stop(config.guildId);
            return;
        }

        const dueAt = state.startedAt + scene.afterMs;
        if (Date.now() < dueAt) return;

        await runScene(client, state, scene);
    } finally {
        ticking = false;
    }
}

async function handleOwnerCommand(message, client) {
    if (!isOwnerMessage(message)) return false;
    if (!message.content.toLowerCase().startsWith("!sentient")) return false;

    await quietlyRemoveControlMessage(message);

    const parts = message.content.trim().split(/\s+/);
    const action = (parts[1] || "status").toLowerCase();
    const argument = (parts[2] || "").toLowerCase();
    let state = store.getState(config.guildId);

    if (action === "start") {
        if (state.active) {
            await message.author.send("Project Sentient is already active. Use `!sentient status` or `!sentient next`.").catch(() => {});
            return true;
        }

        const missing = getMissingRequiredChannels();
        if (missing.length) {
            await message.author.send(
                `Project Sentient cannot start yet. Missing environment values:\n${missing.map((item) => `- ${item}`).join("\n")}`
            ).catch(() => {});
            return true;
        }

        const pace = argument === "normal" ? "normal" : "fast";
        state = store.start(config.guildId, pace);
        await initBartender();
        await message.author.send(
            `Project Sentient started in **${pace.toUpperCase()}** mode. Day 1 is treated as already complete. First automated scene fires in ${formatDuration(getSchedule(pace)[0].afterMs)}.`
        ).catch(() => {});
        return true;
    }

    if (action === "status") {
        const schedule = getSchedule(state.pace);
        const scene = schedule[state.nextScene];
        const dueIn = scene && state.startedAt
            ? formatDuration((state.startedAt + scene.afterMs) - Date.now())
            : "n/a";

        await message.author.send([
            `**Active:** ${state.active}`,
            `**Paused:** ${state.paused}`,
            `**Pace:** ${state.pace}`,
            `**Last scene:** ${state.lastScene || "none"}`,
            `**Next scene:** ${scene?.id || "none"}`,
            `**Due:** ${dueIn}`,
            `**Bartender bot connected:** ${isBartenderReady()}`,
        ].join("\n")).catch(() => {});
        return true;
    }

    if (action === "pause") {
        store.setPaused(config.guildId, true);
        await message.author.send("Project Sentient paused. No scheduled scenes or AI replies will fire.").catch(() => {});
        return true;
    }

    if (action === "resume") {
        store.setPaused(config.guildId, false);
        await message.author.send("Project Sentient resumed.").catch(() => {});
        return true;
    }

    if (action === "next") {
        if (!state.active) {
            await message.author.send("Project Sentient is not active.").catch(() => {});
            return true;
        }
        const scene = getSchedule(state.pace)[state.nextScene];
        if (!scene) {
            await message.author.send("There are no scenes left to fire.").catch(() => {});
            return true;
        }
        await runScene(client, state, scene, { manual: true });
        return true;
    }

    if (action === "scene") {
        if (!SCENES[argument]) {
            await message.author.send(`Unknown scene. Valid scenes: ${Object.keys(SCENES).join(", ")}`).catch(() => {});
            return true;
        }
        try {
            await executeScene(argument, client);
            await message.author.send(`Fired **${argument}** without changing the timeline.`).catch(() => {});
        } catch (error) {
            await message.author.send(`Scene failed: \`${error.message}\``).catch(() => {});
        }
        return true;
    }

    if (action === "restore") {
        await restoreSnapshot(client, config.guildId);
        await message.author.send("Any temporary Project Sentient channel names were restored.").catch(() => {});
        return true;
    }

    if (action === "stop") {
        store.stop(config.guildId);
        await restoreSnapshot(client, config.guildId);
        await message.author.send("Project Sentient stopped and temporary channel names were restored.").catch(() => {});
        return true;
    }

    await message.author.send([
        "**Hidden Project Sentient controls**",
        "`!sentient start fast` - remaining story in about 5 hours",
        "`!sentient start normal` - remaining story in about 18 hours",
        "`!sentient status`",
        "`!sentient next` - fire the next scheduled scene immediately",
        "`!sentient scene <name>` - test a scene without advancing",
        "`!sentient pause` / `!sentient resume`",
        "`!sentient restore`",
        "`!sentient stop`",
    ].join("\n")).catch(() => {});
    return true;
}

function isArcaneLevelMessage(message) {
    if (!message.author?.bot) return false;
    if (config.arcaneBotId && message.author.id !== config.arcaneBotId) return false;
    if (!config.arcaneBotId && message.author.username !== "ArcaneAPP") return false;
    return /just reached Level\s+\d+/i.test(message.content || "");
}

async function maybeRunLevelGlitch(message, client, state) {
    if (!isArcaneLevelMessage(message) || state.flags.levelGlitchUsed) return false;

    store.setFlag(config.guildId, "levelGlitchUsed", true);

    setTimeout(async () => {
        try {
            const reply = await sendAsEntity(client, {
                channelId: message.channel.id,
                content: "He sees you climbing.",
            });

            setTimeout(() => {
                reply?.delete?.().catch(() => {});
            }, 10000).unref?.();
        } catch (error) {
            console.warn(`[SENTIENT] Level glitch failed: ${error.message}`);
        }
    }, 1500).unref?.();

    return true;
}

async function messageRepliesToBartender(message) {
    const referencedId = message.reference?.messageId;
    if (!referencedId) return false;
    return store.isBartenderMessage(referencedId);
}

function shouldConsiderAi(message) {
    const text = message.content || "";
    if (/\b(bartender|th3[_ ]?b4rt3nd3r|project sentient)\b/i.test(text)) return true;
    if (/\btroll\b/i.test(text) && Math.random() < 0.35) return true;
    return false;
}

async function maybeReplyAsBartender(message, client, state) {
    if (!config.aiReplies || !process.env.OPENAI_API_KEY) return;

    const directReply = await messageRepliesToBartender(message);
    if (!directReply && !shouldConsiderAi(message)) return;

    const current = Date.now();
    if (current - lastAiAt < GLOBAL_AI_COOLDOWN_MS) return;
    if (current - (userAiCooldown.get(message.author.id) || 0) < USER_AI_COOLDOWN_MS) return;

    let replyText = null;
    if (/project sentient/i.test(message.content || "") && state.lastScene !== "finale") {
        replyText = "You weren't supposed to know that name yet.";
    } else {
        replyText = await generateBartenderReply({ message, state });
    }

    if (!replyText) return;

    await sendAsEntity(client, {
        channelId: message.channel.id,
        content: replyText,
    });

    lastAiAt = current;
    userAiCooldown.set(message.author.id, current);
}

async function handleMessage(message, client) {
    if (!message) return;
    if (config.guildId && message.guild?.id && message.guild.id !== config.guildId) return;

    if (await handleOwnerCommand(message, client)) return;
    if (!message.guild || message.guild.id !== config.guildId) return;

    const state = store.getState(config.guildId);
    if (!state.active || state.paused) return;

    if (message.author.bot) {
        await maybeRunLevelGlitch(message, client, state);
        return;
    }

    await maybeReplyAsBartender(message, client, state);
}

async function startDirector(client) {
    if (!config.guildId) {
        console.warn("[SENTIENT] GUILD_ID is missing. Director disabled.");
        return;
    }

    await initBartender();

    if (!tickTimer) {
        tickTimer = setInterval(() => {
            tick(client).catch((error) => console.error("[SENTIENT] Tick failed:", error));
        }, TICK_MS);
        tickTimer.unref?.();
    }

    const state = store.getState(config.guildId);
    if (state.active) {
        console.log(`[SENTIENT] Resuming active timeline at scene index ${state.nextScene} (${state.pace}).`);
    } else if (Object.keys(state.snapshot || {}).length > 0) {
        await restoreSnapshot(client, config.guildId);
    }
}

module.exports = {
    startDirector,
    handleMessage,
    tick,
};
