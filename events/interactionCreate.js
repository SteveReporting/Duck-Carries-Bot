const db = require("../database/database");
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
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
        .setTitle(`🦆 Carry Request #${request.id}`)
        .setDescription([
            `👤 **Roblox Username:** ${request.roblox}`,
            `🏰 **Dungeon:** ${request.dungeon}`,
            `⚔ **Difficulty:** ${request.difficulty}`,
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

function completeButton(id) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`complete_${id}`)
            .setLabel("Complete")
            .setStyle(ButtonStyle.Primary)
    );
}

async function showCarryModal(interaction) {
    const modal = new ModalBuilder()
        .setCustomId("carry_modal")
        .setTitle("Request Carry");

    const fields = [
        ["roblox", "Roblox Username"],
        ["dungeon", "Dungeon"],
        ["difficulty", "Difficulty"],
        ["runs", "Number of Runs"],
        ["availability", "Availability"],
    ];

    const rows = fields.map(([id, label]) => {
        const input = new TextInputBuilder()
            .setCustomId(id)
            .setLabel(label)
            .setStyle(TextInputStyle.Short)
            .setRequired(true);

        return new ActionRowBuilder().addComponents(input);
    });

    modal.addComponents(...rows);
    return interaction.showModal(modal);
}

async function claimCarry(interaction, client, id) {
    if (!isCarrier(interaction)) {
        return interaction.reply({
            content: "❌ You are not a carrier.",
            ephemeral: true,
        });
    }

    const request = db
        .prepare("SELECT * FROM queue WHERE id = ?")
        .get(id);

    if (!request) {
        return interaction.reply({
            content: "❌ Carry request not found.",
            ephemeral: true,
        });
    }

    if (request.status !== "waiting") {
        return interaction.reply({
            content: "❌ This carry has already been claimed.",
            ephemeral: true,
        });
    }

    const updated = db
        .prepare(
            "UPDATE queue SET carrier = ?, status = 'claimed' WHERE id = ? AND status = 'waiting'"
        )
        .run(interaction.member.id, id);

    // The conditional UPDATE prevents two carriers from winning the same race.
    if (updated.changes !== 1) {
        return interaction.reply({
            content: "❌ Another carrier claimed this request first.",
            ephemeral: true,
        });
    }

    try {
        const requester = await client.users.fetch(request.user);
        await requester.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🦆 Duck Carries Update")
                    .setDescription([
                        "Your carry request has been claimed!",
                        "",
                        `🏰 **Dungeon:** ${request.dungeon}`,
                        `⚔ **Difficulty:** ${request.difficulty}`,
                        `👥 **Runs:** ${request.runs}`,
                        `🧑 **Carrier:** ${interaction.member}`,
                        "",
                        "Please wait for further communication.",
                    ].join("\n"))
                    .setTimestamp(),
            ],
        });
    } catch (error) {
        console.warn("Could not DM requester:", error.message);
    }

    const claimedRequest = {
        ...request,
        carrier: interaction.member.id,
        status: "claimed",
    };

    return interaction.update({
        embeds: [requestEmbed(claimedRequest, `🟢 Claimed by ${interaction.member}`)],
        components: [completeButton(id)],
    });
}

async function completeCarry(interaction, id) {
    if (!isCarrier(interaction)) {
        return interaction.reply({
            content: "❌ You are not a carrier.",
            ephemeral: true,
        });
    }

    const request = db
        .prepare("SELECT * FROM queue WHERE id = ?")
        .get(id);

    if (!request) {
        return interaction.reply({
            content: "❌ Carry request not found.",
            ephemeral: true,
        });
    }

    if (request.carrier !== interaction.member.id) {
        return interaction.reply({
            content: "❌ Only the carrier who claimed this request can complete it.",
            ephemeral: true,
        });
    }

    const transaction = db.transaction(() => {
        db.prepare("DELETE FROM queue WHERE id = ?").run(id);
        db.prepare(`
            INSERT INTO stats(user, completed)
            VALUES(?, 1)
            ON CONFLICT(user)
            DO UPDATE SET completed = completed + 1
        `).run(request.carrier);
    });

    transaction();

    return interaction.update({
        embeds: [requestEmbed(request, `✅ Completed by ${interaction.member}`)],
        components: [],
    });
}

async function submitCarry(interaction) {
    if (!interaction.guild) {
        return interaction.reply({
            content: "❌ Carry requests must be created inside the server.",
            ephemeral: true,
        });
    }

    const get = (id) => interaction.fields.getTextInputValue(id).trim();
    const values = {
        roblox: get("roblox"),
        dungeon: get("dungeon"),
        difficulty: get("difficulty"),
        runs: get("runs"),
        availability: get("availability"),
    };

    const settings = db
        .prepare("SELECT * FROM settings WHERE guild = ?")
        .get(interaction.guild.id);

    if (!settings || !settings.queueChannel) {
        return interaction.reply({
            content: "❌ The queue has not been configured yet. Ask staff to run `/setup`.",
            ephemeral: true,
        });
    }

    const channel = interaction.guild.channels.cache.get(settings.queueChannel);
    if (!channel || !channel.isTextBased()) {
        return interaction.reply({
            content: "❌ The configured queue channel is unavailable.",
            ephemeral: true,
        });
    }

    const result = db.prepare(`
        INSERT INTO queue
            (guild, user, roblox, dungeon, difficulty, runs, availability, status)
        VALUES
            (?, ?, ?, ?, ?, ?, ?, 'waiting')
    `).run(
        interaction.guild.id,
        interaction.user.id,
        values.roblox,
        values.dungeon,
        values.difficulty,
        values.runs,
        values.availability
    );

    const request = {
        id: result.lastInsertRowid,
        ...values,
    };

    await channel.send({
        content: process.env.CARRIER_ROLE ? `<@&${process.env.CARRIER_ROLE}>` : undefined,
        embeds: [requestEmbed(request, "🟡 Waiting")],
        components: [claimButton(result.lastInsertRowid)],
    });

    return interaction.reply({
        content: "✅ Your carry request has been added to the queue!",
        ephemeral: true,
    });
}

module.exports = {
    name: "interactionCreate",

    async execute(interaction, client) {
        if (interaction.isChatInputCommand()) {
            const command = client.commands.get(interaction.commandName);
            if (command) {
                return command.execute(interaction);
            }
            return;
        }

        if (interaction.isButton()) {
            if (interaction.customId === "create_carry") {
                return showCarryModal(interaction);
            }

            if (interaction.customId.startsWith("claim_")) {
                return claimCarry(
                    interaction,
                    client,
                    interaction.customId.slice("claim_".length)
                );
            }

            if (interaction.customId.startsWith("complete_")) {
                return completeCarry(
                    interaction,
                    interaction.customId.slice("complete_".length)
                );
            }

            return;
        }

        if (interaction.isModalSubmit() && interaction.customId === "carry_modal") {
            return submitCarry(interaction);
        }
    },
};
