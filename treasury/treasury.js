require("dotenv").config();

const db = require("../database/database");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_settings(
    guild TEXT PRIMARY KEY,
    panelChannel TEXT NOT NULL,
    categoryChannel TEXT NOT NULL,
    staffRole TEXT NOT NULL,
    logChannel TEXT NOT NULL
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_users(
    guild TEXT NOT NULL,
    user TEXT NOT NULL,
    trust INTEGER NOT NULL DEFAULT 100,
    banned INTEGER NOT NULL DEFAULT 0,
    donations INTEGER NOT NULL DEFAULT 0,
    lateReturns INTEGER NOT NULL DEFAULT 0,
    scams INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(guild, user)
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_loans(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild TEXT NOT NULL,
    user TEXT NOT NULL,
    roblox TEXT NOT NULL,
    item TEXT NOT NULL,
    itemType TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'requested',
    ticketChannel TEXT,
    createdAt INTEGER NOT NULL,
    approvedAt INTEGER,
    approvedBy TEXT,
    dueAt INTEGER,
    returnContactAt INTEGER,
    returnedAt INTEGER,
    returnedBy TEXT,
    rejectedBy TEXT
)
`).run();

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_donations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild TEXT NOT NULL,
    user TEXT NOT NULL,
    roblox TEXT NOT NULL,
    item TEXT NOT NULL,
    itemType TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    ticketChannel TEXT,
    createdAt INTEGER NOT NULL,
    handledAt INTEGER,
    handledBy TEXT
)
`).run();

const START_TRUST = readInt("TREASURY_START_TRUST", 100, 0, 100);
const HIGH_TIER_MIN_TRUST = readInt("TREASURY_HIGH_TIER_MIN_TRUST", 75, 0, 100);
const LATE_PENALTY = readInt("TREASURY_LATE_PENALTY", 25, 0, 100);
const DONATION_REWARD = readInt("TREASURY_DONATION_REWARD", 10, 0, 100);
const LOAN_HOURS = readInt("TREASURY_LOAN_HOURS", 24, 1, 168);
const GRACE_HOURS = readInt("TREASURY_GRACE_HOURS", 6, 0, 48);
const SCAM_AFTER_HOURS = readInt("TREASURY_SCAM_AFTER_HOURS", 48, 1, 336);

function readInt(name, fallback, min, max) {
    const parsed = Number.parseInt(process.env[name] || "", 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function unix(ms) {
    return Math.floor(ms / 1000);
}

function discordTime(ms, style = "F") {
    return `<t:${unix(ms)}:${style}>`;
}

function cleanChannelPart(value) {
    return String(value || "member")
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "member";
}

function isHighTier(itemType) {
    const value = String(itemType || "").toLowerCase();
    return (
        value.includes("leg") ||
        value.includes("legend") ||
        value.includes("t3") ||
        value.includes("tier 3") ||
        value.includes("tier3")
    );
}

function ensureUser(guildId, userId) {
    db.prepare(`
        INSERT OR IGNORE INTO treasury_users(guild, user, trust)
        VALUES(?, ?, ?)
    `).run(guildId, userId, START_TRUST);

    return db.prepare(`
        SELECT * FROM treasury_users WHERE guild = ? AND user = ?
    `).get(guildId, userId);
}

function getSettings(guildId) {
    return db.prepare(`
        SELECT * FROM treasury_settings WHERE guild = ?
    `).get(guildId);
}

function saveSettings(guildId, panelChannel, categoryChannel, staffRole, logChannel) {
    db.prepare(`
        INSERT INTO treasury_settings(
            guild, panelChannel, categoryChannel, staffRole, logChannel
        )
        VALUES(?, ?, ?, ?, ?)
        ON CONFLICT(guild) DO UPDATE SET
            panelChannel = excluded.panelChannel,
            categoryChannel = excluded.categoryChannel,
            staffRole = excluded.staffRole,
            logChannel = excluded.logChannel
    `).run(guildId, panelChannel, categoryChannel, staffRole, logChannel);
}

function memberIsTreasuryStaff(interaction, settings) {
    if (!interaction.member) return false;

    return (
        interaction.member.permissions.has(PermissionFlagsBits.ManageGuild) ||
        interaction.member.roles.cache.has(settings.staffRole)
    );
}

async function safeLog(guild, settings, payload) {
    try {
        const channel = guild.channels.cache.get(settings.logChannel);
        if (channel?.isTextBased()) {
            await channel.send(payload);
        }
    } catch (error) {
        console.warn("[TREASURY] Could not send log:", error.message);
    }
}

function treasuryPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("🏦 Welcome To The Treasury")
        .setDescription([
            "Need an item to help you level up? Open a Treasury ticket to request **any Legendary, T3, or other available item**. Staff will confirm whether the item is currently available.",
            "",
            "### 📜 Borrowing Terms",
            `• **Loan period:** You have **${LOAN_HOURS} hours** from the moment staff approves and hands over the item.`,
            `• **Grace period:** We respect time-zone differences. If you **reach out to return the item within ${GRACE_HOURS} hours after the deadline**, you will not receive a late-return penalty.`,
            `• **Late returns:** If the item is returned after the deadline without valid grace contact, your **Trust Score decreases by ${LATE_PENALTY} points**.`,
            `• **High-tier restriction:** A Trust Score below **${HIGH_TIER_MIN_TRUST}** blocks you from borrowing **Legendary/T3** items until your score is restored.`,
            `• **Scamming:** If the item is still not returned **${SCAM_AFTER_HOURS} hours after the deadline**, the loan is marked as **scamming** and staff are instructed to apply the game ban.`,
            `• **Restoring Trust:** Donate old **Legendary/T3** items to The Treasury. Each accepted high-tier donation restores **${DONATION_REWARD} Trust** (up to 100).`,
            "",
            "### ⚠️ Important",
            "**By opening a ticket you accept these terms.**",
            "**Please keep the ticket open until the borrowed item has been returned and confirmed by staff.**",
        ].join("\n"))
        .setFooter({ text: "The Carry Tavern • Treasury" })
        .setTimestamp();
}

function treasuryPanelComponents() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("treasury_borrow")
                .setLabel("Borrow Item")
                .setEmoji("💰")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId("treasury_donate")
                .setLabel("Donate Leg/T3")
                .setEmoji("🎁")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId("treasury_trust")
                .setLabel("My Trust Score")
                .setEmoji("⭐")
                .setStyle(ButtonStyle.Secondary)
        ),
    ];
}

function borrowModal() {
    const modal = new ModalBuilder()
        .setCustomId("treasury_borrow_modal")
        .setTitle("Borrow From The Treasury");

    const roblox = new TextInputBuilder()
        .setCustomId("roblox")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    const item = new TextInputBuilder()
        .setCustomId("item")
        .setLabel("Item You Want To Borrow")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const type = new TextInputBuilder()
        .setCustomId("item_type")
        .setLabel("Type: Legendary / T3 / Other")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("What Are You Using It For?")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(300);

    modal.addComponents(
        new ActionRowBuilder().addComponents(roblox),
        new ActionRowBuilder().addComponents(item),
        new ActionRowBuilder().addComponents(type),
        new ActionRowBuilder().addComponents(reason)
    );

    return modal;
}

function donationModal() {
    const modal = new ModalBuilder()
        .setCustomId("treasury_donation_modal")
        .setTitle("Donate To The Treasury");

    const roblox = new TextInputBuilder()
        .setCustomId("roblox")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    const item = new TextInputBuilder()
        .setCustomId("item")
        .setLabel("Item You Are Donating")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(100);

    const type = new TextInputBuilder()
        .setCustomId("item_type")
        .setLabel("Type: Legendary / T3")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(30);

    modal.addComponents(
        new ActionRowBuilder().addComponents(roblox),
        new ActionRowBuilder().addComponents(item),
        new ActionRowBuilder().addComponents(type)
    );

    return modal;
}

function staffLoanButtons(id, approved = false) {
    if (!approved) {
        return [
            new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`treasury_approve_${id}`)
                    .setLabel("Approve Loan")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`treasury_reject_${id}`)
                    .setLabel("Reject")
                    .setStyle(ButtonStyle.Danger)
            ),
        ];
    }

    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`treasury_return_contact_${id}`)
                .setLabel("I Am Ready To Return")
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId(`treasury_returned_${id}`)
                .setLabel("Staff: Mark Returned")
                .setStyle(ButtonStyle.Success)
        ),
    ];
}

function donationButtons(id) {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`treasury_accept_donation_${id}`)
                .setLabel("Accept Donation")
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId(`treasury_reject_donation_${id}`)
                .setLabel("Reject Donation")
                .setStyle(ButtonStyle.Danger)
        ),
    ];
}

async function createTreasuryTicket(guild, settings, user, prefix, id) {
    const category = guild.channels.cache.get(settings.categoryChannel);
    if (!category || category.type !== ChannelType.GuildCategory) {
        throw new Error("Treasury category is missing or is not a category.");
    }

    const staffRole = guild.roles.cache.get(settings.staffRole);
    if (!staffRole) {
        throw new Error("Treasury staff role is missing.");
    }

    const me = guild.members.me || await guild.members.fetchMe();

    return guild.channels.create({
        name: `${prefix}-${cleanChannelPart(user.username)}-${id}`,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
            {
                id: guild.roles.everyone.id,
                deny: [PermissionFlagsBits.ViewChannel],
            },
            {
                id: user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            {
                id: staffRole.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.AttachFiles,
                    PermissionFlagsBits.EmbedLinks,
                ],
            },
            {
                id: me.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.ReadMessageHistory,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ManageChannels,
                    PermissionFlagsBits.ManageMessages,
                ],
            },
        ],
        reason: `The Carry Tavern Treasury ${prefix} ticket`,
    });
}

async function submitBorrow(interaction) {
    const settings = getSettings(interaction.guildId);

    if (!settings) {
        return interaction.reply({
            content: "❌ The Treasury has not been configured yet.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const profile = ensureUser(interaction.guildId, interaction.user.id);

    if (profile.banned) {
        return interaction.reply({
            content: "❌ You are currently blocked from borrowing from The Treasury. Please contact staff.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const active = db.prepare(`
        SELECT id FROM treasury_loans
        WHERE guild = ? AND user = ?
        AND status IN ('requested', 'approved', 'overdue')
        LIMIT 1
    `).get(interaction.guildId, interaction.user.id);

    if (active) {
        return interaction.reply({
            content: `❌ You already have an open Treasury loan/request (#${active.id}). Finish that ticket first.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    const roblox = interaction.fields.getTextInputValue("roblox").trim();
    const item = interaction.fields.getTextInputValue("item").trim();
    const itemType = interaction.fields.getTextInputValue("item_type").trim();
    const reason = interaction.fields.getTextInputValue("reason").trim();

    if (isHighTier(itemType) && profile.trust < HIGH_TIER_MIN_TRUST) {
        return interaction.reply({
            content: `❌ Your Trust Score is **${profile.trust}/100**. You need at least **${HIGH_TIER_MIN_TRUST}** to borrow Legendary/T3 items. Donate old Legs/T3 to rebuild trust.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.reply({
        content: "⏳ Creating your private Treasury ticket...",
        flags: MessageFlags.Ephemeral,
    });

    const createdAt = Date.now();
    const result = db.prepare(`
        INSERT INTO treasury_loans(
            guild, user, roblox, item, itemType, status, createdAt
        )
        VALUES(?, ?, ?, ?, ?, 'requested', ?)
    `).run(
        interaction.guildId,
        interaction.user.id,
        roblox,
        item,
        itemType,
        createdAt
    );

    const id = Number(result.lastInsertRowid);

    try {
        const ticket = await createTreasuryTicket(
            interaction.guild,
            settings,
            interaction.user,
            "treasury",
            id
        );

        db.prepare(`
            UPDATE treasury_loans SET ticketChannel = ? WHERE id = ?
        `).run(ticket.id, id);

        const embed = new EmbedBuilder()
            .setTitle(`🏦 Treasury Borrow Request #${id}`)
            .setDescription([
                `${interaction.user} has opened a Treasury borrowing ticket.`,
                "",
                `🎮 **Roblox:** ${roblox}`,
                `💎 **Requested Item:** ${item}`,
                `🏷️ **Type:** ${itemType}`,
                `⭐ **Trust Score:** ${profile.trust}/100`,
                reason ? `📝 **Use:** ${reason}` : null,
                "",
                "**By opening this ticket, the borrower accepts the Treasury terms.**",
                "Keep this ticket open until the item is returned and confirmed.",
            ].filter(Boolean).join("\n"))
            .setTimestamp();

        await ticket.send({
            content: `<@&${settings.staffRole}> ${interaction.user}`,
            embeds: [embed, treasuryPanelEmbed()],
            components: staffLoanButtons(id, false),
        });

        await safeLog(interaction.guild, settings, {
            embeds: [
                new EmbedBuilder()
                    .setTitle("🏦 Treasury Borrow Request")
                    .setDescription(`${interaction.user} requested **${item}** (${itemType}) in ${ticket}.`)
                    .setTimestamp(),
            ],
        });

        return interaction.editReply({
            content: `✅ Treasury ticket created: ${ticket}`,
        });
    } catch (error) {
        db.prepare(`DELETE FROM treasury_loans WHERE id = ?`).run(id);
        console.error("[TREASURY] Ticket creation failed:", error);

        return interaction.editReply({
            content: `❌ I could not create your Treasury ticket: ${error.message}`,
        });
    }
}

async function submitDonation(interaction) {
    const settings = getSettings(interaction.guildId);

    if (!settings) {
        return interaction.reply({
            content: "❌ The Treasury has not been configured yet.",
            flags: MessageFlags.Ephemeral,
        });
    }

    ensureUser(interaction.guildId, interaction.user.id);

    const roblox = interaction.fields.getTextInputValue("roblox").trim();
    const item = interaction.fields.getTextInputValue("item").trim();
    const itemType = interaction.fields.getTextInputValue("item_type").trim();

    await interaction.reply({
        content: "⏳ Creating your private donation ticket...",
        flags: MessageFlags.Ephemeral,
    });

    const result = db.prepare(`
        INSERT INTO treasury_donations(
            guild, user, roblox, item, itemType, status, createdAt
        )
        VALUES(?, ?, ?, ?, ?, 'pending', ?)
    `).run(
        interaction.guildId,
        interaction.user.id,
        roblox,
        item,
        itemType,
        Date.now()
    );

    const id = Number(result.lastInsertRowid);

    try {
        const ticket = await createTreasuryTicket(
            interaction.guild,
            settings,
            interaction.user,
            "treasury-donation",
            id
        );

        db.prepare(`
            UPDATE treasury_donations SET ticketChannel = ? WHERE id = ?
        `).run(ticket.id, id);

        await ticket.send({
            content: `<@&${settings.staffRole}> ${interaction.user}`,
            embeds: [
                new EmbedBuilder()
                    .setTitle(`🎁 Treasury Donation #${id}`)
                    .setDescription([
                        `🎮 **Roblox:** ${roblox}`,
                        `💎 **Donation:** ${item}`,
                        `🏷️ **Type:** ${itemType}`,
                        "",
                        isHighTier(itemType)
                            ? `If accepted, this restores **${DONATION_REWARD} Trust** (up to 100).`
                            : "Only accepted Legendary/T3 donations restore Trust.",
                    ].join("\n"))
                    .setTimestamp(),
            ],
            components: donationButtons(id),
        });

        return interaction.editReply({
            content: `✅ Donation ticket created: ${ticket}`,
        });
    } catch (error) {
        db.prepare(`DELETE FROM treasury_donations WHERE id = ?`).run(id);
        return interaction.editReply({
            content: `❌ I could not create the donation ticket: ${error.message}`,
        });
    }
}

async function approveLoan(interaction, id) {
    const settings = getSettings(interaction.guildId);

    if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
        return interaction.reply({
            content: "❌ Treasury staff only.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const loan = db.prepare(`SELECT * FROM treasury_loans WHERE id = ? AND guild = ?`).get(id, interaction.guildId);

    if (!loan || loan.status !== "requested") {
        return interaction.reply({
            content: "❌ This loan is no longer waiting for approval.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const profile = ensureUser(interaction.guildId, loan.user);

    if (profile.banned || (isHighTier(loan.itemType) && profile.trust < HIGH_TIER_MIN_TRUST)) {
        return interaction.reply({
            content: "❌ This member is not currently eligible for this loan.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const approvedAt = Date.now();
    const dueAt = approvedAt + LOAN_HOURS * 60 * 60 * 1000;

    db.prepare(`
        UPDATE treasury_loans
        SET status = 'approved', approvedAt = ?, approvedBy = ?, dueAt = ?
        WHERE id = ? AND status = 'requested'
    `).run(approvedAt, interaction.user.id, dueAt, id);

    const graceEnd = dueAt + GRACE_HOURS * 60 * 60 * 1000;
    const scamAt = dueAt + SCAM_AFTER_HOURS * 60 * 60 * 1000;

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle(`✅ Treasury Loan #${id} Approved`)
                .setDescription([
                    `<@${loan.user}> may now receive **${loan.item}**.`,
                    "",
                    `⏳ **24-hour deadline:** ${discordTime(dueAt)} (${discordTime(dueAt, "R")})`,
                    `🌍 **Grace contact ends:** ${discordTime(graceEnd)} (${discordTime(graceEnd, "R")})`,
                    `🚨 **Scam threshold:** ${discordTime(scamAt)} (${discordTime(scamAt, "R")})`,
                    "",
                    `If you are ready to return the item, press **I Am Ready To Return** so staff have a timestamped record.`,
                    "**Keep this ticket open until staff confirms the item is back.**",
                ].join("\n"))
                .setTimestamp(),
        ],
        components: staffLoanButtons(id, true),
    });

    await safeLog(interaction.guild, settings, {
        embeds: [
            new EmbedBuilder()
                .setTitle("✅ Treasury Loan Approved")
                .setDescription(`Loan #${id}: <@${loan.user}> borrowed **${loan.item}**. Due ${discordTime(dueAt)}.`)
                .setTimestamp(),
        ],
    });
}

async function rejectLoan(interaction, id) {
    const settings = getSettings(interaction.guildId);

    if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
        return interaction.reply({
            content: "❌ Treasury staff only.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const result = db.prepare(`
        UPDATE treasury_loans
        SET status = 'rejected', rejectedBy = ?
        WHERE id = ? AND guild = ? AND status = 'requested'
    `).run(interaction.user.id, id, interaction.guildId);

    if (result.changes !== 1) {
        return interaction.reply({
            content: "❌ This request is no longer pending.",
            flags: MessageFlags.Ephemeral,
        });
    }

    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle(`❌ Treasury Loan #${id} Rejected`)
                .setDescription(`Rejected by ${interaction.user}. No item was loaned.`)
                .setTimestamp(),
        ],
        components: [],
    });
}

async function contactReturn(interaction, id) {
    const loan = db.prepare(`
        SELECT * FROM treasury_loans WHERE id = ? AND guild = ?
    `).get(id, interaction.guildId);

    if (!loan || !["approved", "overdue"].includes(loan.status)) {
        return interaction.reply({
            content: "❌ This loan is not currently active.",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (loan.user !== interaction.user.id) {
        return interaction.reply({
            content: "❌ Only the borrower can use this button.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const now = Date.now();

    if (!loan.returnContactAt) {
        db.prepare(`
            UPDATE treasury_loans SET returnContactAt = ? WHERE id = ?
        `).run(now, id);
    }

    const settings = getSettings(interaction.guildId);
    const graceEnd = loan.dueAt + GRACE_HOURS * 60 * 60 * 1000;
    const protectedByGrace = now > loan.dueAt && now <= graceEnd;

    await interaction.reply({
        content: protectedByGrace
            ? `✅ Return contact recorded **inside the ${GRACE_HOURS}-hour grace period**. You will not receive a late-return Trust penalty as long as the item is now returned to staff. <@&${settings.staffRole}>`
            : now <= loan.dueAt
                ? `✅ Staff have been notified that you are ready to return the item. <@&${settings.staffRole}>`
                : `⚠️ Return contact recorded, but the ${GRACE_HOURS}-hour grace period has already ended. Staff have been notified. <@&${settings.staffRole}>`,
        allowedMentions: { roles: [settings.staffRole] },
    });
}

async function markReturned(interaction, id) {
    const settings = getSettings(interaction.guildId);

    if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
        return interaction.reply({
            content: "❌ Treasury staff only.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const loan = db.prepare(`
        SELECT * FROM treasury_loans WHERE id = ? AND guild = ?
    `).get(id, interaction.guildId);

    if (!loan || !["approved", "overdue", "scam"].includes(loan.status)) {
        return interaction.reply({
            content: "❌ This loan cannot be marked returned.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const now = Date.now();
    const graceEnd = loan.dueAt + GRACE_HOURS * 60 * 60 * 1000;
    const scamAt = loan.dueAt + SCAM_AFTER_HOURS * 60 * 60 * 1000;

    const validGraceContact = (
        loan.returnContactAt &&
        loan.returnContactAt > loan.dueAt &&
        loan.returnContactAt <= graceEnd
    );

    let penalty = 0;
    let status = "returned";
    let resultText = "✅ Returned on time. No Trust penalty.";

    if (loan.status === "scam" || now > scamAt) {
        status = "returned_after_scam";
        resultText = "🚨 Item returned after the scam threshold. The scam flag/game-ban review remains for staff.";
    } else if (now > loan.dueAt && !validGraceContact) {
        penalty = LATE_PENALTY;
        resultText = `⚠️ Late return without valid grace contact. Trust reduced by ${LATE_PENALTY}.`;
    } else if (validGraceContact) {
        resultText = "✅ Returned with valid grace-period contact. No Trust penalty.";
    }

    const transaction = db.transaction(() => {
        db.prepare(`
            UPDATE treasury_loans
            SET status = ?, returnedAt = ?, returnedBy = ?
            WHERE id = ?
        `).run(status, now, interaction.user.id, id);

        if (penalty > 0) {
            db.prepare(`
                UPDATE treasury_users
                SET trust = MAX(0, trust - ?),
                    lateReturns = lateReturns + 1
                WHERE guild = ? AND user = ?
            `).run(penalty, interaction.guildId, loan.user);
        }
    });

    transaction();

    const profile = ensureUser(interaction.guildId, loan.user);

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle(`📦 Treasury Loan #${id} Returned`)
                .setDescription([
                    `<@${loan.user}> returned **${loan.item}**.`,
                    resultText,
                    "",
                    `⭐ **Current Trust:** ${profile.trust}/100`,
                    profile.trust < HIGH_TIER_MIN_TRUST
                        ? `🔒 Legendary/T3 borrowing is restricted until Trust reaches ${HIGH_TIER_MIN_TRUST}.`
                        : "🔓 Legendary/T3 borrowing remains available.",
                    "",
                    "The loan is now complete. This ticket may be closed by staff.",
                ].join("\n"))
                .setTimestamp(),
        ],
        components: [],
    });

    await safeLog(interaction.guild, settings, {
        embeds: [
            new EmbedBuilder()
                .setTitle("📦 Treasury Item Returned")
                .setDescription(`Loan #${id}: <@${loan.user}> returned **${loan.item}**.\n${resultText}\nTrust: **${profile.trust}/100**`)
                .setTimestamp(),
        ],
    });
}

async function acceptDonation(interaction, id) {
    const settings = getSettings(interaction.guildId);

    if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
        return interaction.reply({
            content: "❌ Treasury staff only.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const donation = db.prepare(`
        SELECT * FROM treasury_donations WHERE id = ? AND guild = ?
    `).get(id, interaction.guildId);

    if (!donation || donation.status !== "pending") {
        return interaction.reply({
            content: "❌ This donation is no longer pending.",
            flags: MessageFlags.Ephemeral,
        });
    }

    ensureUser(interaction.guildId, donation.user);

    const reward = isHighTier(donation.itemType) ? DONATION_REWARD : 0;
    const now = Date.now();

    const transaction = db.transaction(() => {
        db.prepare(`
            UPDATE treasury_donations
            SET status = 'accepted', handledAt = ?, handledBy = ?
            WHERE id = ?
        `).run(now, interaction.user.id, id);

        db.prepare(`
            UPDATE treasury_users
            SET donations = donations + 1,
                trust = MIN(100, trust + ?)
            WHERE guild = ? AND user = ?
        `).run(reward, interaction.guildId, donation.user);
    });

    transaction();

    const profile = ensureUser(interaction.guildId, donation.user);

    await interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle(`🎁 Treasury Donation #${id} Accepted`)
                .setDescription([
                    `<@${donation.user}> donated **${donation.item}** (${donation.itemType}).`,
                    reward > 0
                        ? `⭐ Trust restored by **${reward}**.`
                        : "This item type does not award Trust.",
                    `**Current Trust:** ${profile.trust}/100`,
                    profile.banned
                        ? "🚨 This account still has a scam block. Donation Trust does not automatically clear a scam/game-ban flag."
                        : null,
                ].filter(Boolean).join("\n"))
                .setTimestamp(),
        ],
        components: [],
    });

    await safeLog(interaction.guild, settings, {
        content: `🎁 Donation #${id} accepted from <@${donation.user}>: **${donation.item}**. Trust is now **${profile.trust}/100**.`,
    });
}

async function rejectDonation(interaction, id) {
    const settings = getSettings(interaction.guildId);

    if (!settings || !memberIsTreasuryStaff(interaction, settings)) {
        return interaction.reply({
            content: "❌ Treasury staff only.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const result = db.prepare(`
        UPDATE treasury_donations
        SET status = 'rejected', handledAt = ?, handledBy = ?
        WHERE id = ? AND guild = ? AND status = 'pending'
    `).run(Date.now(), interaction.user.id, id, interaction.guildId);

    if (result.changes !== 1) {
        return interaction.reply({
            content: "❌ This donation is no longer pending.",
            flags: MessageFlags.Ephemeral,
        });
    }

    return interaction.update({
        embeds: [
            new EmbedBuilder()
                .setTitle(`❌ Treasury Donation #${id} Rejected`)
                .setDescription(`Rejected by ${interaction.user}.`)
                .setTimestamp(),
        ],
        components: [],
    });
}

async function showTrust(interaction) {
    const profile = ensureUser(interaction.guildId, interaction.user.id);

    const highTier = profile.banned
        ? "🚫 Blocked"
        : profile.trust >= HIGH_TIER_MIN_TRUST
            ? "✅ Available"
            : "🔒 Restricted";

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle("⭐ Your Treasury Trust")
                .setDescription([
                    `**Trust Score:** ${profile.trust}/100`,
                    `**Legendary/T3 borrowing:** ${highTier}`,
                    `**Accepted donations:** ${profile.donations}`,
                    `**Late returns:** ${profile.lateReturns}`,
                    `**Scam flags:** ${profile.scams}`,
                    "",
                    profile.trust < HIGH_TIER_MIN_TRUST
                        ? `Donate old Legendary/T3 items to rebuild Trust. Each accepted donation gives +${DONATION_REWARD}.`
                        : "Your Trust is high enough for Legendary/T3 borrowing.",
                ].join("\n"))
                .setTimestamp(),
        ],
        flags: MessageFlags.Ephemeral,
    });
}

async function handleTreasuryInteraction(interaction) {
    if (!interaction.guild) return false;

    try {
        if (interaction.isButton()) {
            if (interaction.customId === "treasury_borrow") {
                await interaction.showModal(borrowModal());
                return true;
            }

            if (interaction.customId === "treasury_donate") {
                await interaction.showModal(donationModal());
                return true;
            }

            if (interaction.customId === "treasury_trust") {
                await showTrust(interaction);
                return true;
            }

            const handlers = [
                ["treasury_accept_donation_", acceptDonation],
                ["treasury_reject_donation_", rejectDonation],
                ["treasury_return_contact_", contactReturn],
                ["treasury_returned_", markReturned],
                ["treasury_approve_", approveLoan],
                ["treasury_reject_", rejectLoan],
            ];

            for (const [prefix, handler] of handlers) {
                if (interaction.customId.startsWith(prefix)) {
                    const id = Number(interaction.customId.slice(prefix.length));
                    if (!Number.isInteger(id) || id <= 0) {
                        await interaction.reply({
                            content: "❌ Invalid Treasury record.",
                            flags: MessageFlags.Ephemeral,
                        });
                        return true;
                    }

                    await handler(interaction, id);
                    return true;
                }
            }
        }

        if (interaction.isModalSubmit()) {
            if (interaction.customId === "treasury_borrow_modal") {
                await submitBorrow(interaction);
                return true;
            }

            if (interaction.customId === "treasury_donation_modal") {
                await submitDonation(interaction);
                return true;
            }
        }

        return false;
    } catch (error) {
        console.error("[TREASURY] Interaction error:", error);

        const payload = {
            content: "❌ Treasury error. Staff have been notified in the console.",
            flags: MessageFlags.Ephemeral,
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(payload).catch(() => {});
        } else {
            await interaction.reply(payload).catch(() => {});
        }

        return true;
    }
}

async function runTreasuryMonitor(client) {
    const now = Date.now();

    const activeLoans = db.prepare(`
        SELECT * FROM treasury_loans
        WHERE status IN ('approved', 'overdue')
        AND dueAt IS NOT NULL
    `).all();

    for (const loan of activeLoans) {
        const settings = getSettings(loan.guild);
        if (!settings) continue;

        const guild = client.guilds.cache.get(loan.guild);
        if (!guild) continue;

        const scamAt = loan.dueAt + SCAM_AFTER_HOURS * 60 * 60 * 1000;

        if (now > scamAt) {
            const transaction = db.transaction(() => {
                db.prepare(`
                    UPDATE treasury_loans SET status = 'scam'
                    WHERE id = ? AND status IN ('approved', 'overdue')
                `).run(loan.id);

                db.prepare(`
                    INSERT INTO treasury_users(guild, user, trust, banned, scams)
                    VALUES(?, ?, 0, 1, 1)
                    ON CONFLICT(guild, user) DO UPDATE SET
                        trust = 0,
                        banned = 1,
                        scams = scams + 1
                `).run(loan.guild, loan.user);
            });

            transaction();

            const ticket = guild.channels.cache.get(loan.ticketChannel);
            if (ticket?.isTextBased()) {
                await ticket.send({
                    content: `<@&${settings.staffRole}> <@${loan.user}>`,
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("🚨 TREASURY SCAM THRESHOLD REACHED")
                            .setDescription([
                                `Loan #${loan.id}: **${loan.item}** has not been returned.`,
                                `The return deadline was ${discordTime(loan.dueAt)}.`,
                                `The ${SCAM_AFTER_HOURS}-hour post-deadline limit has expired.`,
                                "",
                                "**Status:** SCAM FLAG",
                                "**Trust:** 0/100",
                                "**Borrowing:** Blocked",
                                "",
                                "Staff: apply the appropriate in-game ban/review. The Discord bot does not directly ban the Roblox account.",
                            ].join("\n"))
                            .setTimestamp(),
                    ],
                }).catch(() => {});
            }

            await safeLog(guild, settings, {
                content: `🚨 **TREASURY SCAM FLAG** — Loan #${loan.id}, <@${loan.user}>, item **${loan.item}**. Trust set to 0 and Treasury borrowing blocked.`,
            });

            continue;
        }

        if (now > loan.dueAt && loan.status === "approved") {
            db.prepare(`
                UPDATE treasury_loans SET status = 'overdue'
                WHERE id = ? AND status = 'approved'
            `).run(loan.id);

            const graceEnd = loan.dueAt + GRACE_HOURS * 60 * 60 * 1000;
            const ticket = guild.channels.cache.get(loan.ticketChannel);

            if (ticket?.isTextBased()) {
                await ticket.send({
                    content: `<@${loan.user}>`,
                    embeds: [
                        new EmbedBuilder()
                            .setTitle("⏰ Treasury Loan Deadline Reached")
                            .setDescription([
                                `Loan #${loan.id} for **${loan.item}** is now overdue.`,
                                `Deadline: ${discordTime(loan.dueAt)}`,
                                `Grace contact ends: ${discordTime(graceEnd)} (${discordTime(graceEnd, "R")})`,
                                "",
                                `If you are returning it now, press **I Am Ready To Return** within the ${GRACE_HOURS}-hour grace window to avoid the late Trust penalty.`,
                            ].join("\n"))
                            .setTimestamp(),
                    ],
                }).catch(() => {});
            }
        }
    }
}

let monitorStarted = false;

function startTreasuryMonitor(client) {
    if (monitorStarted) return;
    monitorStarted = true;

    console.log("[TREASURY] Monitor enabled.");

    runTreasuryMonitor(client).catch((error) => {
        console.error("[TREASURY] Initial monitor error:", error);
    });

    const timer = setInterval(() => {
        runTreasuryMonitor(client).catch((error) => {
            console.error("[TREASURY] Monitor error:", error);
        });
    }, 10 * 60 * 1000);

    timer.unref?.();
}

function getTreasuryProfile(guildId, userId) {
    return ensureUser(guildId, userId);
}

function setTreasuryTrust(guildId, userId, trust) {
    ensureUser(guildId, userId);
    db.prepare(`
        UPDATE treasury_users SET trust = ? WHERE guild = ? AND user = ?
    `).run(Math.max(0, Math.min(100, trust)), guildId, userId);

    return ensureUser(guildId, userId);
}

function clearTreasuryScam(guildId, userId) {
    ensureUser(guildId, userId);
    db.prepare(`
        UPDATE treasury_users SET banned = 0 WHERE guild = ? AND user = ?
    `).run(guildId, userId);

    return ensureUser(guildId, userId);
}

module.exports = {
    HIGH_TIER_MIN_TRUST,
    DONATION_REWARD,
    clearTreasuryScam,
    getSettings,
    getTreasuryProfile,
    handleTreasuryInteraction,
    saveSettings,
    setTreasuryTrust,
    startTreasuryMonitor,
    treasuryPanelComponents,
    treasuryPanelEmbed,
};