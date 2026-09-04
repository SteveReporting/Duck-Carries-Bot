const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { installGuild, BRAND } = require("../platform/guildInstaller");
const { finalizeGuildSetup } = require("../platform/setupFinalizer");

function uiStatus(result) {
  return result.ok ? `✅ ${result.name}` : `⚠️ ${result.name}`;
}

function resourceSummary(resources, kind) {
  const rows = resources.filter((item) => item.kind === kind);
  if (!rows.length) return "—";
  return rows
    .map((item) => `${item.created ? "🆕" : "✅"} ${item.name}`)
    .join("\n")
    .slice(0, 1024);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("setup")
    .setDescription("Fully install, brand and repair the Tavern platform in this server")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((option) =>
      option
        .setName("queue")
        .setDescription("Reuse an existing carry queue channel instead of creating one")
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
        .setDescription("Reuse an existing Carrier role"),
    )
    .addRoleOption((option) =>
      option
        .setName("staff_role")
        .setDescription("Reuse an existing staff role"),
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
      "🍺 **Installing the complete Tavern platform…**",
      "Creating/repairing structure, permissions, server branding and every persistent UI.",
      "Existing Tavern resources are reused instead of duplicated.",
    ].join("\n"));

    try {
      const result = await installGuild({
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

      await interaction.editReply([
        "🍺 **Core structure ready. Finishing the install…**",
        "Branding this server, verifying Support, Treasury, live boards and staff operations.",
      ].join("\n"));

      const finalized = await finalizeGuildSetup({
        guild: interaction.guild,
        client: interaction.client,
        config: result.config,
      });

      result.config = finalized.config;
      result.ui = [
        ...result.ui,
        ...finalized.ui.filter((entry) => !result.ui.some((existing) => existing.name === entry.name)),
      ];
      result.identity = finalized.identity;

      const failedUi = result.ui.filter((item) => !item.ok);
      const identityWarning = !result.identity?.ok;
      const hasWarnings = failedUi.length > 0 || identityWarning;

      const embed = new EmbedBuilder()
        .setColor(hasWarnings ? BRAND.gold : BRAND.green)
        .setAuthor({
          name: "THE CARRY TAVERN • FULL INSTALLER",
          ...(interaction.guild.iconURL() ? { iconURL: interaction.guild.iconURL({ size: 128 }) } : {}),
        })
        .setTitle(hasWarnings ? "⚠️ Tavern installed with warnings" : "✅ Tavern is fully installed")
        .setDescription([
          `**${interaction.guild.name}** now has the complete Tavern server stack.`,
          "",
          `🤖 Server identity: **${result.identity?.nickname || `${interaction.guild.name} Bot`}** ${result.identity?.ok ? "✅" : "⚠️"}`,
          `🏠 Member front door: <#${result.config.home_channel_id}>`,
          "",
          "Re-run `/setup` at any time. It repairs missing resources, refreshes panels and re-checks the server configuration without deleting existing data.",
        ].join("\n"))
        .addFields(
          {
            name: `🧱 Structure • ${result.createdCount} created / ${result.reusedCount} reused`,
            value: resourceSummary(result.resources, "category"),
            inline: true,
          },
          {
            name: "💬 Channels",
            value: resourceSummary(result.resources, "channel"),
            inline: true,
          },
          {
            name: "🪪 Roles + Voice",
            value: [resourceSummary(result.resources, "role"), resourceSummary(result.resources, "voice")]
              .filter((value) => value !== "—")
              .join("\n") || "—",
            inline: true,
          },
          {
            name: "✨ Persistent UI stack",
            value: result.ui.map(uiStatus).join("\n").slice(0, 1024),
            inline: false,
          },
          {
            name: "⚙️ Systems wired automatically",
            value: [
              "Carry requests + grouped queue matching",
              "Private carry tickets + ready checks + verified progress",
              "Waiting VC + private session VCs + drop-ins",
              "Support desk + staff ticket dashboard",
              "Treasury borrow/donate/trust + gold donations + live stock",
              "Marketplace access + completed-carry board",
              "Staff Operations Hub + Tavern Pulse + self-heal workers",
            ].join(" • "),
            inline: false,
          },
        )
        .setFooter({ text: `Guild ${interaction.guild.id} • /setup is idempotent and safe to re-run` })
        .setTimestamp();

      const warnings = [];
      if (identityWarning) {
        warnings.push(`• **Server nickname:** ${String(result.identity?.error || "Discord refused the nickname change.").slice(0, 180)}`);
      }
      for (const item of failedUi) {
        warnings.push(`• **${item.name}:** ${String(item.error || "could not initialize").slice(0, 180)}`);
      }
      if (warnings.length) {
        embed.addFields({
          name: "Warnings",
          value: warnings.join("\n").slice(0, 1024),
          inline: false,
        });
      }

      return interaction.editReply({ content: "", embeds: [embed] });
    } catch (error) {
      console.error("[SETUP]", error);
      return interaction.editReply({
        content: `❌ **Setup stopped safely.**\n${error.message || "Unknown setup error"}\n\nNothing existing was deleted. Fix the permission/config issue and run \`/setup\` again.`,
        embeds: [],
      });
    }
  },
};
