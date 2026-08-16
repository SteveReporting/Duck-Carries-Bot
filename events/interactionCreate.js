const db = require("../database/database");
const { handleTreasuryInteraction } = require("../treasury/treasury");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, marketplaceBaseUrl } = require("../platform/helpers");
const { canonicalizeDungeon, canonicalizeDifficulty, parseRuns } = require("../platform/dungeons");
const { handleCarryTicketButton } = require("../platform/carryQueue");
const queueCommand = require("../commands/queue");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    EmbedBuilder,
    ModalBuilder,
    PermissionFlagsBits,
    TextInputBuilder,
    TextInputStyle,
} = require("discord.js");

function isCarrier(interaction) {
    return Boolean(
        interaction.member &&
        process.env.CARRIER_ROLE &&
        interaction.member.roles.cache.has(process.env.CARRIER_ROLE)
    );
}

function requestEmbed(request, statusText) {
    return new EmbedBuilder()
        .setTitle(`🍺 Carry Request #${request.id}`)
        .setDescription([
            `👤 **Roblox Username:** ${request.roblox}`,
            `🏰 **Dungeon:** ${canonicalizeDungeon(request.dungeon)}`,
            `⚔️ **Difficulty:** ${canonicalizeDifficulty(request.difficulty)}`,
            `👥 **Runs:** ${request.runs}`,
            `🕒 **Availability:** ${request.availability}`,
            "",
            `**Status:** ${statusText}`,
        ].join("\n"))
        .setTimestamp();
}

function claimButton(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`claim_${id}`)
            .setLabel("Claim")
            .setStyle(ButtonStyle.Success)
    );
}

function legacyCompletionButtons(id, carrierConfirmed = false, requesterConfirmed = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`complete_${id}`)
            .setLabel(carrierConfirmed ? "Carrier Confirmed" : "Carrier Complete")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(Boolean(carrierConfirmed)),
        new ButtonBuilder()
            .setCustomId(`requester_complete_${id}`)
            .setLabel(requesterConfirmed ? "Requester Confirmed" : "Requester Complete")
            .setStyle(ButtonStyle.Success)
            .setDisabled(Boolean(requesterConfirmed)),
        new ButtonBuilder()
            .setCustomId(`legacy_release_${id}`)
            .setLabel("Release Claim")
            .setStyle(ButtonStyle.Secondary),
    );
}

async function ticketParentId(guild, request) {
    if (process.env.TICKET_CATEGORY_ID) {
        const category = await guild.channels.fetch(process.env.TICKET_CATEGORY_ID).catch(() => null);
        if (category?.type === ChannelType.GuildCategory) return category.id;
    }
    const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guild.id);
    const queue = settings?.queueChannel ? await guild.channels.fetch(settings.queueChannel).catch(() => null) : null;
    return queue?.parentId || null;
}

async function createLegacyTicket(interaction, request, client) {
    const guild = interaction.guild;
    const ticket = await guild.channels.create({
        name: `carry-${canonicalizeDungeon(request.dungeon).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}-${request.id}`,
        type: ChannelType.GuildText,
        parent: await ticketParentId(guild, request),
        permissionOverwrites: [
            { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
            { id: request.user, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
        ],
        reason: `Carry request #${request.id} claimed`,
    });

    db.prepare(`
        UPDATE queue
        SET ticket_channel = ?, message_channel = ?, message_id = ?
        WHERE id = ?
    `).run(ticket.id, interaction.channelId, interaction.message?.id || null, request.id);

    await ticket.send({
        content: `<@${request.user}> <@${interaction.user.id}>`,
        embeds: [requestEmbed({ ...request, carrier: interaction.user.id }, `🟢 Claimed by <@${interaction.user.id}>`)],
        components: [legacyCompletionButtons(request.id)],
    });

    try {
        const requester = await client.users.fetch(request.user);
        await requester.send([
            "🍺 **Your carry request has been claimed.**",
            `Dungeon: **${canonicalizeDungeon(request.dungeon)}**`,
            `Difficulty: **${canonicalizeDifficulty(request.difficulty)}**`,
            `Runs: **${request.runs}**`,
            `Carrier: <@${interaction.user.id}>`,
            `Private ticket: <#${ticket.id}>`,
        ].join("\n"));
    } catch (error) {
        console.warn("Could not DM requester:", error.message);
    }

    return ticket;
}

async function showCarryModal(interaction) {
    const profile = await getLinkedProfile(interaction.user.id);
    if (!profile) {
        const base = marketplaceBaseUrl();
        return interaction.reply({
            content: `❌ Before requesting a carry, link your Tavern account.${base ? `\nSign in with Discord: ${base}/auth` : ""}`,
            ephemeral: true,
        });
    }
    if (!profile.roblox_verified_at || !profile.roblox_username) {
        return interaction.reply({
            content: "❌ Before requesting a carry, verify your Roblox account with `/tavern link-roblox` and then `/tavern verify-roblox`.",
            ephemeral: true,
        });
    }

    const modal = new ModalBuilder()
        .setCustomId("carry_modal")
        .setTitle("Request Carry");

    const fields = [
        ["dungeon", "Dungeon (UW, GH, AT, etc.)", TextInputStyle.Short, true],
        ["difficulty", "Difficulty (NM, INS HC, etc.)", TextInputStyle.Short, true],
        ["runs", "Number of Runs (1-15)", TextInputStyle.Short, true],
        ["availability", "Availability", TextInputStyle.Short, true],
        ["notes", "Extra Notes (optional)", TextInputStyle.Paragraph, false],
    ];

    const rows = fields.map(([id, label, style, required]) => {
        const input = new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(style)
            .setRequired(required);
        if (id === "runs") input.setMaxLength(2);
        if (id === "notes") input.setMaxLength(1000);
        return new ActionRowBuilder().addComponents(input);
    });

    modal.addComponents(...rows);
    return interaction.showModal(modal);
}

async function claimCarry(interaction, client, id) {
    if (!isCarrier(interaction)) {
        return interaction.reply({ content: "❌ You are not a carrier.", ephemeral: true });
    }

    const request = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (!request) return interaction.reply({ content: "❌ Carry request not found.", ephemeral: true });
    if (request.status !== "waiting") return interaction.reply({ content: "❌ This carry has already been claimed.", ephemeral: true });

    const updated = db.prepare(`
        UPDATE queue
        SET carrier = ?, status = 'claimed', carrier_confirmed = 0, requester_confirmed = 0
        WHERE id = ? AND status = 'waiting'
    `).run(interaction.member.id, id);
    if (updated.changes !== 1) return interaction.reply({ content: "❌ Another carrier claimed this request first.", ephemeral: true });

    try {
        const ticket = await createLegacyTicket(interaction, request, client);
        return interaction.update({
            embeds: [requestEmbed({ ...request, carrier: interaction.member.id }, `🟢 Claimed by ${interaction.member} • Ticket <#${ticket.id}>`)],
            components: [legacyCompletionButtons(id)],
        });
    } catch (error) {
        db.prepare("UPDATE queue SET carrier = NULL, status = 'waiting' WHERE id = ?").run(id);
        throw error;
    }
}

async function finalizeLegacyCarry(interaction, request) {
    const transaction = db.transaction(() => {
        db.prepare("DELETE FROM queue WHERE id = ?").run(request.id);
        db.prepare(`
            INSERT INTO stats(user, completed)
            VALUES(?, 1)
            ON CONFLICT(user)
            DO UPDATE SET completed = completed + 1
        `).run(request.carrier);
    });
    transaction();

    await interaction.update({
        embeds: [requestEmbed(request, "✅ Completed • Carrier + requester confirmed")],
        components: [],
    });

    if (request.ticket_channel) {
        const ticket = await interaction.client.channels.fetch(request.ticket_channel).catch(() => null);
        if (ticket?.isTextBased?.()) {
            await ticket.send("✅ Both sides confirmed this carry. This ticket will close in 60 seconds.").catch(() => {});
            setTimeout(() => ticket.delete("Carry completed").catch(() => {}), 60_000).unref?.();
        }
    }
}

async function completeCarry(interaction, id) {
    if (!isCarrier(interaction)) return interaction.reply({ content: "❌ You are not a carrier.", ephemeral: true });
    const request = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (!request) return interaction.reply({ content: "❌ Carry request not found.", ephemeral: true });
    if (request.carrier !== interaction.member.id) return interaction.reply({ content: "❌ Only the Carrier who claimed this request can confirm it.", ephemeral: true });

    db.prepare("UPDATE queue SET carrier_confirmed = 1 WHERE id = ?").run(id);
    const refreshed = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (refreshed.requester_confirmed) return finalizeLegacyCarry(interaction, refreshed);

    return interaction.update({
        embeds: [requestEmbed(refreshed, `🟠 Carrier confirmed • Waiting for <@${refreshed.user}>`)],
        components: [legacyCompletionButtons(id, true, false)],
    });
}

async function requesterCompleteCarry(interaction, id) {
    const request = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (!request) return interaction.reply({ content: "❌ Carry request not found.", ephemeral: true });
    if (request.user !== interaction.user.id) return interaction.reply({ content: "❌ Only the requester can press Requester Complete.", ephemeral: true });

    db.prepare("UPDATE queue SET requester_confirmed = 1 WHERE id = ?").run(id);
    const refreshed = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (refreshed.carrier_confirmed) return finalizeLegacyCarry(interaction, refreshed);

    return interaction.update({
        embeds: [requestEmbed(refreshed, `🟠 Requester confirmed • Waiting for <@${refreshed.carrier}>`)],
        components: [legacyCompletionButtons(id, false, true)],
    });
}

async function releaseLegacyClaim(interaction, id) {
    const request = db.prepare("SELECT * FROM queue WHERE id = ?").get(id);
    if (!request) return interaction.reply({ content: "❌ Carry request not found.", ephemeral: true });
    if (request.carrier !== interaction.user.id && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: "❌ Only the Carrier who claimed this request can release it.", ephemeral: true });
    }

    db.prepare(`
        UPDATE queue
        SET carrier=NULL,status='waiting',ticket_channel=NULL,carrier_confirmed=0,requester_confirmed=0
        WHERE id=?
    `).run(id);

    if (request.message_channel && request.message_id) {
        const source = await interaction.client.channels.fetch(request.message_channel).catch(() => null);
        const message = source?.messages?.fetch ? await source.messages.fetch(request.message_id).catch(() => null) : null;
        if (message) await message.edit({ embeds: [requestEmbed(request, "🟡 Waiting")], components: [claimButton(id)] }).catch(() => {});
    }

    try {
        const requester = await interaction.client.users.fetch(request.user);
        await requester.send(`🍺 Your **${canonicalizeDungeon(request.dungeon)}** carry is back in the queue because the Carrier released the claim.`);
    } catch {}

    await interaction.reply({ content: "✅ Claim released. The request is back in the queue.", ephemeral: true });
    if (request.ticket_channel) {
        const ticket = await interaction.client.channels.fetch(request.ticket_channel).catch(() => null);
        if (ticket?.isTextBased?.()) {
            await ticket.send("🔁 The Carrier released this claim. This ticket will close in 30 seconds.").catch(() => {});
            setTimeout(() => ticket.delete("Carry claim released").catch(() => {}), 30_000).unref?.();
        }
    }
}

async function submitCarry(interaction) {
    if (!interaction.guild) return interaction.reply({ content: "❌ Carry requests must be created inside the server.", ephemeral: true });

    const profile = await getLinkedProfile(interaction.user.id);
    if (!profile || !profile.roblox_verified_at || !profile.roblox_username) {
        return interaction.reply({ content: "❌ Verify your Roblox account before requesting a carry.", ephemeral: true });
    }

    const get = (id) => interaction.fields.getTextInputValue(id).trim();
    const runs = parseRuns(get("runs"));
    if (!runs) return interaction.reply({ content: "❌ Runs must be a number from **1 to 15**.", ephemeral: true });

    const values = {
        dungeon: canonicalizeDungeon(get("dungeon")),
        difficulty: canonicalizeDifficulty(get("difficulty")),
        runs,
        availability: get("availability").slice(0, 240),
        notes: get("notes") || null,
    };

    const supabase = getSupabase();
    const { data: active, error: activeError } = await supabase
        .from("carry_requests")
        .select("id,dungeon,status")
        .eq("requester_id", profile.id)
        .in("status", ["queued", "claimed", "in_progress"])
        .limit(1)
        .maybeSingle();
    if (activeError) throw activeError;
    if (active) return interaction.reply({ content: `❌ You already have an active **${active.dungeon}** request.`, ephemeral: true });

    const { data, error } = await supabase.from("carry_requests").insert({
        requester_id: profile.id,
        dungeon: values.dungeon,
        difficulty: values.difficulty,
        runs_requested: values.runs,
        availability: values.availability,
        notes: values.notes,
        status: "queued",
    }).select("id").single();
    if (error) return interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });

    const base = marketplaceBaseUrl();
    return interaction.reply({
        content: [
            "✅ **Your carry is in the shared Tavern queue.**",
            `🏰 ${values.dungeon}`,
            `⚔️ ${values.difficulty}`,
            `👥 ${values.runs} run${values.runs === 1 ? "" : "s"}`,
            `🎮 Roblox: ${profile.roblox_username}`,
            "",
            "Carriers see matching requests merged together by dungeon and difficulty.",
            base ? `${base}/carry-queue` : null,
        ].filter(Boolean).join("\n"),
        ephemeral: true,
    });
}

module.exports = {
    name: "interactionCreate",

    async execute(interaction, client) {
        try {
            if (interaction.isChatInputCommand()) {
                console.log(`[COMMAND] /${interaction.commandName} used by ${interaction.user.tag}`);
                const command = client.commands.get(interaction.commandName);
                if (!command) {
                    console.warn(`[COMMAND] No handler loaded for /${interaction.commandName}`);
                    return interaction.reply({ content: "❌ That command is registered in Discord but is not loaded by the bot.", ephemeral: true });
                }
                return await command.execute(interaction);
            }

            const treasuryHandled = await handleTreasuryInteraction(interaction);
            if (treasuryHandled) return;

            if (await queueCommand.handleQueueComponent?.(interaction)) return;
            if (interaction.isButton() && await handleCarryTicketButton(interaction)) return;

            if (interaction.isButton()) {
                if (interaction.customId === "create_carry") return await showCarryModal(interaction);
                if (interaction.customId.startsWith("claim_")) return await claimCarry(interaction, client, interaction.customId.slice("claim_".length));
                if (interaction.customId.startsWith("complete_")) return await completeCarry(interaction, interaction.customId.slice("complete_".length));
                if (interaction.customId.startsWith("requester_complete_")) return await requesterCompleteCarry(interaction, interaction.customId.slice("requester_complete_".length));
                if (interaction.customId.startsWith("legacy_release_")) return await releaseLegacyClaim(interaction, interaction.customId.slice("legacy_release_".length));
                return;
            }

            if (interaction.isModalSubmit() && interaction.customId === "carry_modal") return await submitCarry(interaction);
        } catch (error) {
            console.error("[INTERACTION ERROR]", error);
            const message = `❌ ${error.message || "Something went wrong while running that interaction."}`;
            if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
            else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
        }
    },
};
