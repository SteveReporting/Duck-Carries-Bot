require("dotenv").config();

const db = require("../database/database");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");
const {
    getSettings,
    treasuryPanelComponents,
} = require("./treasury");

const MAX_GOLD_DONATION = 10_000_000_000_000; // 10T
const SHEET_SYNC_INTERVAL = 5 * 60 * 1000;
const SHEET_SYNC_BATCH = 50;

let sheetSyncStarted = false;

db.prepare(`
CREATE TABLE IF NOT EXISTS treasury_gold_donations(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild TEXT NOT NULL,
    guildName TEXT,
    user TEXT NOT NULL,
    discordUsername TEXT NOT NULL,
    discordDisplayName TEXT,
    roblox TEXT NOT NULL,
    amount INTEGER NOT NULL,
    amountDisplay TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    sheetSynced INTEGER NOT NULL DEFAULT 0,
    sheetAttempts INTEGER NOT NULL DEFAULT 0,
    sheetError TEXT
)
`).run();

function trimNumber(value) {
    return String(value)
        .replace(/\.0+$/, "")
        .replace(/(\.\d*?)0+$/, "$1");
}

function formatGold(amount) {
    const units = [
        [1_000_000_000_000, "T"],
        [1_000_000_000, "B"],
        [1_000_000, "M"],
        [1_000, "K"],
    ];

    for (const [factor, suffix] of units) {
        if (amount >= factor) {
            return `${trimNumber((amount / factor).toFixed(3))}${suffix}`;
        }
    }

    return amount.toLocaleString("en-US");
}

function parseGoldAmount(input) {
    const normalized = String(input || "")
        .trim()
        .toLowerCase()
        .replace(/,/g, "")
        .replace(/\s+/g, "");

    const match = normalized.match(/^(\d+(?:\.\d+)?)(k|m|b|t|thousand|million|billion|trillion)?$/i);
    if (!match) {
        return {
            ok: false,
            error: "Use a gold amount such as 500B, 2.5T, or 750000000000.",
        };
    }

    const number = Number(match[1]);
    const unit = String(match[2] || "").toLowerCase();
    const multiplier = {
        "": 1,
        k: 1_000,
        thousand: 1_000,
        m: 1_000_000,
        million: 1_000_000,
        b: 1_000_000_000,
        billion: 1_000_000_000,
        t: 1_000_000_000_000,
        trillion: 1_000_000_000_000,
    }[unit];

    const rawAmount = number * multiplier;
    const amount = Math.round(rawAmount);

    if (!Number.isFinite(rawAmount) || !Number.isSafeInteger(amount) || amount <= 0) {
        return {
            ok: false,
            error: "Gold donation amount must be greater than 0.",
        };
    }

    if (rawAmount > MAX_GOLD_DONATION || amount > MAX_GOLD_DONATION) {
        return {
            ok: false,
            error: `The maximum gold donation is ${formatGold(MAX_GOLD_DONATION)}.`,
        };
    }

    return {
        ok: true,
        amount,
        display: formatGold(amount),
    };
}

function goldDonationButtonRow(disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("treasury_donate_gold")
            .setLabel("Donate Gold")
            .setEmoji("🪙")
            .setStyle(ButtonStyle.Success)
            .setDisabled(disabled),
    );
}

function goldDonationModal() {
    const modal = new ModalBuilder()
        .setCustomId("treasury_gold_donation_modal")
        .setTitle("Donate Gold To The Treasury");

    const roblox = new TextInputBuilder()
        .setCustomId("roblox")
        .setLabel("Roblox Username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(30)
        .setPlaceholder("Your Roblox username");

    const amount = new TextInputBuilder()
        .setCustomId("gold_amount")
        .setLabel("How Much Gold? (Maximum 10T)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(32)
        .setPlaceholder("Example: 500B or 2.5T");

    modal.addComponents(
        new ActionRowBuilder().addComponents(roblox),
        new ActionRowBuilder().addComponents(amount),
    );

    return modal;
}

function sheetConfig() {
    return {
        url: String(process.env.GOLD_DONATION_SHEET_WEBHOOK_URL || "").trim(),
        secret: String(process.env.GOLD_DONATION_SHEET_WEBHOOK_SECRET || "").trim(),
    };
}

function recordToSheetPayload(record) {
    return {
        submissionId: Number(record.id),
        timestamp: new Date(Number(record.createdAt)).toISOString(),
        discordUserId: String(record.user),
        discordUsername: String(record.discordUsername || ""),
        discordDisplayName: String(record.discordDisplayName || ""),
        robloxUsername: String(record.roblox || ""),
        goldAmount: Number(record.amount),
        goldAmountDisplay: String(record.amountDisplay || formatGold(Number(record.amount) || 0)),
        guildId: String(record.guild || ""),
        guildName: String(record.guildName || ""),
    };
}

async function postDonationToSheet(record) {
    const config = sheetConfig();
    if (!config.url || !config.secret) {
        return {
            ok: false,
            skipped: true,
            error: "Google Sheets donation webhook is not configured.",
        };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    timeout.unref?.();

    try {
        const response = await fetch(config.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                secret: config.secret,
                ...recordToSheetPayload(record),
            }),
            signal: controller.signal,
        });

        const text = await response.text();
        let body = {};
        try {
            body = text ? JSON.parse(text) : {};
        } catch {
            body = {};
        }

        if (!response.ok || body.ok !== true) {
            throw new Error(body.error || `Google Sheets webhook HTTP ${response.status}`);
        }

        return { ok: true };
    } catch (error) {
        return {
            ok: false,
            skipped: false,
            error: error.name === "AbortError"
                ? "Google Sheets webhook timed out."
                : (error.message || String(error)),
        };
    } finally {
        clearTimeout(timeout);
    }
}

async function syncDonationRecord(record) {
    const result = await postDonationToSheet(record);

    if (result.ok) {
        db.prepare(`
            UPDATE treasury_gold_donations
            SET sheetSynced = 1,
                sheetAttempts = sheetAttempts + 1,
                sheetError = NULL
            WHERE id = ?
        `).run(record.id);
    } else if (!result.skipped) {
        db.prepare(`
            UPDATE treasury_gold_donations
            SET sheetAttempts = sheetAttempts + 1,
                sheetError = ?
            WHERE id = ?
        `).run(String(result.error || "Unknown Sheets error").slice(0, 500), record.id);
    }

    return result;
}

async function syncPendingGoldDonations() {
    const config = sheetConfig();
    if (!config.url || !config.secret) return;

    const pending = db.prepare(`
        SELECT * FROM treasury_gold_donations
        WHERE sheetSynced = 0
        ORDER BY createdAt ASC
        LIMIT ?
    `).all(SHEET_SYNC_BATCH);

    for (const record of pending) {
        const result = await syncDonationRecord(record);
        if (!result.ok) {
            console.warn(`[TREASURY GOLD] Sheet sync #${record.id} failed: ${result.error}`);
        }
    }
}

function startGoldDonationSheetSync() {
    if (sheetSyncStarted) return;
    sheetSyncStarted = true;

    syncPendingGoldDonations().catch((error) => {
        console.error("[TREASURY GOLD] Initial Sheet sync failed:", error);
    });

    const timer = setInterval(() => {
        syncPendingGoldDonations().catch((error) => {
            console.error("[TREASURY GOLD] Sheet sync failed:", error);
        });
    }, SHEET_SYNC_INTERVAL);

    timer.unref?.();
}

async function safeTreasuryLog(guild, settings, payload) {
    try {
        const channel = guild.channels.cache.get(settings.logChannel)
            || await guild.channels.fetch(settings.logChannel).catch(() => null);
        if (channel?.isTextBased()) {
            await channel.send(payload);
        }
    } catch (error) {
        console.warn("[TREASURY GOLD] Could not send Treasury log:", error.message);
    }
}

async function submitGoldDonation(interaction) {
    const settings = getSettings(interaction.guildId);
    if (!settings) {
        return interaction.reply({
            content: "❌ The Treasury has not been configured yet.",
            flags: MessageFlags.Ephemeral,
        });
    }

    const roblox = interaction.fields.getTextInputValue("roblox").trim();
    const parsed = parseGoldAmount(interaction.fields.getTextInputValue("gold_amount"));

    if (!roblox) {
        return interaction.reply({
            content: "❌ Enter your Roblox username.",
            flags: MessageFlags.Ephemeral,
        });
    }

    if (!parsed.ok) {
        return interaction.reply({
            content: `❌ ${parsed.error} Maximum allowed: **10T**.`,
            flags: MessageFlags.Ephemeral,
        });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const createdAt = Date.now();
    const discordDisplayName = interaction.member?.displayName
        || interaction.user.globalName
        || interaction.user.username;

    const insert = db.prepare(`
        INSERT INTO treasury_gold_donations(
            guild,
            guildName,
            user,
            discordUsername,
            discordDisplayName,
            roblox,
            amount,
            amountDisplay,
            createdAt
        )
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        interaction.guildId,
        interaction.guild?.name || "",
        interaction.user.id,
        interaction.user.username,
        discordDisplayName,
        roblox,
        parsed.amount,
        parsed.display,
        createdAt,
    );

    const id = Number(insert.lastInsertRowid);
    const record = db.prepare(`
        SELECT * FROM treasury_gold_donations WHERE id = ?
    `).get(id);

    const sheet = await syncDonationRecord(record);

    await safeTreasuryLog(interaction.guild, settings, {
        embeds: [
            new EmbedBuilder()
                .setTitle(`🪙 Gold Donation Submission #${id}`)
                .setDescription([
                    `${interaction.user} submitted a gold donation.`,
                    `🎮 **Roblox:** ${roblox}`,
                    `💰 **Gold:** ${parsed.display}`,
                    `📊 **Sheets:** ${sheet.ok ? "✅ Logged" : "⚠️ Pending automatic sync"}`,
                ].join("\n"))
                .setFooter({ text: `Raw gold: ${parsed.amount.toLocaleString("en-US")}` })
                .setTimestamp(),
        ],
    });

    return interaction.editReply({
        content: sheet.ok
            ? `✅ Your **${parsed.display}** gold donation for Roblox **${roblox}** was submitted and logged to Google Sheets.`
            : `✅ Your **${parsed.display}** gold donation for Roblox **${roblox}** was saved. Google Sheets sync is pending and the bot will retry automatically.`,
    });
}

async function handleGoldDonationInteraction(interaction) {
    if (!interaction.guild) return false;

    if (interaction.isButton() && interaction.customId === "treasury_donate_gold") {
        await interaction.showModal(goldDonationModal());
        return true;
    }

    if (interaction.isModalSubmit() && interaction.customId === "treasury_gold_donation_modal") {
        await submitGoldDonation(interaction);
        return true;
    }

    return false;
}

function messageHasTreasuryPanel(message) {
    return (
        message?.author?.id &&
        message.embeds?.some((embed) => embed.title === "🏦 Welcome To The Treasury")
    );
}

async function ensureGoldDonationButtonOnPanels(client) {
    for (const guild of client.guilds.cache.values()) {
        const settings = getSettings(guild.id);
        if (!settings?.panelChannel) continue;

        try {
            const channel = guild.channels.cache.get(settings.panelChannel)
                || await guild.channels.fetch(settings.panelChannel).catch(() => null);
            if (!channel?.isTextBased() || !channel.messages) continue;

            const messages = await channel.messages.fetch({ limit: 100 });
            const panel = messages.find((message) =>
                message.author?.id === client.user.id && messageHasTreasuryPanel(message),
            );

            if (!panel) {
                console.warn(`[TREASURY GOLD] No Treasury panel found in #${channel.name}; run /treasury-setup to post one.`);
                continue;
            }

            await panel.edit({
                components: [
                    ...treasuryPanelComponents(),
                    goldDonationButtonRow(),
                ],
            });

            console.log(`[TREASURY GOLD] Donate Gold button ready in #${channel.name}.`);
        } catch (error) {
            console.warn(`[TREASURY GOLD] Could not update panel for ${guild.name}: ${error.message}`);
        }
    }
}

module.exports = {
    MAX_GOLD_DONATION,
    ensureGoldDonationButtonOnPanels,
    formatGold,
    goldDonationButtonRow,
    handleGoldDonationInteraction,
    parseGoldAmount,
    startGoldDonationSheetSync,
    syncPendingGoldDonations,
};
