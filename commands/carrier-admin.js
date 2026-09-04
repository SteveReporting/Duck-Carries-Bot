const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { DUNGEONS } = require("../platform/dungeons");
const {
  clearCarrierPermissions,
  listCarrierPermissions,
  noShowSummary,
  removeCarrierPermission,
  setCarrierPermission,
} = require("../platform/communitySystems");
const carrierDepartment = require("./carrier-department");

const GOLD = 0xf2b705;
const GREEN = 0x2ecc71;
const RED = 0xe74c3c;
const FOOTER = "The Carry Tavern • Carrier Department";

const DIFFICULTIES = ["*", "Easy", "Medium", "Hard", "Insane", "Insane Hardcore", "Nightmare", "Nightmare Hardcore"];
const DEPARTMENT_ROLES = [
  { name: "Head of Carriers", value: "Head of Carriers" },
  { name: "Deputy Head of Carriers", value: "Deputy Head of Carriers" },
  { name: "Recruitment Lead", value: "Recruitment Lead" },
  { name: "Training Lead", value: "Training Lead" },
  { name: "Carrier Supervisor", value: "Carrier Supervisor" },
  { name: "Carrier Mentor", value: "Carrier Mentor" },
  { name: "Trainee Carrier", value: "Trainee Carrier" },
];

function requireStaff(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

function scopeValue(value) {
  const clean = String(value || "*").trim();
  return ["*", "all", "any"].includes(clean.toLowerCase()) ? "*" : clean;
}

function adminActions() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("premium_carrier_desk")
      .setLabel("Carrier Desk")
      .setEmoji("🍻")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("premium_queue_open")
      .setLabel("Live Queue")
      .setEmoji("⚔️")
      .setStyle(ButtonStyle.Secondary),
  );
}

function resultEmbed(title, description, color = GOLD) {
  return new EmbedBuilder()
    .setColor(color)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER ADMIN" })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: FOOTER })
    .setTimestamp();
}

async function listCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const rows = listCarrierPermissions(interaction.guildId, target.id);

  const allowed = rows.filter((row) => row.allowed);
  const denied = rows.filter((row) => !row.allowed);
  const format = (row) => `• **${row.dungeon === "*" ? "All Dungeons" : row.dungeon}**${row.difficulty === "*" ? " • any difficulty" : ` • ${row.difficulty}`}`;

  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER ACCESS" })
    .setTitle(`🛡️ ${target.globalName || target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription(
      rows.length
        ? "Scoped permissions are active. Only matching **ALLOW** rules can be claimed unless a matching **DENY** rule blocks them."
        : "No scoped rules are configured. This Carrier is currently **unrestricted**.",
    )
    .addFields(
      {
        name: `✅ Allowed • ${allowed.length}`,
        value: allowed.length ? allowed.map(format).join("\n").slice(0, 1024) : "No explicit allow rules.",
        inline: false,
      },
      {
        name: `❌ Denied • ${denied.length}`,
        value: denied.length ? denied.map(format).join("\n").slice(0, 1024) : "No explicit deny rules.",
        inline: false,
      },
      { name: "⚙️ Mode", value: rows.length ? "Scoped" : "Unrestricted", inline: true },
      { name: "📋 Rules", value: `**${rows.length}** total`, inline: true },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], components: [adminActions()], flags: MessageFlags.Ephemeral });
}

async function changeCommand(interaction, mode) {
  const target = interaction.options.getUser("user", true);
  const dungeon = scopeValue(interaction.options.getString("dungeon", true));
  const difficulty = scopeValue(interaction.options.getString("difficulty") || "*");

  if (mode === "remove") {
    const changed = removeCarrierPermission(interaction.guildId, target.id, dungeon, difficulty);
    const embed = changed
      ? resultEmbed(
          "✅ Permission Rule Removed",
          `${target} no longer has the matching **${dungeon === "*" ? "all dungeons" : dungeon}**${difficulty === "*" ? " • any difficulty" : ` • ${difficulty}`} rule.`,
          GREEN,
        )
      : resultEmbed("Rule Not Found", "No matching Carrier permission rule existed.", RED);
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const allowed = mode === "allow";
  const scope = setCarrierPermission(
    interaction.guildId,
    target.id,
    dungeon,
    difficulty,
    allowed,
    interaction.user.id,
  );

  const embed = resultEmbed(
    allowed ? "✅ Carrier Scope Allowed" : "❌ Carrier Scope Denied",
    [
      `**Carrier:** ${target}`,
      `**Dungeon:** ${scope.dungeon === "*" ? "All dungeons" : scope.dungeon}`,
      `**Difficulty:** ${scope.difficulty === "*" ? "Any difficulty" : scope.difficulty}`,
      "",
      allowed
        ? "This scope can now be claimed when the Carrier is eligible."
        : "This scope is explicitly blocked for this Carrier.",
    ].join("\n"),
    allowed ? GREEN : RED,
  );

  return interaction.reply({ embeds: [embed], components: [adminActions()], flags: MessageFlags.Ephemeral });
}

async function noShowSummaryCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const summary = noShowSummary(interaction.guildId, target.id, 30);
  const risk = summary.total >= 3 ? "🔴 Review Recommended" : summary.total > 0 ? "🟠 Monitor" : "🟢 Clear";

  const embed = new EmbedBuilder()
    .setColor(summary.total >= 3 ? RED : summary.total > 0 ? GOLD : GREEN)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER SAFETY" })
    .setTitle(`🚫 No-Show Record • ${target.globalName || target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 256 }))
    .setDescription("A 30-day operational signal for staff review. No-show reports are **not automatic punishment**.")
    .addFields(
      { name: "📊 Total", value: `**${summary.total}**`, inline: true },
      { name: "👤 As Requester", value: `**${summary.requester}**`, inline: true },
      { name: "🍻 As Carrier", value: `**${summary.carrier}**`, inline: true },
      { name: "🛡️ Staff Signal", value: risk, inline: false },
    )
    .setFooter({ text: FOOTER })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-admin")
    .setDescription("Carrier Department administration")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((subcommand) => subcommand
      .setName("allow")
      .setDescription("Allow a Carrier dungeon/difficulty scope")
      .addUserOption((option) => option.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((option) => option.setName("dungeon").setDescription("Dungeon or * for all").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("difficulty").setDescription("Difficulty or * for any").setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("deny")
      .setDescription("Explicitly block a Carrier dungeon/difficulty scope")
      .addUserOption((option) => option.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((option) => option.setName("dungeon").setDescription("Dungeon or * for all").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("difficulty").setDescription("Difficulty or * for any").setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("remove")
      .setDescription("Remove one scoped permission rule")
      .addUserOption((option) => option.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((option) => option.setName("dungeon").setDescription("Dungeon or *").setRequired(true).setAutocomplete(true))
      .addStringOption((option) => option.setName("difficulty").setDescription("Difficulty or *").setAutocomplete(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("clear")
      .setDescription("Return a Carrier to unrestricted permissions")
      .addUserOption((option) => option.setName("user").setDescription("Carrier").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("list")
      .setDescription("Open a Carrier’s permission card")
      .addUserOption((option) => option.setName("user").setDescription("Carrier").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("assign")
      .setDescription("Assign a Carrier Department role")
      .addStringOption((option) => option.setName("role").setDescription("Department role").setRequired(true).addChoices(...DEPARTMENT_ROLES))
      .addUserOption((option) => option.setName("member").setDescription("Member to receive the role").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("hierarchy")
      .setDescription("Place the Carrier role block below a chosen role")
      .addRoleOption((option) => option.setName("below").setDescription("Role directly above Head of Carriers").setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName("noshow-summary")
      .setDescription("Open a member’s 30-day no-show safety card")
      .addUserOption((option) => option.setName("user").setDescription("Member to view").setRequired(true))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || "").toLowerCase();

    if (focused.name === "dungeon") {
      const choices = [
        { name: "All dungeons", value: "*" },
        ...DUNGEONS.map((dungeon) => ({ name: dungeon.name, value: dungeon.name })),
      ]
        .filter((choice) => choice.name.toLowerCase().includes(typed) || choice.value === "*")
        .slice(0, 25);
      return interaction.respond(choices);
    }

    if (focused.name === "difficulty") {
      return interaction.respond(
        DIFFICULTIES
          .filter((difficulty) => difficulty.toLowerCase().includes(typed) || difficulty === "*")
          .slice(0, 25)
          .map((difficulty) => ({ name: difficulty === "*" ? "Any difficulty" : difficulty, value: difficulty })),
      );
    }

    return interaction.respond([]);
  },

  async execute(interaction) {
    if (!requireStaff(interaction)) {
      return interaction.reply({ content: "❌ Manage Roles permission is required.", flags: MessageFlags.Ephemeral });
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "assign" || subcommand === "hierarchy") return carrierDepartment.execute(interaction);
      if (subcommand === "noshow-summary") return noShowSummaryCommand(interaction);
      if (subcommand === "list") return listCommand(interaction);

      if (subcommand === "clear") {
        const target = interaction.options.getUser("user", true);
        const removed = clearCarrierPermissions(interaction.guildId, target.id);
        const embed = resultEmbed(
          "✅ Carrier Permissions Reset",
          `${target} is unrestricted again. **${removed}** scoped rule${removed === 1 ? "" : "s"} removed.`,
          GREEN,
        );
        return interaction.reply({ embeds: [embed], components: [adminActions()], flags: MessageFlags.Ephemeral });
      }

      return changeCommand(interaction, subcommand);
    } catch (error) {
      console.error("[CARRIER ADMIN]", error);
      const payload = {
        content: `❌ ${error.message || "Carrier admin update failed."}`,
        embeds: [],
        components: [],
      };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  },
};
