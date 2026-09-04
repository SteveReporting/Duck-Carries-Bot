const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const db = require("../database/database");
const {
  maybeSendAbuseAlert,
  recordTradeDispute,
  resolveTradeDispute,
} = require("../platform/communitySystems");

const GOLD = 0xf2b705;
const RED = 0xe74c3c;
const BLUE = 0x3498db;
const GREEN = 0x2ecc71;
const FOOTER = "The Carry Tavern • Case Management";

function kindLabel(kind) {
  return kind === "scam" ? "Scam Report" : "Trade Dispute";
}

function kindEmoji(kind) {
  return kind === "scam" ? "🚨" : "⚖️";
}

function statusLabel(status) {
  const normalized = String(status || "open").toLowerCase();
  if (normalized === "resolved") return "✅ Resolved";
  if (normalized === "closed") return "⚫ Closed";
  return "🟠 Under Review";
}

function caseEmbed({ id, kind, reporterId, targetId, reason, evidence, status = "open", createdAt, resolvedAt, staffView = false }) {
  const embed = new EmbedBuilder()
    .setColor(status === "resolved" ? GREEN : kind === "scam" ? RED : BLUE)
    .setAuthor({ name: "THE CARRY TAVERN • CASE MANAGEMENT" })
    .setTitle(`${kindEmoji(kind)} ${kindLabel(kind)} • #${id}`)
    .setDescription(String(reason || "No reason provided.").slice(0, 4096))
    .addFields(
      { name: "📌 Status", value: statusLabel(status), inline: true },
      { name: "👤 Reported Member", value: targetId ? `<@${targetId}>` : "Unknown", inline: true },
      ...(staffView && reporterId ? [{ name: "📝 Reporter", value: `<@${reporterId}>`, inline: true }] : []),
      ...(createdAt ? [{ name: "🕒 Opened", value: `<t:${Math.floor(Number(createdAt) / 1000)}:R>`, inline: true }] : []),
      ...(resolvedAt ? [{ name: "✅ Resolved", value: `<t:${Math.floor(Number(resolvedAt) / 1000)}:R>`, inline: true }] : []),
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  if (evidence) {
    embed.addFields({
      name: "🔎 Evidence / Reference",
      value: String(evidence).slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

async function sendStaffCase(interaction, id, kind, target, reason, evidence) {
  if (!process.env.MOD_LOG_CHANNEL_ID) return;
  const channel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased?.()) return;

  const embed = caseEmbed({
    id,
    kind,
    reporterId: interaction.user.id,
    targetId: target.id,
    reason,
    evidence,
    status: "open",
    createdAt: Date.now(),
    staffView: true,
  });

  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function createCase(interaction, kind) {
  const target = interaction.options.getUser("user", true);
  if (target.id === interaction.user.id) {
    return interaction.reply({ content: "❌ You cannot open a case against yourself.", flags: MessageFlags.Ephemeral });
  }

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
  await maybeSendAbuseAlert(
    interaction.client,
    interaction.guildId,
    target.id,
    `${kind} report #${id}`,
  ).catch(() => {});

  const embed = caseEmbed({
    id,
    kind,
    reporterId: interaction.user.id,
    targetId: target.id,
    reason,
    evidence,
    status: "open",
    createdAt: Date.now(),
  })
    .setTitle(`✅ ${kindLabel(kind)} Created • #${id}`)
    .setDescription([
      "Your case has been recorded for staff review.",
      "",
      `**Summary:** ${reason}`,
      "",
      "Keep any screenshots, trade IDs or additional evidence available in case staff need more information.",
    ].join("\n").slice(0, 4096));

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Tavern reports, trade disputes and case status")
    .addSubcommand((subcommand) => subcommand
      .setName("scam")
      .setDescription("Report suspected scamming for staff review")
      .addUserOption((option) => option.setName("user").setDescription("Member being reported").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("What happened").setRequired(true).setMaxLength(1500))
      .addStringOption((option) => option.setName("evidence").setDescription("Evidence link, listing ID, trade ID or notes").setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("dispute")
      .setDescription("Open a trade dispute for staff review")
      .addUserOption((option) => option.setName("user").setDescription("Other trader").setRequired(true))
      .addStringOption((option) => option.setName("reason").setDescription("What happened").setRequired(true).setMaxLength(1500))
      .addStringOption((option) => option.setName("evidence").setDescription("Evidence link, listing ID, trade ID or notes").setMaxLength(1000)))
    .addSubcommand((subcommand) => subcommand
      .setName("status")
      .setDescription("Open one of your case cards")
      .addIntegerOption((option) => option.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1)))
    .addSubcommand((subcommand) => subcommand
      .setName("resolve")
      .setDescription("Staff: resolve an open report case")
      .addIntegerOption((option) => option.setName("id").setDescription("Case ID").setRequired(true).setMinValue(1))),

  async execute(interaction) {
    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "scam" || subcommand === "dispute") {
        return createCase(interaction, subcommand);
      }

      const id = interaction.options.getInteger("id", true);
      if (subcommand === "resolve") {
        if (
          !interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) &&
          !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)
        ) {
          return interaction.reply({ content: "❌ Moderate Members permission is required.", flags: MessageFlags.Ephemeral });
        }

        const changed = resolveTradeDispute(interaction.guildId, id, interaction.user.id);
        const embed = new EmbedBuilder()
          .setColor(changed ? GREEN : RED)
          .setAuthor({ name: "THE CARRY TAVERN • CASE MANAGEMENT" })
          .setTitle(changed ? `✅ Case #${id} Resolved` : `❌ Case #${id} Not Found`)
          .setDescription(changed
            ? `Case **#${id}** is now resolved and the action has been attributed to ${interaction.user}.`
            : "No matching open case was found.")
          .setFooter({ text: FOOTER })
          .setTimestamp();

        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      const row = db.prepare(
        "SELECT id,reporter,target,kind,reason,evidence,status,created_at,resolved_at FROM trade_disputes WHERE guild=? AND id=?",
      ).get(String(interaction.guildId), id);

      if (!row) {
        return interaction.reply({ content: "❌ Report case not found.", flags: MessageFlags.Ephemeral });
      }

      const staff =
        interaction.memberPermissions?.has(PermissionFlagsBits.ModerateMembers) ||
        interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);

      if (row.reporter !== interaction.user.id && !staff) {
        return interaction.reply({ content: "❌ You can only view your own report cases.", flags: MessageFlags.Ephemeral });
      }

      return interaction.reply({
        embeds: [caseEmbed({
          id: row.id,
          kind: row.kind,
          reporterId: row.reporter,
          targetId: row.target,
          reason: row.reason,
          evidence: row.evidence,
          status: row.status,
          createdAt: row.created_at,
          resolvedAt: row.resolved_at,
          staffView: Boolean(staff),
        })],
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("[REPORT]", error);
      const message = `❌ ${error.message || "Report command failed."}`;
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply({ content: message, embeds: [], components: [] }).catch(() => {});
      }
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },
};
