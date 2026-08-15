require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, PermissionFlagsBits } = require("discord.js");

const MARKER = path.join(__dirname, "permission-plan-applied.marker");
const REPORT = path.join(__dirname, "permission-apply-report.json");

if (!process.env.TOKEN || !process.env.GUILD_ID) {
    console.error("❌ TOKEN and GUILD_ID are required in .env");
    process.exit(1);
}

if (fs.existsSync(MARKER)) {
    console.log("🍺 Permission plan already ran. Delete permission-plan-applied.marker only if you intentionally want to rerun it.");
    process.exit(0);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const report = { startedAt: new Date().toISOString(), changes: [], skipped: [], errors: [], backupFile: null };

const norm = (s) => String(s || "").normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
const uniq = (items) => [...new Map(items.filter(Boolean).map((x) => [x.id, x])).values()];

function findUnique(items, wanted, kind) {
    const matches = items.filter((x) => norm(x.name) === norm(wanted));
    if (matches.length === 1) return matches[0];
    const msg = matches.length ? `${kind} ${wanted} is ambiguous` : `${kind} ${wanted} not found`;
    report.skipped.push(msg);
    console.warn(`⚠️ ${msg}`);
    return null;
}

function state(overwrite, bit) {
    if (!overwrite) return "inherit";
    if (overwrite.allow.has(bit)) return "allow";
    if (overwrite.deny.has(bit)) return "deny";
    return "inherit";
}

function desired(v) {
    if (v === true) return "allow";
    if (v === false) return "deny";
    return "inherit";
}

function who(target, guild) {
    return target.id === guild.roles.everyone.id ? "@everyone" : target.name;
}

async function setPerms(channel, target, perms, guild, note = "") {
    if (!channel || !target) return;
    const current = channel.permissionOverwrites.cache.get(target.id);
    const changes = [];

    for (const [name, value] of Object.entries(perms)) {
        if (value === undefined) continue;
        const bit = PermissionFlagsBits[name];
        if (bit === undefined) throw new Error(`Unknown permission ${name}`);
        const before = state(current, bit);
        const after = desired(value);
        if (before !== after) changes.push({ permission: name, before, after });
    }

    if (!changes.length) return;

    try {
        await channel.permissionOverwrites.edit(target, perms, { reason: "The Carry Tavern permission plan" });
        for (const c of changes) {
            report.changes.push({ channel: channel.name, target: who(target, guild), note, ...c });
            console.log(`✅ ${channel.name} -> ${who(target, guild)} -> ${c.permission}: ${c.before} -> ${c.after}`);
        }
    } catch (error) {
        const msg = `${channel.name} -> ${who(target, guild)}: ${error.message}`;
        report.errors.push(msg);
        console.error(`❌ ${msg}`);
    }
}

async function many(channel, roles, perms, guild, note = "") {
    for (const role of uniq(roles)) await setPerms(channel, role, perms, guild, note);
}

const readOnly = (ch, roles, guild, note = "") => many(ch, roles, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, note);
const readSend = (ch, roles, guild, note = "", extra = {}) => many(ch, roles, { ViewChannel: true, ReadMessageHistory: true, SendMessages: true, ...extra }, guild, note);
const hide = (ch, roles, guild, note = "") => many(ch, roles, { ViewChannel: false }, guild, note);

function backup(guild) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = path.join(__dirname, `permission-backup-${stamp}.json`);
    const payload = {
        createdAt: new Date().toISOString(),
        guildId: guild.id,
        guildName: guild.name,
        channels: [...guild.channels.cache.values()].map((ch) => ({
            id: ch.id,
            name: ch.name,
            parentId: ch.parentId,
            type: ch.type,
            overwrites: [...ch.permissionOverwrites.cache.values()].map((o) => ({
                id: o.id,
                type: o.type,
                allow: o.allow.toArray(),
                deny: o.deny.toArray(),
            })),
        })),
    };
    fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    report.backupFile = file;
    console.log(`💾 Backup written: ${file}`);
}

async function main() {
    const guild = await client.guilds.fetch(process.env.GUILD_ID);
    await guild.roles.fetch();
    await guild.channels.fetch();

    const roles = [...guild.roles.cache.values()];
    const channels = [...guild.channels.cache.values()];
    const roleNames = [
        "Tavern Proprietor", "Tavernmaster", "High Innkeeper", "Innkeeper",
        "Tavern Warden", "Bouncer", "Doorhand", "Master of the Tap",
        "Brewmaster", "Tapmaster", "Caskkeeper", "Bartender", "Barback",
        "Tavern Legend", "Veteran Regular", "Regular", "Patron", "Traveller",
    ];

    const R = Object.fromEntries(roleNames.map((name) => [name, findUnique(roles, name, "Role")]));
    if (Object.values(R).some((r) => !r)) {
        console.error("❌ Aborting before any changes because a required Tavern role is missing/ambiguous.");
        fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
        process.exitCode = 1;
        return;
    }

    const community = uniq([R.Traveller, R.Patron, R.Regular, R["Veteran Regular"], R["Tavern Legend"]]);
    const patronPlus = uniq([R.Patron, R.Regular, R["Veteran Regular"], R["Tavern Legend"]]);
    const carriers = uniq([R.Barback, R.Bartender, R.Caskkeeper, R.Tapmaster, R.Brewmaster, R["Master of the Tap"]]);
    const carrierLeadership = uniq([R.Brewmaster, R["Master of the Tap"]]);
    const mods = uniq([R.Doorhand, R.Bouncer, R["Tavern Warden"]]);
    const admins = uniq([R.Innkeeper, R["High Innkeeper"], R.Tavernmaster, R["Tavern Proprietor"]]);
    const staff = uniq([...mods, ...admins]);
    const communityPlus = uniq([...community, ...carriers, ...staff]);
    const allNamed = uniq([...community, ...carriers, ...staff]);
    const everyone = guild.roles.everyone;
    const ch = (name) => findUnique(channels, name, "Channel");

    backup(guild);

    for (const name of ["rules", "server-guide", "faq"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public read-only");
        await readOnly(c, allNamed, guild, "public read-only");
    }
    {
        const c = ch("announcements");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public announcements");
            await readOnly(c, uniq([...community, ...carriers, ...mods]), guild, "read-only");
            await readSend(c, admins, guild, "admins may post");
        }
    }

    {
        const c = ch("roles");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public role menu");
            await readOnly(c, allNamed, guild, "public role menu");
        }
    }
    {
        const c = ch("role-request");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "members only");
            await readSend(c, communityPlus, guild, "community+");
        }
    }
    {
        const c = ch("carrier-roles");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "carrier/staff only");
            await hide(c, community, guild, "hide community");
            await readOnly(c, carriers, guild, "carriers view");
            await readSend(c, uniq([...carrierLeadership, ...staff]), guild, "leadership/staff may post");
        }
    }

    for (const name of ["giveaways", "events"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public event read-only");
        await readOnly(c, allNamed, guild, "public event read-only");
    }
    {
        const c = ch("tournaments");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true }, guild, "preserve send state");
            await many(c, allNamed, { ViewChannel: true, ReadMessageHistory: true }, guild, "preserve send state");
        }
    }

    for (const name of ["tavern-chat", "suggestions", "bot-commands"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: false }, guild, "community+");
        await readSend(c, communityPlus, guild, "community+");
    }
    for (const name of ["media", "item-drops"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: false }, guild, "community+");
        await readSend(c, communityPlus, guild, "community+ media", { AttachFiles: true, EmbedLinks: true });
    }

    {
        const c = ch("tavern-trades");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "trading access");
            await setPerms(c, R.Traveller, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "traveller view-only");
            await readSend(c, uniq([...patronPlus, ...carriers, ...staff]), guild, "patron+ may trade");
        }
    }
    {
        const c = ch("trade-offers");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "trading access");
            await setPerms(c, R.Traveller, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "traveller view-only");
            await readSend(c, uniq([...patronPlus, ...carriers, ...staff]), guild, "patron+ offers", { AttachFiles: true, EmbedLinks: true });
        }
    }
    {
        const c = ch("trade-vouches");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public vouches");
            await setPerms(c, R.Traveller, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "traveller read-only");
            await readSend(c, uniq([...patronPlus, ...carriers, ...staff]), guild, "patron+ may vouch");
        }
    }
    {
        const c = ch("safe-trading");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public read-only");
            await readOnly(c, allNamed, guild, "public read-only");
        }
    }

    for (const name of ["request-carry", "carry-queue"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: false }, guild, "community carry access");
        await readOnly(c, communityPlus, guild, "view/use bot interactions; no normal sending");
    }
    {
        const c = ch("tavern-records");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public records");
            await readOnly(c, allNamed, guild, "public records");
        }
    }
    {
        const c = ch("carry-proof");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public proof");
            await readOnly(c, community, guild, "community read-only");
            await readSend(c, uniq([...carriers, ...staff]), guild, "carriers/staff may post", { AttachFiles: true, EmbedLinks: true });
        }
    }
    {
        const c = ch("carry-events");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public carry events");
            await readOnly(c, uniq([...community, ...carriers, ...mods]), guild, "read-only");
            await readSend(c, uniq([...carrierLeadership, ...admins]), guild, "leadership/admins may post");
        }
    }

    {
        const c = ch("become-a-carrier");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "community application access");
            await many(c, communityPlus, { ViewChannel: true, ReadMessageHistory: true }, guild, "preserve existing application send behavior");
        }
    }
    {
        const c = ch("carrier-chat");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "carrier/staff private");
            await hide(c, community, guild, "hide community");
            await readSend(c, uniq([...carriers, ...staff]), guild, "carriers/staff");
        }
    }
    {
        const c = ch("carrier-news");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "carrier/staff private");
            await hide(c, community, guild, "hide community");
            await readOnly(c, uniq([...carriers, ...mods]), guild, "carrier/staff read-only");
            await readSend(c, uniq([...carrierLeadership, ...admins]), guild, "leadership/admins may post");
        }
    }
    for (const name of ["carrier-guide", "carrier-leaderboard"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: false }, guild, "carrier/staff private");
        await hide(c, community, guild, "hide community");
        await readOnly(c, uniq([...carriers, ...staff]), guild, "carrier/staff read-only");
    }

    {
        const c = ch("tickets");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: true, ReadMessageHistory: true, SendMessages: false }, guild, "public ticket panel");
            await readOnly(c, allNamed, guild, "ticket panel");
        }
    }
    for (const c of channels.filter((x) => /^ticket-\d+/i.test(x.name))) {
        console.log(`🎟️ Securing private ticket: ${c.name}`);
        await setPerms(c, everyone, { ViewChannel: false }, guild, "keep ticket private");
        await hide(c, uniq([...community, ...carriers]), guild, "non-staff hidden");
        await readSend(c, staff, guild, "mods/admins");
    }

    {
        const c = ch("staff-chat");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "staff only");
            await hide(c, uniq([...community, ...carriers]), guild, "non-staff hidden");
            await readSend(c, staff, guild, "Doorhand+");
        }
    }
    {
        const c = ch("staff-logs");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "staff logs");
            await hide(c, uniq([...community, ...carriers]), guild, "non-staff hidden");
            await many(c, staff, { ViewChannel: true, ReadMessageHistory: true }, guild, "preserve log posting restrictions");
        }
    }
    for (const name of ["reports", "staff-commands"]) {
        const c = ch(name); if (!c) continue;
        await setPerms(c, everyone, { ViewChannel: false }, guild, "staff only");
        await hide(c, uniq([...community, ...carriers]), guild, "non-staff hidden");
        await readSend(c, staff, guild, "Doorhand+");
    }

    {
        const c = ch("transcripts");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "restricted transcripts");
            await hide(c, uniq([...community, ...carriers.filter((r) => r.id !== R["Master of the Tap"].id)]), guild, "Master of the Tap + staff only");
            await readOnly(c, uniq([R["Master of the Tap"], ...staff]), guild, "Master of the Tap + Mods/Admins");
        }
    }
    for (const c of channels.filter((x) => /^tavern-request-/i.test(x.name))) {
        console.log(`🍺 Securing carrier request: ${c.name}`);
        await setPerms(c, everyone, { ViewChannel: false }, guild, "keep request private");
        await hide(c, uniq([...community, ...carriers.filter((r) => r.id !== R["Master of the Tap"].id)]), guild, "others hidden");
        await readSend(c, uniq([R["Master of the Tap"], ...staff]), guild, "Master of the Tap + Mods/Admins");
    }
    {
        const c = ch("ai-logs");
        if (c) {
            await setPerms(c, everyone, { ViewChannel: false }, guild, "admin-only AI logs");
            await hide(c, uniq([...community, ...carriers, ...mods]), guild, "non-admin hidden");
            await readOnly(c, admins, guild, "admins only");
        }
    }

    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    fs.writeFileSync(MARKER, [
        "The Carry Tavern permission plan applied.",
        `Guild: ${guild.name} (${guild.id})`,
        `Finished: ${report.finishedAt}`,
        `Changes: ${report.changes.length}`,
        `Skipped: ${report.skipped.length}`,
        `Errors: ${report.errors.length}`,
        `Report: ${REPORT}`,
        `Backup: ${report.backupFile}`,
    ].join("\n"));

    console.log("=================================================");
    console.log("✅ THE CARRY TAVERN PERMISSION PASS FINISHED");
    console.log(`Changes: ${report.changes.length}`);
    console.log(`Skipped: ${report.skipped.length}`);
    console.log(`Errors: ${report.errors.length}`);
    console.log(`Report: ${REPORT}`);
    console.log(`Backup: ${report.backupFile}`);
    console.log("=================================================");
    console.log("Now set Lunafy Main File back to index.js");
}

client.once("clientReady", async () => {
    try {
        await main();
    } catch (error) {
        console.error("❌ FATAL PERMISSION SCRIPT ERROR:", error);
        report.errors.push(`FATAL: ${error.stack || error.message}`);
        report.finishedAt = new Date().toISOString();
        try { fs.writeFileSync(REPORT, JSON.stringify(report, null, 2)); } catch {}
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

console.log("🔐 Logging into Discord for one-shot permission setup...");
client.login(process.env.TOKEN).catch((error) => {
    console.error("❌ Discord login failed:", error);
    process.exit(1);
});