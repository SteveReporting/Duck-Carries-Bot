require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
    Client,
    GatewayIntentBits,
    ChannelType,
    PermissionFlagsBits,
    OverwriteType,
} = require("discord.js");

const MARKER = path.join(__dirname, "treasury-channels-applied.marker");
const REPORT = path.join(__dirname, "treasury-channels-report.json");

if (!process.env.TOKEN || !process.env.GUILD_ID) {
    console.error("❌ TOKEN and GUILD_ID are required in .env");
    process.exit(1);
}

if (fs.existsSync(MARKER)) {
    console.log("🏦 Treasury channel setup already completed once.");
    console.log("Delete treasury-channels-applied.marker only if you intentionally want to rerun it.");
    process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const report = { created: [], reused: [], changed: [], skipped: [], errors: [] };

const norm = (s) => String(s || "")
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .toLowerCase();

const unique = (items) => [...new Map(items.filter(Boolean).map((x) => [x.id, x])).values()];

function findRole(roles, wanted) {
    const matches = roles.filter((r) => norm(r.name) === norm(wanted));
    if (matches.length === 1) return matches[0];
    const msg = matches.length ? `Role "${wanted}" is ambiguous` : `Role "${wanted}" not found`;
    report.skipped.push(msg);
    console.warn(`⚠️ ${msg}`);
    return null;
}

function cloneOverwrites(channel) {
    const map = new Map();
    for (const o of channel.permissionOverwrites.cache.values()) {
        map.set(o.id, { id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield });
    }
    return map;
}

function patchOverwrite(map, target, permissions, guild) {
    if (!target) return;
    const current = map.get(target.id) || {
        id: target.id,
        type: target.id === guild.id || target.permissions ? OverwriteType.Role : OverwriteType.Member,
        allow: 0n,
        deny: 0n,
    };

    let allow = BigInt(current.allow);
    let deny = BigInt(current.deny);

    for (const [name, value] of Object.entries(permissions)) {
        const bit = PermissionFlagsBits[name];
        if (bit === undefined || value === undefined) continue;
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

    map.set(target.id, { ...current, allow, deny });
}

async function apply(channel, guild, patches, label) {
    if (!channel) return;
    const map = cloneOverwrites(channel);

    for (const patch of patches) {
        for (const target of unique(patch.targets || [])) {
            patchOverwrite(map, target, patch.permissions, guild);
        }
    }

    try {
        await channel.permissionOverwrites.set([...map.values()], `The Carry Tavern Treasury setup: ${label}`);
        report.changed.push(label);
        console.log(`✅ Permissions set: ${label}`);
    } catch (error) {
        report.errors.push(`${label}: ${error.message}`);
        console.error(`❌ ${label}: ${error.message}`);
    }
}

async function ensureCategory(guild, name) {
    await guild.channels.fetch();
    const matches = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildCategory && norm(c.name) === norm(name)
    );

    if (matches.length === 1) {
        report.reused.push(`Category: ${matches[0].name}`);
        console.log(`♻️ Reusing category: ${matches[0].name}`);
        return matches[0];
    }

    if (matches.length > 1) {
        const msg = `Category "${name}" is ambiguous; skipping to avoid duplicates.`;
        report.skipped.push(msg);
        console.warn(`⚠️ ${msg}`);
        return null;
    }

    const created = await guild.channels.create({
        name,
        type: ChannelType.GuildCategory,
        reason: "The Carry Tavern Treasury setup",
    });

    report.created.push(`Category: ${created.name}`);
    console.log(`✅ Created category: ${created.name}`);
    return created;
}

async function ensureText(guild, parent, name) {
    if (!parent) return null;
    await guild.channels.fetch();

    const exactParentMatches = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildText && c.parentId === parent.id && norm(c.name) === norm(name)
    );

    if (exactParentMatches.length === 1) {
        report.reused.push(`Channel: #${exactParentMatches[0].name}`);
        console.log(`♻️ Reusing #${exactParentMatches[0].name}`);
        return exactParentMatches[0];
    }

    if (exactParentMatches.length > 1) {
        const msg = `Channel "${name}" under "${parent.name}" is ambiguous; skipping.`;
        report.skipped.push(msg);
        console.warn(`⚠️ ${msg}`);
        return null;
    }

    const elsewhere = [...guild.channels.cache.values()].filter(
        (c) => c.type === ChannelType.GuildText && norm(c.name) === norm(name)
    );

    if (elsewhere.length === 1) {
        const existing = elsewhere[0];
        try {
            await existing.setParent(parent.id, { lockPermissions: false, reason: "Move Treasury channel into correct category" });
            report.reused.push(`Moved/reused channel: #${existing.name}`);
            console.log(`♻️ Moved/reused #${existing.name} under ${parent.name}`);
            return existing;
        } catch (error) {
            report.errors.push(`Move #${existing.name}: ${error.message}`);
            console.error(`❌ Could not move #${existing.name}: ${error.message}`);
            return existing;
        }
    }

    if (elsewhere.length > 1) {
        const msg = `Multiple #${name} channels exist elsewhere; skipping instead of guessing.`;
        report.skipped.push(msg);
        console.warn(`⚠️ ${msg}`);
        return null;
    }

    const created = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: parent.id,
        reason: "The Carry Tavern Treasury setup",
    });

    report.created.push(`Channel: #${created.name}`);
    console.log(`✅ Created #${created.name}`);
    return created;
}

async function main() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();
    const me = guild.members.me || await guild.members.fetchMe();
    const roles = [...guild.roles.cache.values()];

    console.log("=================================================");
    console.log(`🏦 Setting up Treasury channels for ${guild.name}`);
    console.log("No OpenAI calls. Existing matching channels are reused.");
    console.log("=================================================");

    const R = {
        highTreasurer: findRole(roles, "High Treasurer"),
        treasurer: findRole(roles, "Treasurer"),
        vaultkeeper: findRole(roles, "Vaultkeeper"),
        coinkeeper: findRole(roles, "Coinkeeper"),
        doorhand: findRole(roles, "Doorhand"),
        bouncer: findRole(roles, "Bouncer"),
        warden: findRole(roles, "Tavern Warden"),
        innkeeper: findRole(roles, "Innkeeper"),
        highInnkeeper: findRole(roles, "High Innkeeper"),
        tavernmaster: findRole(roles, "Tavernmaster"),
        proprietor: findRole(roles, "Tavern Proprietor"),
        traveller: findRole(roles, "Traveller"),
        patron: findRole(roles, "Patron"),
        regular: findRole(roles, "Regular"),
        veteran: findRole(roles, "Veteran Regular"),
        legend: findRole(roles, "Tavern Legend"),
        barback: findRole(roles, "Barback"),
        bartender: findRole(roles, "Bartender"),
        caskkeeper: findRole(roles, "Caskkeeper"),
        tapmaster: findRole(roles, "Tapmaster"),
        brewmaster: findRole(roles, "Brewmaster"),
        masterTap: findRole(roles, "Master of the Tap"),
    };

    const treasuryStaff = unique([R.coinkeeper, R.vaultkeeper, R.treasurer, R.highTreasurer]);
    const treasuryLeadership = unique([R.treasurer, R.highTreasurer]);
    const mods = unique([R.doorhand, R.bouncer, R.warden]);
    const admins = unique([R.innkeeper, R.highInnkeeper, R.tavernmaster, R.proprietor]);
    const community = unique([R.traveller, R.patron, R.regular, R.veteran, R.legend]);
    const carriers = unique([R.barback, R.bartender, R.caskkeeper, R.tapmaster, R.brewmaster, R.masterTap]);
    const communityPlus = unique([...community, ...carriers, ...mods, ...admins]);
    const everyone = guild.roles.everyone;

    if (treasuryStaff.length < 4) {
        console.error("❌ One or more Treasury staff roles are missing. Aborting before channel creation.");
        process.exitCode = 1;
        return;
    }

    const publicCat = await ensureCategory(guild, "🏦 THE TREASURY");
    const ticketCat = await ensureCategory(guild, "🔐 TREASURY TICKETS");
    const staffCat = await ensureCategory(guild, "🏦 TREASURY STAFF");

    const treasury = await ensureText(guild, publicCat, "treasury");
    const guide = await ensureText(guild, publicCat, "treasury-guide");
    const donations = await ensureText(guild, publicCat, "treasury-donations");

    const treasuryChat = await ensureText(guild, staffCat, "treasury-chat");
    const treasuryStock = await ensureText(guild, staffCat, "treasury-stock");
    const treasuryLogs = await ensureText(guild, staffCat, "treasury-logs");
    const scamReviews = await ensureText(guild, staffCat, "treasury-scam-reviews");

    const publicReadOnly = { ViewChannel: true, ReadMessageHistory: true, SendMessages: false };
    const viewSend = { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, AttachFiles: true, EmbedLinks: true };
    const hidden = { ViewChannel: false };

    await apply(publicCat, guild, [
        { targets: [everyone], permissions: { ViewChannel: true } },
    ], "🏦 THE TREASURY category");

    await apply(treasury, guild, [
        { targets: [everyone], permissions: publicReadOnly },
        { targets: treasuryStaff, permissions: viewSend },
        { targets: admins, permissions: viewSend },
        { targets: [me], permissions: viewSend },
    ], "#treasury");

    await apply(guide, guild, [
        { targets: [everyone], permissions: publicReadOnly },
        { targets: treasuryStaff, permissions: viewSend },
        { targets: admins, permissions: viewSend },
        { targets: [me], permissions: viewSend },
    ], "#treasury-guide");

    await apply(donations, guild, [
        { targets: [everyone], permissions: hidden },
        { targets: communityPlus, permissions: publicReadOnly },
        { targets: treasuryStaff, permissions: viewSend },
        { targets: admins, permissions: viewSend },
        { targets: [me], permissions: viewSend },
    ], "#treasury-donations");

    await apply(ticketCat, guild, [
        { targets: [everyone], permissions: hidden },
        { targets: treasuryStaff, permissions: viewSend },
        { targets: mods, permissions: viewSend },
        { targets: admins, permissions: viewSend },
        { targets: [me], permissions: { ...viewSend, ManageChannels: true, ManageMessages: true } },
    ], "🔐 TREASURY TICKETS category");

    await apply(staffCat, guild, [
        { targets: [everyone], permissions: hidden },
        { targets: treasuryStaff, permissions: { ViewChannel: true } },
        { targets: mods, permissions: { ViewChannel: true } },
        { targets: admins, permissions: { ViewChannel: true } },
        { targets: [me], permissions: { ViewChannel: true } },
    ], "🏦 TREASURY STAFF category");

    for (const c of [treasuryChat, treasuryStock]) {
        await apply(c, guild, [
            { targets: [everyone], permissions: hidden },
            { targets: treasuryStaff, permissions: viewSend },
            { targets: mods, permissions: viewSend },
            { targets: admins, permissions: viewSend },
            { targets: [me], permissions: viewSend },
        ], `#${c?.name || "missing"}`);
    }

    await apply(treasuryLogs, guild, [
        { targets: [everyone], permissions: hidden },
        { targets: unique([R.coinkeeper, R.vaultkeeper]), permissions: hidden },
        { targets: treasuryLeadership, permissions: publicReadOnly },
        { targets: admins, permissions: publicReadOnly },
        { targets: [me], permissions: viewSend },
    ], "#treasury-logs");

    await apply(scamReviews, guild, [
        { targets: [everyone], permissions: hidden },
        { targets: unique([R.coinkeeper, R.vaultkeeper]), permissions: hidden },
        { targets: treasuryLeadership, permissions: viewSend },
        { targets: mods, permissions: viewSend },
        { targets: admins, permissions: viewSend },
        { targets: [me], permissions: viewSend },
    ], "#treasury-scam-reviews");

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2), "utf8");
    fs.writeFileSync(MARKER, `Treasury channels completed at ${report.finishedAt}\nReport: ${REPORT}\n`, "utf8");

    console.log("=================================================");
    console.log("✅ THE CARRY TAVERN TREASURY CHANNEL SETUP FINISHED");
    console.log(`Created: ${report.created.length}`);
    console.log(`Reused: ${report.reused.length}`);
    console.log(`Permission targets: ${report.changed.length}`);
    console.log(`Skipped: ${report.skipped.length}`);
    console.log(`Errors: ${report.errors.length}`);
    console.log(`Report: ${REPORT}`);
    console.log("=================================================");
    console.log("Set Lunafy Main File back to index.js");
}

client.once("clientReady", async () => {
    try {
        await main();
    } catch (error) {
        console.error("❌ FATAL TREASURY CHANNEL SETUP ERROR:", error);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

console.log("🔐 Logging into Discord for Treasury channel setup...");
client.login(process.env.TOKEN).catch((error) => {
    console.error("❌ Discord login failed:", error);
    process.exit(1);
});