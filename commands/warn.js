const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const { addWarning, listWarnings, maybeSendAbuseAlert, removeWarning } = require("../platform/communitySystems");

function canModerate(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function formatDate(ms) {
  return `<t:${Math.floor(Number(ms) / 1000)}:R>`;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Carry Tavern warning system")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((s) => s.setName("add").setDescription("Warn a member")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("Warning reason").setRequired(true).setMaxLength(1000)))
    .addSubcommand((s) => s.setName("list").setDescription("View a member's warnings")
      .addUserOption((o) => o.setName("user").setDescription("Member").setRequired(true))
      .addBooleanOption((o) => o.setName("active_only").setDescription("Only show active warnings")))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove an active warning")
      .addIntegerOption((o) => o.setName("id").setDescription("Warning ID").setRequired(true).setMinValue(1))),

  async execute(interaction) {
    if (!canModerate(interaction)) return interaction.reply({ content: "❌ Moderate Members permission is required.", flags: MessageFlags.Ephemeral });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "add") {
        const target = interaction.options.getUser("user", true);
        if (target.bot) return interaction.reply({ content: "❌ Bots cannot receive Tavern warnings.", flags: MessageFlags.Ephemeral });
        const reason = interaction.options.getString("reason", true).trim();
        const id = addWarning(interaction.guildId, target.id, interaction.user.id, reason);
        await target.send(`⚠️ **Carry Tavern Warning #${id}**\n${reason}\n\nRepeated warnings, no-shows or disputes may be surfaced to staff by the anti-abuse system.`).catch(() => {});
        await maybeSendAbuseAlert(interaction.client, interaction.guildId, target.id, `warning #${id}`).catch(() => {});
        return interaction.reply({ content: `✅ Warned ${target}. Warning ID: **#${id}**`, flags: MessageFlags.Ephemeral });
      }

      if (sub === "remove") {
        const id = interaction.options.getInteger("id", true);
        const changed = removeWarning(interaction.guildId, id, interaction.user.id);
        return interaction.reply({ content: changed ? `✅ Warning **#${id}** is no longer active.` : `❌ Active warning **#${id}** was not found.`, flags: MessageFlags.Ephemeral });
      }

      const target = interaction.options.getUser("user", true);
      const activeOnly = interaction.options.getBoolean("active_only") ?? false;
      const rows = listWarnings(interaction.guildId, target.id, activeOnly);
      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings • ${target.username}`)
        .setThumbnail(target.displayAvatarURL({ size: 128 }))
        .setDescription(rows.length
          ? rows.map((row) => `**#${row.id} ${row.active ? "🟠 ACTIVE" : "⚪ REMOVED"}** • ${formatDate(row.created_at)}\n${row.reason}\nStaff: <@${row.staff}>`).join("\n\n").slice(0, 4000)
          : "No warnings found.");
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error("[WARN]", error);
      return interaction.reply({ content: `❌ ${error.message || "Warning command failed."}`, flags: MessageFlags.Ephemeral });
    }
  },
};
