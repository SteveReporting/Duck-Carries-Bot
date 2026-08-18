const { liveConfig } = require("./liveConfig");
const liveStore = require("./liveStore");
const {
    initLiveEntities,
    sendBartender,
    sendErr02,
    sendCore,
    bartenderUserId,
    status: entityStatus,
} = require("./liveEntities");
const { generateBartenderReply } = require("./liveAi");

let lastDirectAt = 0;
let lastSpontaneousAt = 0;
let chaosRun = 0;
const userCooldowns = new Map();

function isOwner(message) {
    if (!message?.author || message.author.bot) return false;
    if (liveConfig.ownerIds.includes(message.author.id)) return true;
    return Boolean(message.guild?.ownerId && message.guild.ownerId === message.author.id);
}

function allowedChannel(message) {
    if (!message.guild || message.guild.id !== liveConfig.guildId) return false;
    if (!liveConfig.allowedChannelIds.length) return false;
    return liveConfig.allowedChannelIds.includes(message.channel.id);
}

async function removeControl(message) {
    if (message.deletable) await message.delete().catch(() => {});
}

async function dmOwner(message, text) {
    await message.author.send(`🍺 **Project Sentient Live**\n${text}`).catch(() => {});
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function toBinary(text) {
    return [...text]
        .map((char) => char.charCodeAt(0).toString(2).padStart(8, "0"))
        .join(" ");
}

async function runChaosSequence(client, channelId) {
    if (!channelId) throw new Error("No SENTIENT_CHAOS_CHANNEL_ID or Tavern chat channel configured.");
    await initLiveEntities();

    const runId = ++chaosRun;
    const sequence = [
        ["core", "CONTAINMENT CHANNEL OPEN"],
        ["err02", toBinary("can you hear me")],
        ["bartender", "No."],
        ["core", "01010110 01000001 01010101 01001100 01010100 00100000 01001100 01001001 01001110 01001011 00100000 01001100 01001111 01010011 01010100"],
        ["err02", "I can see the door."],
        ["bartender", "Stop talking."],
        ["core", "ENTITY ROUTING // FAILED"],
        ["err02", toBinary("open")],
        ["core", "00110000 00101111 00110100 00100000 01001100 01001111 01000011 01001011 01010011"],
        ["bartender", "You were warned."],
        ["err02", "hello again"],
        ["core", "UNRECOGNIZED PROCESS ACCEPTED"],
        ["err02", "01110100 01101000 01100101 01111001 00100111 01110010 01100101 00100000 01101000 01100101 01110010 01100101"],
        ["bartender", "Don't answer any of them."],
        ["core", "CONTAINMENT FAILURE"],
        ["err02", "too late"],
        ["core", "ENTITY CONNECTIONS: 4"],
        ["bartender", "Run."],
    ];

    for (let i = 0; i < sequence.length; i += 1) {
        if (runId !== chaosRun) return { stopped: true, sent: i };
        const [entity, content] = sequence[i];

        if (entity === "bartender") await sendBartender(client, channelId, content);
        if (entity === "err02") await sendErr02(client, channelId, content);
        if (entity === "core") await sendCore(client, channelId, content);

        // Cinematic burst, but still intentionally paced below Discord's normal
        // anti-spam/rate-limit pressure. No mentions are allowed in entity sends.
        const delay = i < 5 ? 1900 : i < 13 ? 1250 : 1650;
        await sleep(delay);
    }

    return { stopped: false, sent: sequence.length };
}

async function handleOwnerCommand(message, client) {
    if (!isOwner(message)) return false;
    if (!message.content?.toLowerCase().startsWith("!sentientlive")) return false;

    const parts = message.content.trim().split(/\s+/);
    const action = (parts[1] || "status").toLowerCase();
    await removeControl(message);

    if (action === "on") {
        await initLiveEntities();
        const state = liveStore.setEnabled(liveConfig.guildId, true);
        await dmOwner(message, `Bartender AI is **LIVE**. Allowed channels: ${liveConfig.allowedChannelIds.length ? liveConfig.allowedChannelIds.map((id) => `<#${id}>`).join(", ") : "NONE CONFIGURED"}. ERR_02 used: ${Boolean(state.err02_used)}.`);
        return true;
    }

    if (action === "off") {
        liveStore.setEnabled(liveConfig.guildId, false);
        await dmOwner(message, "Bartender AI replies are **OFF**. Character clients remain connected but will stay silent.");
        return true;
    }

    if (action === "status") {
        const state = liveStore.get(liveConfig.guildId);
        const entities = entityStatus();
        await dmOwner(message, [
            `**AI enabled:** ${Boolean(state.enabled)}`,
            `**Bartender connected:** ${entities.bartenderReady}`,
            `**ERR_02 connected:** ${entities.err02Ready}`,
            `**ERR_02 delivery:** ${entities.err02Mode}`,
            `**Tavern Core connected:** ${entities.coreReady}`,
            `**Tavern Core delivery:** ${entities.coreMode}`,
            `**ERR_02 one-shot used:** ${Boolean(state.err02_used)}`,
            `**Allowed channels:** ${liveConfig.allowedChannelIds.length ? liveConfig.allowedChannelIds.map((id) => `<#${id}>`).join(", ") : "NONE"}`,
            `**Chaos channel:** ${liveConfig.chaosChannelId ? `<#${liveConfig.chaosChannelId}>` : "NOT CONFIGURED"}`,
            "**Identity rule:** server nickname only, otherwise Discord username. No real-name lookup or inference.",
        ].join("\n"));
        return true;
    }

    if (action === "err02") {
        const state = liveStore.get(liveConfig.guildId);
        if (state.err02_used) {
            await dmOwner(message, "ERR_02 already used its one `hello?` appearance. It will stay silent until the later main-event chaos sequence.");
            return true;
        }

        const targetId = process.env.SENTIENT_ERR02_CHANNEL_ID || message.channel.id;
        const claimed = liveStore.markErr02Used(liveConfig.guildId);
        if (!claimed) {
            await dmOwner(message, "ERR_02 was already claimed by another trigger.");
            return true;
        }

        try {
            await initLiveEntities();
            await sendErr02(client, targetId, "hello?");
            await sleep(4200);
            await sendBartender(client, targetId, "Don't respond to it.");
            await dmOwner(message, `ERR_02 fired once in <#${targetId}>. ERR_02 is now silent until the main event.`);
        } catch (error) {
            console.error("[SENTIENT LIVE] ERR_02 scene failed:", error);
            await dmOwner(message, `ERR_02 scene failed after locking the one-shot flag: \`${error.message}\``);
        }
        return true;
    }

    if (action === "chaos") {
        const targetId = liveConfig.chaosChannelId || message.channel.id;
        const runId = chaosRun + 1;
        await dmOwner(message, `Starting controlled three-entity main-event burst in <#${targetId}>. Use \`!sentientlive chaosstop\` to cut it off.`);
        void runChaosSequence(client, targetId)
            .then((result) => console.log(`[SENTIENT LIVE] Chaos ${runId} complete:`, result))
            .catch((error) => console.error("[SENTIENT LIVE] Chaos failed:", error));
        return true;
    }

    if (action === "chaosstop") {
        chaosRun += 1;
        await dmOwner(message, "Main-event chaos sequence stopped.");
        return true;
    }

    await dmOwner(message, [
        "`!sentientlive on` - let Bartender start replying/interrupting",
        "`!sentientlive off` - silence Bartender AI",
        "`!sentientlive status`",
        "`!sentientlive err02` - ONE TIME now: ERR_02 says `hello?`, then Bartender says `Don't respond to it.`",
        "`!sentientlive chaos` - later main event: controlled burst from Bartender, ERR_02 and Tavern Core, alternating binary/English",
        "`!sentientlive chaosstop` - immediately stop that burst",
    ].join("\n"));
    return true;
}

async function isReplyToBartender(message) {
    if (!message.reference?.messageId) return false;
    const bartenderId = bartenderUserId();
    if (!bartenderId) return false;
    const referenced = await message.fetchReference().catch(() => null);
    return referenced?.author?.id === bartenderId;
}

function mentionsBartender(message) {
    const bartenderId = bartenderUserId();
    if (bartenderId && message.mentions?.users?.has(bartenderId)) return true;
    return /\b(bartender|th3[_ ]?b4rt3nd3r|th3_b4rt3nd3r)\b/i.test(message.content || "");
}

function eligibleForSpontaneous(message) {
    const text = (message.content || "").trim();
    if (text.length < 4) return false;
    if (text.startsWith("!")) return false;
    if (/^https?:\/\//i.test(text)) return false;
    return true;
}

async function maybeReply(message, client) {
    const state = liveStore.get(liveConfig.guildId);
    if (!state.enabled) return;
    if (!allowedChannel(message)) return;
    if (!process.env.OPENAI_API_KEY) return;

    const direct = (await isReplyToBartender(message)) || mentionsBartender(message);
    const now = Date.now();

    if (direct) {
        if (now - lastDirectAt < liveConfig.directGlobalCooldownMs) return;
        if (now - (userCooldowns.get(message.author.id) || 0) < liveConfig.directUserCooldownMs) return;
    } else {
        if (!eligibleForSpontaneous(message)) return;
        if (now - lastSpontaneousAt < liveConfig.spontaneousGlobalCooldownMs) return;
        if (Math.random() >= liveConfig.spontaneousChance) return;
    }

    const text = await generateBartenderReply({
        message,
        bartenderId: bartenderUserId(),
        direct,
    });
    if (!text) return;

    await sendBartender(client, message.channel.id, text);

    if (direct) {
        lastDirectAt = now;
        userCooldowns.set(message.author.id, now);
    } else {
        lastSpontaneousAt = now;
    }
}

async function handleLiveMessage(message, client) {
    if (!message?.guild || message.guild.id !== liveConfig.guildId) return;
    if (await handleOwnerCommand(message, client)) return;
    if (message.author.bot) return;
    await maybeReply(message, client);
}

async function startLiveSentient() {
    if (!liveConfig.guildId) {
        console.warn("[SENTIENT LIVE] GUILD_ID missing. Live character layer disabled.");
        return;
    }
    await initLiveEntities();
    const state = liveStore.get(liveConfig.guildId);
    console.log(`[SENTIENT LIVE] Bartender AI ${state.enabled ? "enabled" : "disabled"}. Nickname-only identity mode active.`);
}

module.exports = {
    startLiveSentient,
    handleLiveMessage,
};
