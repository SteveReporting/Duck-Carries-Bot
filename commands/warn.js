const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const {
  addWarning,
  listWarnings,
  maybeSendAbuseAlert,
  removeWarning,
} = require("../platform/communitySystems");

const GOLD = 0xf2b705;
const RED = 0xe74c3c;
const GREEN = 0x2ecc71;
const FOOTER = "The Carry Tavern • Moderation Record";

function canModerate(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

function formatDate(ms) {
  return `<t:${Math.floor(Number(ms) / 1000)}:R>`;
}

function activeWarningCount(rows) {
  return rows.filter((row) => Boolean(row.active)).length;
}

function warningListEmbed(target, rows, activeOnly) {
  const active = activeWarningCount(rows);
  const risk = active >= 3 ? "🔴 Staff review recommended" : active > 0 ? "🟠 Active record" : "🟢 Clear";

  return new EmbedBuilder()
    .setColor(active >= 3 ? RED : active > 0 ? GOLD : GREEN)
    .setAuthor({ name: "THE CARRY TAVERN • MODERATION" })
    .setTitle(`⚠️ Warning Record • ${target.globalName || target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription(
      rows.length
        ? rows
            .map((row) => [
              `### #${row.id} • ${row.active ? "🟠 ACTIVE" : "⚪ REMOVED"}`,
              `${formatDate(row.created_at)} • Staff <@${row.staff}>`,
              String(row.reason).slice(0, 800),
            ].join("\n"))
            .join("\n\n")
            .slice(0, 4000)
        : activeOnly
          ? "No active warnings found."
          : "No warnings have been recorded.",
    )
    .addFields(
      { name: "🟠 Active", value: `**${active}**`, inline: true },
      { name: "📚 Shown", value: `**${rows.length}**`, inline: true },
      { name: "🛡️ Signal", value: risk, inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Tavern moderation warning records")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((subcommand) => subcommand
      .setName("add")
      .setDescription("Add a moderation warning to a member")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("Warning reason").setRequired(true).setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Open a member’s moderation record")
      .addUserOption((option) => option.setName("user").setDescription("Member").setRequired(true))
      .addBooleanOption((option) => option.setName("active_only").setDescription("Only show active warnings")))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Deactivate an active warning")
      .addIntegerOption((option) => option.setName("id").setDescription("Warning ID").setRequired(true).setMinValue(1))),

  async execute(interaction) {
    if (!canModerate(interaction)) {
      return interaction.reply({ content: "❌ Moderate Members permission is required.", flags: MessageFlags.Ephemeral });
    }

    try {
      const subcommand = interaction.options.getSubcommand();

      if (subcommand === "add") {
        const target = interaction.options.getUser("user", true);
        if (target.bot) {
          return interaction.reply({ content: "❌ Bots cannot receive Tavern warnings.", flags: MessageFlags.Ephemeral });
        }

        const reason = interaction.options.getString("reason", true).trim();
        const id = addWarning(interaction.guildId, target.id, interaction.user.id, reason);

        const memberEmbed = new EmbedBuilder()
          .setColor(GOLD)
          .setAuthor({ name: "THE CARRY TAVERN • MODERATION NOTICE" })
          .setTitle(`⚠️ Warning #${id}`)
          .setDescription(reason)
          .addFields({
            name: "What this means",
            value: "This warning is part of your Tavern moderation record. Repeated warnings, no-shows or disputes may be surfaced to staff for review.",
          })
          .setFooter({ text: "If you believe this was issued incorrectly, contact Tavern staff through Support." })
          .setTimestamp();

        await target.send({ embeds: [memberEmbed] }).catch(() => {});
        await maybeSendAbuseAlert(
          interaction.client,
          interaction.guildId,
          target.id,
          `warning #${id}`,
        ).catch(() => {});

        const staffEmbed = new EmbedBuilder()
          .setColor(GOLD)
          .setAuthor({ name: "THE CARRY TAVERN • MODERATION" })
          .setTitle(`✅ Warning #${id} Recorded`)
          .setDescription(reason)
          .addFields(
            { name: "👤 Member", value: `${target}`, inline: true },
            { name: "🛡️ Staff", value: `${interaction.user}`, inline: true },
            { name: "📌 Record", value: `Warning **#${id}**`, inline: true },
          )
          .setFooter({ text: FOOTER })
          .setTimestamp();

        return interaction.reply({ embeds: [staffEmbed], flags: MessageFlags.Ephemeral });
      }

      if (subcommand === "remove") {
        const id = interaction.options.getInteger("id", true);
        const changed = removeWarning(interaction.guildId, id, interaction.user.id);

        const embed = new EmbedBuilder()
          .setColor(changed ? GREEN : RED)
          .setAuthor({ name: "THE CARRY TAVERN • MODERATION" })
          .setTitle(changed ? `✅ Warning #${id} Deactivated` : `❌ Warning #${id} Not Found`)
          .setDescription(changed
            ? "The warning remains in the historical record but is no longer active."
            : "No matching active warning was found.")
          .setFooter({ text: FOOTER })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      const target = interaction.options.getUser("user", true);
      const activeOnly = interaction.options.getBoolean("active_only") ?? false;
      const rows = listWarnings(interaction.guildId, target.id, activeOnly);
      return interaction.reply({
        embeds: [warningListEmbed(target, rows, activeOnly)],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("[WARN]", error);
      const message = `❌ ${error.message || "Warning command failed."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },
};
