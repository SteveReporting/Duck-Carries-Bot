const { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require("discord.js");

const { DUNGEONS } = require("../platform/dungeons");
const {
  clearCarrierPermissions,
  listCarrierPermissions,
  removeCarrierPermission,
  setCarrierPermission,
} = require("../platform/communitySystems");

const DIFFICULTIES = ["*", "Easy", "Medium", "Hard", "Insane", "Insane Hardcore", "Nightmare", "Nightmare Hardcore"];

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

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-admin")
    .setDescription("Manage Carrier dungeon permissions")
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
      .addUserOption((o) => o.setName("user").setDescription("Carrier").setRequired(true))),

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
      if (sub === "list") return listCommand(interaction);
      if (sub === "clear") {
        const target = interaction.options.getUser("user", true);
        const removed = clearCarrierPermissions(interaction.guildId, target.id);
        return interaction.reply({ content: `✅ Cleared **${removed}** permission rule(s) for ${target}. They are unrestricted again.`, flags: MessageFlags.Ephemeral });
      }
      return changeCommand(interaction, sub);
    } catch (error) {
      console.error("[CARRIER ADMIN]", error);
      return interaction.reply({ content: `❌ ${error.message || "Carrier permission update failed."}`, flags: MessageFlags.Ephemeral });
    }
  },
};
