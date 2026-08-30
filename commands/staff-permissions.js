const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} = require("discord.js");

// Exact elevated server-wide permissions for staff roles.
// Normal chat/voice access is inherited from @everyone and channel/category overwrites.
// Intentionally NEVER granted here: Administrator, ManageGuild, ManageRoles,
// ManageChannels or ManageWebhooks.
const STAFF_ROLES = {
  doorhand: {
    label: "Doorhand",
    env: "STAFF_ROLE_DOORHAND",
    aliases: ["Doorhand", "Doorhand (Junior Moderator)"],
    permissions: [
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
    ],
  },
  moderator: {
    label: "Moderator",
    env: "STAFF_ROLE_MODERATOR",
    aliases: ["Moderator"],
    permissions: [
      "ViewAuditLog",
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
    ],
  },
  "senior-moderator": {
    label: "Senior Moderator",
    env: "STAFF_ROLE_SENIOR_MODERATOR",
    aliases: ["Senior Moderator"],
    permissions: [
      "ViewAuditLog",
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
      "KickMembers",
      "ManageNicknames",
    ],
  },
  innkeeper: {
    label: "Innkeeper",
    env: "STAFF_ROLE_INNKEEPER",
    aliases: ["Innkeeper", "Innkeeper (Administrator)"],
    permissions: [
      "ViewAuditLog",
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
      "KickMembers",
      "BanMembers",
      "ManageNicknames",
      "ManageEvents",
    ],
  },
  "high-innkeeper": {
    label: "High Innkeeper",
    env: "STAFF_ROLE_HIGH_INNKEEPER",
    aliases: ["High Innkeeper", "High Innkeeper (Senior Administrator)"],
    permissions: [
      "ViewAuditLog",
      "ManageMessages",
      "ManageThreads",
      "ModerateMembers",
      "KickMembers",
      "BanMembers",
      "ManageNicknames",
      "ManageEvents",
    ],
  },
  treasurer: {
    label: "Treasurer",
    env: "STAFF_ROLE_TREASURER",
    aliases: ["Treasurer"],
    permissions: [],
  },
};

const NEVER_ALLOWED = new Set([
  "Administrator",
  "ManageGuild",
  "ManageRoles",
  "ManageChannels",
  "ManageWebhooks",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isAdministrator(interaction) {
  return Boolean(interaction.memberPermissions?.has(PermissionFlagsBits.Administrator));
}

function resolveRole(guild, config) {
  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const role = guild.roles.cache.get(configuredId);
    if (!role) return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
    return { role, source: config.env };
  }

  const wanted = new Set(config.aliases.map(normalize));
  const matches = guild.roles.cache.filter((role) => wanted.has(normalize(role.name)));

  if (matches.size === 1) return { role: matches.first(), source: "name" };
  if (matches.size > 1) return { error: `${config.label}: multiple matching roles found (${matches.map((r) => r.name).join(", ")})` };
  return { error: `${config.label}: role not found. Set ${config.env} to its Discord role ID.` };
}

function buildTargetPermissions(config) {
  for (const name of config.permissions) {
    if (NEVER_ALLOWED.has(name)) {
      throw new Error(`${config.label} permission profile contains forbidden permission ${name}.`);
    }
    if (PermissionFlagsBits[name] === undefined) {
      throw new Error(`${config.label} permission profile contains unknown Discord permission ${name}.`);
    }
  }
  return new PermissionsBitField(config.permissions.map((name) => PermissionFlagsBits[name]));
}

function prettyPermission(name) {
  const map = {
    ViewAuditLog: "View Audit Log",
    ManageMessages: "Manage Messages",
    ManageThreads: "Manage Threads",
    ModerateMembers: "Timeout Members",
    KickMembers: "Kick Members",
    BanMembers: "Ban Members",
    ManageNicknames: "Manage Nicknames",
    ManageEvents: "Manage Events",
  };
  return map[name] || name;
}

function permissionNames(bits) {
  return Object.entries(PermissionFlagsBits)
    .filter(([, bit]) => bits.has(bit))
    .map(([name]) => name)
    .sort();
}

async function buildRolePlan(interaction) {
  await interaction.guild.roles.fetch();

  const rows = [];
  const errors = [];

  for (const [key, config] of Object.entries(STAFF_ROLES)) {
    const resolved = resolveRole(interaction.guild, config);
    if (resolved.error) {
      errors.push(resolved.error);
      continue;
    }

    const target = buildTargetPermissions(config);
    const currentNames = permissionNames(resolved.role.permissions);
    const targetNames = permissionNames(target);

    rows.push({
      key,
      config,
      role: resolved.role,
      target,
      currentNames,
      targetNames,
      editable: resolved.role.editable,
      changed: resolved.role.permissions.bitfield !== target.bitfield,
    });
  }

  return { rows, errors };
}

function profileText(config) {
  if (!config.permissions.length) return "No elevated server-wide permissions";
  return config.permissions.map((name) => `• ${prettyPermission(name)}`).join("\n");
}

async function preview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const plan = await buildRolePlan(interaction);

  const embed = new EmbedBuilder()
    .setTitle("🔐 Staff Role Permissions Preview")
    .setDescription([
      "This changes **staff roles only**.",
      "",
      "🚫 Never granted to these roles:",
      "`Administrator` • `Manage Server` • `Manage Roles` • `Manage Channels` • `Manage Webhooks`",
      "",
      "**Kick Members starts at Senior Moderator.**",
      "**Ban Members starts at Innkeeper.**",
      "",
      ...(plan.errors.length ? ["⚠️ **Role resolution issues**", ...plan.errors.map((x) => `• ${x}`)] : []),
    ].join("\n").slice(0, 4000));

  for (const row of plan.rows) {
    const current = row.currentNames.length
      ? row.currentNames.map(prettyPermission).join(", ")
      : "None";
    const target = row.config.permissions.length
      ? row.config.permissions.map(prettyPermission).join(", ")
      : "None";

    embed.addFields({
      name: `${row.changed ? "🟡" : "✅"} ${row.config.label} • ${row.role.name}`,
      value: [
        `**Target:** ${target}`,
        `**Current:** ${current}`,
        `**Editable by bot:** ${row.editable ? "Yes" : "No"}`,
      ].join("\n").slice(0, 1024),
    });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function apply(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const plan = await buildRolePlan(interaction);

  if (plan.errors.length) {
    return interaction.editReply({
      content: `❌ No permissions were changed because some staff roles could not be resolved.\n${plan.errors.map((x) => `• ${x}`).join("\n")}`.slice(0, 1900),
    });
  }

  const uneditable = plan.rows.filter((row) => !row.editable);
  if (uneditable.length) {
    return interaction.editReply({
      content: `❌ No permissions were changed because the bot cannot edit: ${uneditable.map((row) => row.role.name).join(", ")}. Move the bot role above those staff roles first.`.slice(0, 1900),
    });
  }

  const results = [];
  let changed = 0;
  let unchanged = 0;

  for (const row of plan.rows) {
    if (!row.changed) {
      unchanged += 1;
      results.push(`☑️ **${row.config.label}** — already correct`);
      continue;
    }

    await row.role.setPermissions(
      row.target,
      `Staff permission profile applied by ${interaction.user.username} (${interaction.user.id})`,
    );
    changed += 1;
    results.push(`✅ **${row.config.label}** — ${row.config.permissions.length ? row.config.permissions.map(prettyPermission).join(", ") : "no elevated server-wide permissions"}`);
  }

  return interaction.editReply({
    content: [
      "## 🔐 Staff role permissions updated",
      `✅ Changed: **${changed}**`,
      `☑️ Already correct: **${unchanged}**`,
      "",
      ...results,
      "",
      "🚫 Administrator, Manage Server, Manage Roles, Manage Channels and Manage Webhooks are not granted by this command.",
    ].join("\n").slice(0, 1900),
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-permissions")
    .setDescription("Preview or apply safe server-wide permissions to staff roles")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Show current and proposed permissions without changing anything"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("apply")
        .setDescription("Replace staff role permissions with the approved permission profiles"),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({ content: "❌ This command can only be used in the server.", flags: MessageFlags.Ephemeral });
    }
    if (!isAdministrator(interaction)) {
      return interaction.reply({ content: "❌ Administrator permission is required.", flags: MessageFlags.Ephemeral });
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "preview") return preview(interaction);
      if (subcommand === "apply") return apply(interaction);
      return interaction.reply({ content: "❌ Unknown staff permission action.", flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error("[STAFF PERMISSIONS]", error);
      const payload = { content: `❌ ${error.message || "Staff permission update failed."}`.slice(0, 1900) };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  },
};
