const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { installFullGuild, BRAND } = require("../platform/fullGuildSetup");
const { ensureRequestOnlyExperience } = require("../platform/requestChannelExperience");

function uiStatus(result) {
  return result.ok ? `✅ ${result.name}` : `⚠️ ${result.name}`;
}

function resourceSummary(resources, kind, max = 10) {
  const rows = resources.filter((item) => item.kind === kind);
  if (!rows.length) return "—";
  const shown = rows.slice(0, max)
    .map((item) => `${item.created ? "🆕" : "✅"} ${item.name}`);
  if (rows.length > max) shown.push(`… +${rows.length - max} more`);
  return shown.join("\n").slice(0, 1024);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Install or repair the complete server platform, roles and security")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName("queue")
        .setDescription("Reuse an existing carry queue channel")
        .addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((option) =>
      option
        .setName("completed")
        .setDescription("Reuse an existing completed-carries channel")
        .addChannelTypes(ChannelType.GuildText),
    )
    .addRoleOption((option) =>
      option
        .setName("carrier_role")
        .setDescription("Reuse an existing Carrier access role"),
    )
    .addRoleOption((option) =>
      option
        .setName("staff_role")
        .setDescription("Reuse an existing Staff access role"),
    ),

  async execute(interaction) {
    if (!interaction.guild) {
      return interaction.reply({
        content: "❌ `/setup` must be used inside a server.",
        flags: MessageFlags.Ephemeral,
      });
    }

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({
        content: "❌ You need **Manage Server** to run `/setup`.",
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply([
      "⚙️ **Installing the entire server platform…**",
      "Roles → carries → Support → Treasury → voice → staff tools → anti-raid → anti-nuke → persistent panels.",
      "Existing resources are repaired/reused instead of blindly duplicated.",
    ].join("\n"));

    try {
      const result = await installFullGuild({
        guild: interaction.guild,
        userId: interaction.user.id,
        client: interaction.client,
        provided: {
          queue: interaction.options.getChannel("queue"),
          completed: interaction.options.getChannel("completed"),
          carrierRole: interaction.options.getRole("carrier_role"),
          staffRole: interaction.options.getRole("staff_role"),
        },
      });

      // Always finish setup with one clean member-facing carry entry point.
      // This deliberately replaces the older multi-control request panel.
      const requestExperience = await ensureRequestOnlyExperience(interaction.guild);
      result.config = requestExperience.config;
      result.resources = result.resources.filter((item) => item.id !== requestExperience.channel.id);
      result.resources.push({
        kind: "channel",
        id: requestExperience.channel.id,
        name: requestExperience.channel.name,
        created: requestExperience.created,
      });
      result.ui = result.ui.filter((item) => item.name !== "Dedicated Request Carry panel");
      result.ui.push({ name: "Dedicated Request-only Carry panel", ok: true });

      const failedUi = result.ui.filter((item) => !item.ok);
      const identityWarning = !result.identity?.ok;
      const allWarnings = [
        ...(identityWarning
          ? [`Server nickname: ${result.identity?.error || "Discord refused the nickname change."}`]
          : []),
        ...failedUi.map((item) => `${item.name}: ${item.error || "could not initialize"}`),
        ...(result.warnings || []),
      ];
      const hasWarnings = allWarnings.length > 0;
      const roleCount = result.resources.filter((item) => item.kind === "role").length;
      const securityChannelCount = result.resources.filter((item) => item.kind === "security").length;

      const embed = new EmbedBuilder()
        .setColor(hasWarnings ? BRAND.gold : BRAND.green)
        .setAuthor({
          name: `${interaction.guild.name} • FULL SERVER INSTALLER`.toUpperCase(),
          ...(interaction.guild.iconURL() ? { iconURL: interaction.guild.iconURL({ size: 128 }) } : {}),
        })
        .setTitle(hasWarnings ? "⚠️ Full setup completed with warnings" : "✅ Entire server platform installed")
        .setDescription([
          `🤖 Bot identity: **${result.identity?.nickname || `${interaction.guild.name} Bot`}**`,
          "",
          `⚔️ **Request a Carry:** <#${result.config.request_channel_id}>`,
          `📡 **Live Queue:** <#${result.config.queue_channel_id}>`,
          `✅ **Completed:** <#${result.config.completed_channel_id}>`,
          `🏠 **Server Hub:** <#${result.config.home_channel_id}>`,
          "",
          "The request channel is now intentionally one-purpose: one button starts the guided request flow. Queue browsing and Carrier tools stay completely separate.",
        ].join("\n"))
        .addFields(
          {
            name: "🧱 Server Structure",
            value: resourceSummary(result.resources, "category", 12),
            inline: true,
          },
          {
            name: "💬 Main Channels",
            value: resourceSummary(result.resources, "channel", 12),
            inline: true,
          },
          {
            name: `🪪 Role Hierarchy • ${roleCount}`,
            value: resourceSummary(result.resources, "role", 12),
            inline: true,
          },
          {
            name: `🔐 Security • ${securityChannelCount} channels`,
            value: [
              "Anti-raid + anti-nuke",
              "Unauthorized bot/webhook protection",
              "Privilege escalation detection",
              "Spam/scam/NSFW analysis",
              "Honeypot + incident reports",
              "Automatic snapshots + restoration",
            ].map((line) => `✅ ${line}`).join("\n"),
            inline: false,
          },
          {
            name: "⚙️ Systems Installed",
            value: [
              "One-purpose carry request channel • scalable grouped queue • private carry tickets • ready checks • verified progress",
              "Waiting VC • session VCs • drop-ins • Carrier Desk • Carrier hierarchy • leaderboard area",
              "Support desk • staff dashboard • Staff Operations Hub • Tavern Pulse • self-heal workers",
              "Treasury borrow/donate/trust • gold donations • live stock • Marketplace • completed-carry board",
            ].join("\n"),
            inline: false,
          },
          {
            name: "✨ Setup Verification",
            value: result.ui.map(uiStatus).join("\n").slice(0, 1024),
            inline: false,
          },
        )
        .setFooter({ text: `Guild ${interaction.guild.id} • /setup is repairable and safe to re-run` })
        .setTimestamp();

      if (allWarnings.length) {
        embed.addFields({
          name: "Warnings",
          value: allWarnings
            .slice(0, 10)
            .map((warning) => `• ${String(warning).slice(0, 180)}`)
            .join("\n")
            .slice(0, 1024),
          inline: false,
        });
      }

      return interaction.editReply({ content: "", embeds: [embed] });
    } catch (error) {
      console.error("[FULL SETUP]", error);
      return interaction.editReply({
        content: [
          "❌ **Full setup stopped safely.**",
          error.message || "Unknown setup error",
          "",
          "Nothing existing was deleted. Give the bot the missing permission shown above and run `/setup` again.",
        ].join("\n"),
        embeds: [],
      });
    }
  },
};
