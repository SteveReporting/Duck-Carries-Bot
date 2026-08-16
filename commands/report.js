const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");
const db = require("../database/database");
const { maybeSendAbuseAlert, recordTradeDispute, resolveTradeDispute } = require("../platform/communitySystems");

async function sendStaffCase(interaction, id, kind, target, reason, evidence) {
  if (!process.env.MOD_LOG_CHANNEL_ID) return;
  const channel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setTitle(`${kind === "scam" ? "🚨 Scam Report" : "⚖️ Trade Dispute"} #${id}`)
    .addFields(
      { name: "Reporter", value: `<@${interaction.user.id}>`, inline: true },
      { name: "Reported Member", value: `<@${target.id}>`, inline: true },
      { name: "Reason", value: reason.slice(0, 1024) },
    )
    .setTimestamp();
  if (evidence) embed.addFields({ name: "Evidence / Reference", value: evidence.slice(0, 1024) });
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function createCase(interaction, kind) {
  const target = interaction.options.getUser("user", true);
  if (target.id === interaction.user.id) return interaction.reply({ content: "❌ You cannot open a dispute against yourself.", flags: MessageFlags.Ephemeral });
  const reason = interaction.options.getString("reason", true).trim();
  const evidence = interaction.options.getString("evidence")?.trim() || null;
  const id = recordTradeDispute({
    guildId: interaction.guildId,
    reporterId: interaction.user.id,
    targetId: target.id,
    kind,
    reason,
    evidence,
  });
  await sendStaffCase(interaction, id, kind, target, reason, evidence);
  await maybeSendAbuseAlert(interaction.client, interaction.guildId, target.id, `${kind} report #${id}`).catch(() => {});
  return interaction.reply({
    content: `✅ **${kind === "scam" ? "Scam report" : "Trade dispute"} #${id} opened.** Staff can review it${process.env.MOD_LOG_CHANNEL_ID ? " in the moderation log" : " from the bot database"}.`,
    flags: MessageFlags.Ephemeral,
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report scams or open a Carry Tavern trade dispute")
    .addSubcommand((s) => s.setName("scam").setDescription("Report suspected scamming")
      .addUserOption((o) => o.setName("user").setDescription("Member being reported").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("What happened").setRequired(true).setMaxLength(1500))
      .addStringOption((o) => o.setName("evidence").setDescription("Evidence link, listing ID, trade ID or notes").setMaxLength(1000)))
    .addSubcommand((s) => s.setName("dispute").setDescription("Open a trade dispute for staff review")
      .addUserOption((o) => o.setName("user").setDescription("Other trader").setRequired(true))
      .addStringOption((o) => o.setName("reason").setDescription("What happened").setRequired(true).setMaxLength(1500))
      .addStringOption((o) => o.setName("evidence").setDescription("Evidence link, listing ID, trade ID or notes").setMaxLength(1000)))
    .addSubcommand((s) => s.setName("status").setDescription("Check one of your report cases")
      .addIntegerOption((o) => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1)))
    .addSubcommand((s) => s.setName("resolve").setDescription("Staff: mark a report case resolved")
      .addIntegerOption((o) => o.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "scam" || sub === "dispute") return createCase(interaction, sub);

      const id = interaction.options.getInteger("id", true);
      if (sub === "resolve") {
        if (!interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
          return interaction.reply({ content: "❌ Moderate Members permission is required.", flags: MessageFlags.Ephemeral });
        }
        const changed = resolveTradeDispute(interaction.guildId, id, interaction.user.id);
        return interaction.reply({ content: changed ? `✅ Report case **#${id}** resolved.` : `❌ Open report case **#${id}** was not found.`, flags: MessageFlags.Ephemeral });
      }

      const row = db.prepare("SELECT id,reporter,target,kind,reason,evidence,status,created_at,resolved_at FROM trade_disputes WHERE guild=? AND id=?")
        .get(String(interaction.guildId), id);
      if (!row) return interaction.reply({ content: "❌ Report case not found.", flags: MessageFlags.Ephemeral });
      const staff = interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
      if (row.reporter !== interaction.user.id && !staff) return interaction.reply({ content: "❌ You can only view your own report cases.", flags: MessageFlags.Ephemeral });
      const embed = new EmbedBuilder()
        .setTitle(`${row.kind === "scam" ? "🚨 Scam Report" : "⚖️ Trade Dispute"} #${row.id}`)
        .setDescription(row.reason)
        .addFields(
          { name: "Against", value: `<@${row.target}>`, inline: true },
          { name: "Status", value: row.status.toUpperCase(), inline: true },
          { name: "Opened", value: `<t:${Math.floor(row.created_at / 1000)}:R>`, inline: true },
        );
      if (row.evidence) embed.addFields({ name: "Evidence / Reference", value: row.evidence.slice(0, 1024) });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error("[REPORT]", error);
      return interaction.reply({ content: `❌ ${error.message || "Report command failed."}`, flags: MessageFlags.Ephemeral });
    }
  },
};
