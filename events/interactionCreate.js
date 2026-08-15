const db = require("../database/database");
const { handleTreasuryInteraction } = require("../treasury/treasury");
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
