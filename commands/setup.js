const {
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { installGuild, BRAND } = require("../platform/guildInstaller");

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
    .setDescription("Fully install or repair the Tavern platform in this server")
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
    await interaction.editReply("🍺 **Installing the Tavern platform…**\nCreating structure, permissions and every persistent UI. Existing Tavern resources will be reused instead of duplicated.");

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

      const failedUi = result.ui.filter((item) => !item.ok);
      const embed = new EmbedBuilder()
        .setColor(failedUi.length ? BRAND.gold : BRAND.green)
        .setAuthor({
          name: "THE CARRY TAVERN • INSTALLER",
          ...(interaction.guild.iconURL() ? { iconURL: interaction.guild.iconURL({ size: 128 }) } : {}),
        })
        .setTitle(failedUi.length ? "⚠️ Tavern installed with warnings" : "✅ Tavern is fully installed")
        .setDescription([
          `**${interaction.guild.name}** now has the complete Tavern server stack.`,
          "",
          `Open <#${result.config.home_channel_id}> — that is now the main front door for members.`,
          "Re-run `/setup` at any time to repair missing resources or refresh every persistent panel.",
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
            name: "⚙️ Automation enabled",
            value: "Carry queue • grouped claims • private tickets • ready checks • verified progress • Waiting VC • session VCs • drop-ins • Support • staff operations • Treasury • Marketplace • self-heal workers",
            inline: false,
          },
        )
        .setFooter({ text: `Guild ${interaction.guild.id} • /setup is idempotent and safe to re-run` })
        .setTimestamp();

      if (failedUi.length) {
        embed.addFields({
          name: "Warnings",
          value: failedUi
            .map((item) => `• **${item.name}:** ${String(item.error || "could not initialize").slice(0, 160)}`)
            .join("\n")
            .slice(0, 1024),
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
