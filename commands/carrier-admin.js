const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

const { DUNGEONS } = require("../platform/dungeons");
const {
  clearCarrierPermissions,
  listCarrierPermissions,
  noShowSummary,
  removeCarrierPermission,
  setCarrierPermission,
} = require("../platform/communitySystems");
const carrierDepartment = require("./carrier-department");

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
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function scopeValue(value) {
  const clean = String(value || "*").trim();
  return ["*", "all", "any"].includes(clean.toLowerCase()) ? "*" : clean;
}

async function listCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const rows = listCarrierPermissions(interaction.guildId, target.id);
  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Carrier Permissions • ${target.username}`)
    .setDescription(rows.length
      ? rows.map((row) => `${row.allowed ? "✅ ALLOW" : "❌ DENY"} • **${row.dungeon}**${row.difficulty === "*" ? " • any difficulty" : ` • ${row.difficulty}`}`).join("\n").slice(0, 4000)
      : "No scoped permissions are configured. This Carrier is currently **unrestricted**.")
    .setFooter({ text: "Once at least one scope exists, non-matching dungeons are blocked by default." });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function changeCommand(interaction, mode) {
  const target = interaction.options.getUser("user", true);
  const dungeon = scopeValue(interaction.options.getString("dungeon", true));
  const difficulty = scopeValue(interaction.options.getString("difficulty") || "*");

  if (mode === "remove") {
    const changed = removeCarrierPermission(interaction.guildId, target.id, dungeon, difficulty);
    return interaction.reply({ content: changed ? `✅ Removed that permission rule for ${target}.` : "❌ No matching permission rule existed.", flags: MessageFlags.Ephemeral });
  }

  const allowed = mode === "allow";
  const scope = setCarrierPermission(interaction.guildId, target.id, dungeon, difficulty, allowed, interaction.user.id);
  return interaction.reply({
    content: `${allowed ? "✅ Allowed" : "❌ Denied"} ${target} for **${scope.dungeon === "*" ? "all dungeons" : scope.dungeon}**${scope.difficulty === "*" ? " at any difficulty" : ` • ${scope.difficulty}`}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function noShowSummaryCommand(interaction) {
  const target = interaction.options.getUser("user", true);
  const summary = noShowSummary(interaction.guildId, target.id, 30);
  const embed = new EmbedBuilder()
    .setTitle(`🚫 No-Show Record • ${target.username}`)
    .setThumbnail(target.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: "Total (30d)", value: String(summary.total), inline: true },
      { name: "As Requester", value: String(summary.requester), inline: true },
      { name: "As Carrier", value: String(summary.carrier), inline: true },
    )
    .setFooter({ text: "No-show reports are staff safety signals, not automatic punishment." });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-admin")
    .setDescription("Carrier staff controls")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((s) => s.setName("allow").setDescription("Allow a Carrier dungeon/difficulty scope")
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon or * for all").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty or * for any").setAutocomplete(true)))
    .addSubcommand((s) => s.setName("deny").setDescription("Explicitly deny a Carrier dungeon/difficulty scope")
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon or * for all").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty or * for any").setAutocomplete(true)))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove one permission rule")
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true))
      .addStringOption((o) => o.setName("dungeon").setDescription("Dungeon or *").setRequired(true).setAutocomplete(true))
      .addStringOption((o) => o.setName("difficulty").setDescription("Difficulty or *").setAutocomplete(true)))
    .addSubcommand((s) => s.setName("clear").setDescription("Clear every scoped permission for a Carrier")
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true)))
    .addSubcommand((s) => s.setName("list").setDescription("View a Carrier's dungeon permissions")
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true)))
    .addSubcommand((s) => s.setName("assign").setDescription("Assign a Carrier Department role")
      .addStringOption((o) => o.setName("role").setDescription("Department role").setRequired(true).addChoices(...DEPARTMENT_ROLES))
      .addUserOption((o) => o.setName("member").setDescription("Member to receive the role").setRequired(true)))
    .addSubcommand((s) => s.setName("hierarchy").setDescription("Place the Carrier role block below a chosen role")
      .addRoleOption((o) => o.setName("below").setDescription("Role directly above Head of Carriers").setRequired(true)))
    .addSubcommand((s) => s.setName("noshow-summary").setDescription("View a member's 30-day carry no-show record")
      .addUserOption((o) => o.setName("user").setDescription("Member to view").setRequired(true))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const typed = String(focused.value || "").toLowerCase();
    if (focused.name === "dungeon") {
      const choices = [{ name: "All dungeons", value: "*" }, ...DUNGEONS.map((d) => ({ name: d.name, value: d.name }))]
        .filter((choice) => choice.name.toLowerCase().includes(typed) || choice.value === "*")
        .slice(0, 25);
      return interaction.respond(choices);
    }
    if (focused.name === "difficulty") {
      return interaction.respond(DIFFICULTIES.filter((d) => d.toLowerCase().includes(typed) || d === "*").slice(0, 25).map((d) => ({ name: d === "*" ? "Any difficulty" : d, value: d })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    if (!requireStaff(interaction)) return interaction.reply({ content: "❌ Manage Roles permission is required.", flags: MessageFlags.Ephemeral });
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "assign" || sub === "hierarchy") return carrierDepartment.execute(interaction);
      if (sub === "noshow-summary") return noShowSummaryCommand(interaction);
      if (sub === "list") return listCommand(interaction);
      if (sub === "clear") {
        const target = interaction.options.getUser("user", true);
        const removed = clearCarrierPermissions(interaction.guildId, target.id);
        return interaction.reply({ content: `✅ Cleared **${removed}** permission rule(s) for ${target}. They are unrestricted again.`, flags: MessageFlags.Ephemeral });
      }
      return changeCommand(interaction, sub);
    } catch (error) {
      console.error("[CARRIER ADMIN]", error);
      if (interaction.deferred || interaction.replied) return interaction.editReply({ content: `❌ ${error.message || "Carrier admin update failed."}` });
      return interaction.reply({ content: `❌ ${error.message || "Carrier admin update failed."}`, flags: MessageFlags.Ephemeral });
    }
  },
};
