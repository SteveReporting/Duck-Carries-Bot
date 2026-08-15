require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    GatewayIntentBits,
    PermissionFlagsBits,
    OverwriteType,
} = require("discord.js");

const MARKER = path.join(__dirname, "permission-fast-applied.marker");
const REPORT = path.join(__dirname, "permission-fast-report.json");

if (!process.env.TOKEN || !process.env.GUILD_ID) {
    console.error("❌ TOKEN and GUILD_ID are required in .env");
    process.exit(1);
}

if (fs.existsSync(MARKER)) {
    console.log("🍺 Fast permission plan already completed once.");
    console.log("Delete permission-fast-applied.marker only if you intentionally want to run it again.");
    process.exit(0);
}

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const report = {
    startedAt: new Date().toISOString(),
    changedChannels: [],
    skipped: [],
    errors: [],
    backupFile: null,
};

function normalizeName(value) {
    return String(value || "")
        .normalize("NFKD")
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim()
        .toLowerCase();
}

function unique(items) {
    return [...new Map(items.filter(Boolean).map((item) => [item.id, item])).values()];
}

function findUnique(items, wanted, kind) {
    const target = normalizeName(wanted);
    const matches = items.filter((item) => normalizeName(item.name) === target);

    if (matches.length === 1) return matches[0];

    const message = matches.length === 0
        ? `${kind} "${wanted}" not found`
        : `${kind} "${wanted}" is ambiguous`;

    report.skipped.push(message);
    console.warn(`⚠️ ${message}`);
    return null;
}

function makeBackup(guild) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(__dirname, `permission-fast-backup-${stamp}.json`);

    const data = {
        createdAt: new Date().toISOString(),
        guildId: guild.id,
        guildName: guild.name,
        channels: [...guild.channels.cache.values()].map((channel) => ({
            id: channel.id,
            name: channel.name,
            parentId: channel.parentId,
            type: channel.type,
            overwrites: [...channel.permissionOverwrites.cache.values()].map((overwrite) => ({
                id: overwrite.id,
                type: overwrite.type,
                allow: overwrite.allow.toArray(),
                deny: overwrite.deny.toArray(),
            })),
        })),
    };

    fs.writeFileSync(backupFile, JSON.stringify(data, null, 2), "utf8");
    report.backupFile = backupFile;
    console.log(`💾 Backup written: ${backupFile}`);
}

function cloneOverwrites(channel) {
    const map = new Map();

    for (const overwrite of channel.permissionOverwrites.cache.values()) {
        map.set(overwrite.id, {
            id: overwrite.id,
            type: overwrite.type,
            allow: overwrite.allow.bitfield,
            deny: overwrite.deny.bitfield,
        });
    }

    return map;
}

function patchTarget(map, target, permissions, guild) {
    if (!target) return;

    const id = target.id;
    const type = id === guild.roles.everyone.id || target.permissions
        ? OverwriteType.Role
        : OverwriteType.Member;

    const current = map.get(id) || {
        id,
        type,
        allow: 0n,
        deny: 0n,
    };

    let allow = BigInt(current.allow);
    let deny = BigInt(current.deny);

    for (const [permissionName, value] of Object.entries(permissions)) {
        if (value === undefined) continue;

        const bit = PermissionFlagsBits[permissionName];
        if (bit === undefined) throw new Error(`Unknown permission: ${permissionName}`);

        if (value === true) {
            allow |= bit;
            deny &= ~bit;
        } else if (value === false) {
            deny |= bit;
            allow &= ~bit;
        } else {
            allow &= ~bit;
            deny &= ~bit;
        }
    }

    map.set(id, {
        id,
        type: current.type,
        allow,
        deny,
    });
}

async function applyChannel(channel, guild, patches, label) {
    if (!channel) return;

    const overwriteMap = cloneOverwrites(channel);

    for (const patch of patches) {
        for (const target of unique(patch.targets || [])) {
            patchTarget(overwriteMap, target, patch.permissions, guild);
        }
    }

    const payload = [...overwriteMap.values()].map((overwrite) => ({
        id: overwrite.id,
        type: overwrite.type,
        allow: overwrite.allow,
        deny: overwrite.deny,
    }));

    console.log(`⏳ Applying ${label || channel.name}...`);

    try {
        await channel.permissionOverwrites.set(
            payload,
            "The Carry Tavern fast permission plan"
        );

        report.changedChannels.push({ id: channel.id, name: channel.name });
        console.log(`✅ ${channel.name} complete`);
    } catch (error) {
        const message = `${channel.name}: ${error.message}`;
        report.errors.push(message);
        console.error(`❌ ${message}`);
    }
}

const P = {
    publicReadOnly: {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
    },
    viewSend: {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: true,
    },
    viewOnly: {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
    },
    hidden: {
        ViewChannel: false,
    },
};

async function main() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();

    console.log("=================================================");
    console.log(`🍺 FAST PERMISSION PASS: ${guild.name}`);
    console.log("One bulk Discord request per channel.");
    console.log("Existing user/bot-specific overwrites are preserved.");
    console.log("=================================================");

    const roles = [...guild.roles.cache.values()];
    const channels = [...guild.channels.cache.values()];

    const role = (name) => findUnique(roles, name, "Role");
    const channel = (name) => findUnique(channels, name, "Channel");

    const R = {
        proprietor: role("Tavern Proprietor"),
        tavernmaster: role("Tavernmaster"),
        highInnkeeper: role("High Innkeeper"),
        innkeeper: role("Innkeeper"),
        warden: role("Tavern Warden"),
        bouncer: role("Bouncer"),
        doorhand: role("Doorhand"),
        masterTap: role("Master of the Tap"),
        brewmaster: role("Brewmaster"),
        tapmaster: role("Tapmaster"),
        caskkeeper: role("Caskkeeper"),
        bartender: role("Bartender"),
        barback: role("Barback"),
        legend: role("Tavern Legend"),
        veteran: role("Veteran Regular"),
        regular: role("Regular"),
        patron: role("Patron"),
        traveller: role("Traveller"),
    };

    const community = unique([R.traveller, R.patron, R.regular, R.veteran, R.legend]);
    const patronPlus = unique([R.patron, R.regular, R.veteran, R.legend]);
    const carriers = unique([R.barback, R.bartender, R.caskkeeper, R.tapmaster, R.brewmaster, R.masterTap]);
    const carrierLeadership = unique([R.brewmaster, R.masterTap]);
    const mods = unique([R.doorhand, R.bouncer, R.warden]);
    const admins = unique([R.innkeeper, R.highInnkeeper, R.tavernmaster, R.proprietor]);
    const staff = unique([...mods, ...admins]);
    const communityPlus = unique([...community, ...carriers, ...staff]);
    const allNamed = unique([...community, ...carriers, ...staff]);
    const everyone = guild.roles.everyone;

    if (!admins.length || !mods.length || !community.length || !carriers.length) {
        console.error("❌ Too many key Tavern roles are missing. Aborting before changes.");
        process.exitCode = 1;
        return;
    }

    makeBackup(guild);

    for (const name of ["rules", "server-guide", "faq"]) {
        const c = channel(name);
        await applyChannel(c, guild, [
            { targets: [everyone], permissions: P.publicReadOnly },
            { targets: allNamed, permissions: P.publicReadOnly },
        ], name);
    }

    await applyChannel(channel("announcements"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: unique([...community, ...carriers, ...mods]), permissions: P.viewOnly },
        { targets: admins, permissions: P.viewSend },
    ], "announcements");

    await applyChannel(channel("roles"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: allNamed, permissions: P.publicReadOnly },
    ], "roles");

    await applyChannel(channel("role-request"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: communityPlus, permissions: P.viewSend },
    ], "role-request");

    await applyChannel(channel("carrier-roles"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: community, permissions: P.hidden },
        { targets: carriers, permissions: P.viewOnly },
        { targets: unique([...carrierLeadership, ...staff]), permissions: P.viewSend },
    ], "carrier-roles");

    for (const name of ["giveaways", "events"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.publicReadOnly },
            { targets: allNamed, permissions: P.publicReadOnly },
        ], name);
    }

    await applyChannel(channel("tournaments"), guild, [
        { targets: [everyone, ...allNamed], permissions: { ViewChannel: true, ReadMessageHistory: true } },
    ], "tournaments (send state preserved)");

    for (const name of ["tavern-chat", "suggestions", "bot-commands"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: communityPlus, permissions: P.viewSend },
        ], name);
    }

    for (const name of ["media", "item-drops"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: communityPlus, permissions: { ...P.viewSend, AttachFiles: true, EmbedLinks: true } },
        ], name);
    }

    await applyChannel(channel("tavern-trades"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: [R.traveller], permissions: P.viewOnly },
        { targets: unique([...patronPlus, ...carriers, ...staff]), permissions: P.viewSend },
    ], "tavern-trades");

    await applyChannel(channel("trade-offers"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: [R.traveller], permissions: P.viewOnly },
        { targets: unique([...patronPlus, ...carriers, ...staff]), permissions: { ...P.viewSend, AttachFiles: true, EmbedLinks: true } },
    ], "trade-offers");

    await applyChannel(channel("trade-vouches"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: [R.traveller], permissions: P.viewOnly },
        { targets: unique([...patronPlus, ...carriers, ...staff]), permissions: P.viewSend },
    ], "trade-vouches");

    await applyChannel(channel("safe-trading"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: allNamed, permissions: P.publicReadOnly },
    ], "safe-trading");

    for (const name of ["request-carry", "carry-queue"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: communityPlus, permissions: P.viewOnly },
        ], name);
    }

    await applyChannel(channel("tavern-records"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: allNamed, permissions: P.publicReadOnly },
    ], "tavern-records");

    await applyChannel(channel("carry-proof"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: community, permissions: P.viewOnly },
        { targets: unique([...carriers, ...staff]), permissions: { ...P.viewSend, AttachFiles: true, EmbedLinks: true } },
    ], "carry-proof");

    await applyChannel(channel("carry-events"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: unique([...community, ...carriers, ...mods]), permissions: P.viewOnly },
        { targets: unique([...carrierLeadership, ...admins]), permissions: P.viewSend },
    ], "carry-events");

    await applyChannel(channel("become-a-carrier"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: communityPlus, permissions: { ViewChannel: true, ReadMessageHistory: true } },
    ], "become-a-carrier (send state preserved)");

    await applyChannel(channel("carrier-chat"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: community, permissions: P.hidden },
        { targets: unique([...carriers, ...staff]), permissions: P.viewSend },
    ], "carrier-chat");

    await applyChannel(channel("carrier-news"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: community, permissions: P.hidden },
        { targets: unique([...carriers, ...mods]), permissions: P.viewOnly },
        { targets: unique([...carrierLeadership, ...admins]), permissions: P.viewSend },
    ], "carrier-news");

    for (const name of ["carrier-guide", "carrier-leaderboard"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: community, permissions: P.hidden },
            { targets: unique([...carriers, ...staff]), permissions: P.viewOnly },
        ], name);
    }

    await applyChannel(channel("tickets"), guild, [
        { targets: [everyone], permissions: P.publicReadOnly },
        { targets: allNamed, permissions: P.publicReadOnly },
    ], "tickets panel");

    for (const c of channels.filter((item) => /^ticket-\d+/i.test(item.name))) {
        await applyChannel(c, guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: unique([...community, ...carriers]), permissions: P.hidden },
            { targets: staff, permissions: P.viewSend },
        ], `${c.name} (requester overwrite preserved)`);
    }

    await applyChannel(channel("staff-chat"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: unique([...community, ...carriers]), permissions: P.hidden },
        { targets: staff, permissions: P.viewSend },
    ], "staff-chat");

    await applyChannel(channel("staff-logs"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: unique([...community, ...carriers]), permissions: P.hidden },
        { targets: staff, permissions: { ViewChannel: true, ReadMessageHistory: true } },
    ], "staff-logs (send state preserved)");

    for (const name of ["reports", "staff-commands"]) {
        await applyChannel(channel(name), guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: unique([...community, ...carriers]), permissions: P.hidden },
            { targets: staff, permissions: P.viewSend },
        ], name);
    }

    await applyChannel(channel("transcripts"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: unique([...community, ...carriers.filter((r) => r.id !== R.masterTap?.id)]), permissions: P.hidden },
        { targets: unique([R.masterTap, ...staff]), permissions: P.viewOnly },
    ], "transcripts");

    for (const c of channels.filter((item) => /^tavern-request-/i.test(item.name))) {
        await applyChannel(c, guild, [
            { targets: [everyone], permissions: P.hidden },
            { targets: unique([...community, ...carriers.filter((r) => r.id !== R.masterTap?.id)]), permissions: P.hidden },
            { targets: unique([R.masterTap, ...staff]), permissions: P.viewSend },
        ], `${c.name} (requester overwrite preserved)`);
    }

    await applyChannel(channel("ai-logs"), guild, [
        { targets: [everyone], permissions: P.hidden },
        { targets: unique([...community, ...carriers, ...mods]), permissions: P.hidden },
        { targets: admins, permissions: P.viewOnly },
    ], "ai-logs (bot overwrite preserved)");

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");

    fs.writeFileSync(
        MARKER,
        [
            "The Carry Tavern fast permission plan completed.",
            `Finished: ${report.finishedAt}`,
            `Changed channels: ${report.changedChannels.length}`,
            `Skipped: ${report.skipped.length}`,
            `Errors: ${report.errors.length}`,
            `Backup: ${report.backupFile}`,
            `Report: ${REPORT}`,
        ].join("\n"),
        "utf8"
    );

    console.log("=================================================");
    console.log("✅ THE CARRY TAVERN FAST PERMISSION PASS FINISHED");
    console.log(`Channels processed: ${report.changedChannels.length}`);
    console.log(`Skipped: ${report.skipped.length}`);
    console.log(`Errors: ${report.errors.length}`);
    console.log(`Backup: ${report.backupFile}`);
    console.log(`Report: ${REPORT}`);
    console.log("=================================================");
    console.log("Set Lunafy Main File back to index.js");
}

client.once("clientReady", async () => {
    try {
        await main();
    } catch (error) {
        console.error("❌ FATAL FAST PERMISSION ERROR:", error);
        report.errors.push(`FATAL: ${error.stack || error.message}`);
        report.finishedAt = new Date().toISOString();
        try {
            fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
        } catch {}
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

console.log("🔐 Logging into Discord for fast one-shot permission setup...");
client.login(process.env.TOKEN).catch((error) => {
    console.error("❌ Discord login failed:", error);
    process.exit(1);
});