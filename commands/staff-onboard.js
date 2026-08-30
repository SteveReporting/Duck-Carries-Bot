const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const FINAL_ROSTER = [
  { username: "Xx_JTea_xX", position: "high-innkeeper" },
  { username: "swirlyshawn", position: "high-innkeeper" },

  { username: "pbaox4", position: "innkeeper" },
  { username: "resilienttt", position: "innkeeper" },
  { username: "cq4w", position: "innkeeper" },
  { username: ".noctyx.", position: "innkeeper" },

  { username: "csaboh_", position: "senior-moderator" },
  { username: "cedbriick", position: "senior-moderator" },
  { username: ".swattie", position: "senior-moderator" },
  { username: "vi_akame", position: "senior-moderator" },
  { username: "Verexu", position: "senior-moderator" },
  { username: "inkopscentralensaktiebolag", position: "senior-moderator" },
  { username: "RainbowCatplayzagain", position: "senior-moderator" },
  { username: "holospices.", position: "senior-moderator" },

  { username: "dasbonkersa_1", position: "moderator" },
  { username: "Saellies.", position: "moderator" },
  { username: "donification", position: "moderator" },
  { username: "yizzzz69", position: "moderator" },
  { username: "jnxy_xl", position: "moderator" },
  { username: "zenoispro", position: "moderator" },
  { username: "crimordial", position: "moderator" },
  { username: "paxrizz", position: "moderator" },

  { username: "9kaz", position: "doorhand" },
  { username: "hello33368", position: "doorhand" },
  { username: "Dogestrate", position: "doorhand" },

  { username: "aorkza", position: "treasurer" },
  { username: "burgerwall", position: "treasurer" },
];

const POSITION_CONFIG = {
  "high-innkeeper": {
    label: "High Innkeeper",
    env: "STAFF_ROLE_HIGH_INNKEEPER",
    option: "high_innkeeper_role",
    aliases: ["High Innkeeper", "High Innkeeper Senior Administrator", "Senior Administrator"],
  },
  innkeeper: {
    label: "Innkeeper",
    env: "STAFF_ROLE_INNKEEPER",
    option: "innkeeper_role",
    aliases: ["Innkeeper", "Innkeeper Administrator"],
  },
  "senior-moderator": {
    label: "Senior Moderator",
    env: "STAFF_ROLE_SENIOR_MODERATOR",
    option: "senior_moderator_role",
    aliases: ["Senior Moderator", "Senior Mod", "Sr Moderator", "Sr Mod"],
  },
  moderator: {
    label: "Moderator",
    env: "STAFF_ROLE_MODERATOR",
    option: "moderator_role",
    aliases: ["Moderator", "Staff Moderator"],
  },
  doorhand: {
    label: "Doorhand",
    env: "STAFF_ROLE_DOORHAND",
    option: "doorhand_role",
    aliases: ["Doorhand", "Doorhand Junior Moderator", "Junior Moderator"],
  },
  treasurer: {
    label: "Treasurer",
    env: "STAFF_ROLE_TREASURER",
    option: "treasurer_role",
    aliases: ["Treasurer", "Staff Treasurer"],
  },
};

const OPTIONAL_SHARED_ROLES = [
  {
    label: "Staff",
    env: "STAFF_BASE_ROLE_ID",
    aliases: ["Staff", "Tavern Staff", "Staff Team"],
  },
  {
    label: "Trial Staff",
    env: "STAFF_TRIAL_ROLE_ID",
    aliases: ["Trial Staff", "Staff Trial"],
  },
];

const SEPARATOR_CONFIG = {
  staff: {
    label: "Staff separator",
    env: "STAFF_SEPARATOR_ROLE_ID",
    option: "staff_separator_role",
    aliases: ["Staff", "Staff Roles", "Staff Team", "Staff Department"],
    positions: Object.keys(POSITION_CONFIG),
  },
  management: {
    label: "Management separator",
    env: "STAFF_SEPARATOR_MANAGEMENT_ROLE_ID",
    option: "management_separator_role",
    aliases: ["Management", "Management Roles", "Management Team", "Administration"],
    positions: ["high-innkeeper", "innkeeper"],
  },
  moderation: {
    label: "Moderation separator",
    env: "STAFF_SEPARATOR_MODERATION_ROLE_ID",
    option: "moderation_separator_role",
    aliases: ["Moderation", "Moderation Roles", "Moderation Team", "Moderators"],
    positions: ["senior-moderator", "moderator", "doorhand"],
  },
  treasury: {
    label: "Treasury separator",
    env: "STAFF_SEPARATOR_TREASURY_ROLE_ID",
    option: "treasury_separator_role",
    aliases: ["Treasury", "Treasury Roles", "Treasury Team", "Treasury Staff"],
    positions: ["treasurer"],
  },
};

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

function looksLikeSeparatorRole(role) {
  const name = String(role?.name || "");
  if (!name) return false;
  const decorations = name.replace(/[a-z0-9\s]/gi, "");
  return decorations.length >= 3 || /[━─═╔╗╚╝╭╮╰╯┈┉┄┅]/.test(name);
}

function uniqueRoleResult(candidates, config, source) {
  if (candidates.size === 1) return { role: candidates.first(), source };
  if (candidates.size > 1) {
    return {
      error: `${config.label}: multiple matching roles found (${candidates.map((role) => role.name).join(", ")}). Select the exact role in the command.`,
    };
  }
  return null;
}

function roleCandidatesByAlias(guild, aliases, predicate = () => true) {
  const wanted = new Set(aliases.map(normalize).filter(Boolean));
  return guild.roles.cache.filter(
    (role) => role.id !== guild.id && predicate(role) && wanted.has(normalize(role.name)),
  );
}

function fuzzyRoleCandidates(guild, aliases, predicate = () => true) {
  const wanted = aliases.map(normalize).filter((value) => value.length >= 5);
  return guild.roles.cache.filter((role) => {
    if (role.id === guild.id || !predicate(role)) return false;
    const roleName = normalize(role.name);
    if (!roleName) return false;
    return wanted.some((alias) => roleName.includes(alias) || alias.includes(roleName));
  });
}

function resolvePositionRole(guild, config, explicitRole = null) {
  if (explicitRole) return { role: explicitRole, source: "command selection" };

  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const byId = guild.roles.cache.get(configuredId);
    if (byId) return { role: byId, source: config.env };
    return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
  }

  const allowed = (role) => !looksLikeSeparatorRole(role);
  const exact = uniqueRoleResult(roleCandidatesByAlias(guild, config.aliases, allowed), config, "exact name");
  if (exact) return exact;

  const fuzzy = uniqueRoleResult(fuzzyRoleCandidates(guild, config.aliases, allowed), config, "unique name match");
  if (fuzzy) return fuzzy;

  return { error: `${config.label}: role not found. Select ${config.option} in the command or set ${config.env}.` };
}

function resolveOptionalSharedRole(guild, config) {
  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const byId = guild.roles.cache.get(configuredId);
    if (byId) return { role: byId, source: config.env };
    return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
  }

  const candidates = roleCandidatesByAlias(guild, config.aliases, (role) => !looksLikeSeparatorRole(role));
  if (candidates.size === 1) return { role: candidates.first(), source: "name" };
  if (candidates.size > 1) {
    return { error: `${config.label}: multiple matching shared roles found (${candidates.map((role) => role.name).join(", ")})` };
  }
  return { role: null, source: "not-configured" };
}

function resolveSeparatorRole(guild, config, explicitRole = null) {
  if (explicitRole) return { role: explicitRole, source: "command selection" };

  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const byId = guild.roles.cache.get(configuredId);
    if (byId) return { role: byId, source: config.env };
    return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
  }

  const decorated = (role) => looksLikeSeparatorRole(role);
  const exact = uniqueRoleResult(roleCandidatesByAlias(guild, config.aliases, decorated), config, "decorated exact name");
  if (exact) return exact;

  const fuzzy = uniqueRoleResult(fuzzyRoleCandidates(guild, config.aliases, decorated), config, "decorated name match");
  if (fuzzy) return fuzzy;

  return { role: null, source: "not-detected" };
}

function rankSpecificSeparatorApplies(role, position) {
  if (!looksLikeSeparatorRole(role)) return false;
  const name = normalize(role.name);
  if (!name) return false;

  if (name.includes("highinnkeeper") || name.includes("senioradministrator")) {
    return position === "high-innkeeper";
  }
  if (name.includes("innkeeper") || name.includes("administrator")) {
    return position === "innkeeper";
  }
  if ((name.includes("senior") || name.includes("sr")) && (name.includes("moderator") || name.includes("mod"))) {
    return position === "senior-moderator";
  }
  if (name.includes("doorhand") || name.includes("juniormoderator")) {
    return position === "doorhand";
  }
  if (name.includes("treasurer")) {
    return position === "treasurer";
  }

  return false;
}

function autoRankSeparatorRoles(guild, position) {
  return guild.roles.cache.filter((role) => rankSpecificSeparatorApplies(role, position));
}

function memberIdentityValues(member) {
  return [
    member.user?.username,
    member.user?.globalName,
    member.displayName,
    member.nickname,
  ].filter(Boolean);
}

function findExactMembers(guild, applicationUsername) {
  const target = String(applicationUsername || "").trim().toLowerCase();
  const targetNormalized = normalize(target);

  return guild.members.cache.filter((member) => {
    const values = memberIdentityValues(member);
    return values.some((value) => {
      const text = String(value).trim();
      return text.toLowerCase() === target || normalize(text) === targetNormalized;
    });
  });
}

function explicitPositionRole(interaction, config) {
  return interaction.options.getRole(config.option) || null;
}

function explicitSeparatorRole(interaction, config) {
  return interaction.options.getRole(config.option) || null;
}

async function buildPlan(interaction) {
  const guild = interaction.guild;
  await guild.roles.fetch();
  await guild.members.fetch();

  const roleMap = new Map();
  const roleSources = new Map();
  const roleErrors = [];

  for (const [key, config] of Object.entries(POSITION_CONFIG)) {
    const resolved = resolvePositionRole(guild, config, explicitPositionRole(interaction, config));
    if (resolved.error) roleErrors.push(resolved.error);
    else {
      roleMap.set(key, resolved.role);
      roleSources.set(key, resolved.source);
    }
  }

  const sharedRoles = [];
  const sharedIssues = [];
  for (const config of OPTIONAL_SHARED_ROLES) {
    const resolved = resolveOptionalSharedRole(guild, config);
    if (resolved.error) sharedIssues.push(resolved.error);
    else if (resolved.role) sharedRoles.push(resolved.role);
  }

  const separatorMap = new Map();
  const separatorSources = new Map();
  const separatorIssues = [];
  for (const [key, config] of Object.entries(SEPARATOR_CONFIG)) {
    const resolved = resolveSeparatorRole(guild, config, explicitSeparatorRole(interaction, config));
    if (resolved.error) separatorIssues.push(resolved.error);
    else if (resolved.role) {
      separatorMap.set(key, resolved.role);
      separatorSources.set(key, resolved.source);
    }
  }

  const allRecognizedSeparators = new Map();
  for (const role of separatorMap.values()) allRecognizedSeparators.set(role.id, role);
  for (const position of Object.keys(POSITION_CONFIG)) {
    for (const role of autoRankSeparatorRoles(guild, position).values()) {
      allRecognizedSeparators.set(role.id, role);
    }
  }

  const matched = [];
  const missing = [];
  const ambiguous = [];

  for (const entry of FINAL_ROSTER) {
    const candidates = findExactMembers(guild, entry.username);
    const positionRole = roleMap.get(entry.position) || null;
    const positionLabel = POSITION_CONFIG[entry.position]?.label || entry.position;

    if (candidates.size === 0) {
      missing.push({ ...entry, positionLabel });
      continue;
    }
    if (candidates.size > 1) {
      ambiguous.push({
        ...entry,
        positionLabel,
        candidates: candidates.map((member) => `${member.user.username} (${member.id})`),
      });
      continue;
    }

    const desiredSeparators = new Map();
    for (const [key, config] of Object.entries(SEPARATOR_CONFIG)) {
      const role = separatorMap.get(key);
      if (role && config.positions.includes(entry.position)) desiredSeparators.set(role.id, role);
    }
    for (const role of autoRankSeparatorRoles(guild, entry.position).values()) {
      desiredSeparators.set(role.id, role);
    }

    matched.push({
      ...entry,
      positionLabel,
      member: candidates.first(),
      positionRole,
      desiredSeparators: [...desiredSeparators.values()],
    });
  }

  return {
    roleMap,
    roleSources,
    sharedRoles,
    sharedIssues,
    separatorMap,
    separatorSources,
    separatorIssues,
    allRecognizedSeparators: [...allRecognizedSeparators.values()],
    roleErrors,
    matched,
    missing,
    ambiguous,
  };
}

function planLines(plan) {
  const lines = [];
  for (const item of plan.matched) {
    const separatorText = item.desiredSeparators.length
      ? ` | separators: ${item.desiredSeparators.map((role) => role.name).join(", ")}`
      : " | separators: none detected";
    lines.push(`✅ ${item.member} — **${item.positionLabel}** → ${item.positionRole}${separatorText}`);
  }
  for (const item of plan.missing) {
    lines.push(`❓ **${item.username}** — ${item.positionLabel} — member not found`);
  }
  for (const item of plan.ambiguous) {
    lines.push(`⚠️ **${item.username}** — ${item.positionLabel} — ambiguous (${item.candidates.length} matches)`);
  }
  return lines;
}

function chunkLines(lines, max = 3600) {
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > max && current) {
      chunks.push(current);
      current = line;
    } else {
      current += `${current ? "\n" : ""}${line}`;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function preview(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const plan = await buildPlan(interaction);
  const lines = planLines(plan);
  const chunks = chunkLines(lines);

  const roleSummary = Object.entries(POSITION_CONFIG).map(([key, config]) => {
    const role = plan.roleMap.get(key);
    const source = plan.roleSources.get(key);
    return `${role ? "✅" : "❌"} ${config.label}: ${role || "not resolved"}${source ? ` (${source})` : ""}`;
  }).join("\n");

  const sharedSummary = plan.sharedRoles.length
    ? plan.sharedRoles.map((role) => `✅ Shared: ${role}`).join("\n")
    : "ℹ️ No non-separator Staff/Trial shared role detected.";

  const separatorSummary = Object.entries(SEPARATOR_CONFIG).map(([key, config]) => {
    const role = plan.separatorMap.get(key);
    const source = plan.separatorSources.get(key);
    return `${role ? "✅" : "ℹ️"} ${config.label}: ${role || "not detected"}${source ? ` (${source})` : ""}`;
  }).join("\n");

  const first = new EmbedBuilder()
    .setTitle("🍺 Staff Onboarding Repair Preview")
    .setDescription([
      `**Accepted roster:** ${FINAL_ROSTER.length}`,
      `**Matched:** ${plan.matched.length}`,
      `**Missing:** ${plan.missing.length}`,
      `**Ambiguous:** ${plan.ambiguous.length}`,
      "",
      "**Position roles**",
      roleSummary,
      "",
      "**Shared roles**",
      sharedSummary,
      "",
      "**Separator roles**",
      separatorSummary,
      ...(plan.roleErrors.length ? ["", "**Blocking role issues**", ...plan.roleErrors.map((x) => `• ${x}`)] : []),
      ...(plan.sharedIssues.length ? ["", "**Shared-role issues**", ...plan.sharedIssues.map((x) => `• ${x}`)] : []),
      ...(plan.separatorIssues.length ? ["", "**Separator issues**", ...plan.separatorIssues.map((x) => `• ${x}`)] : []),
    ].join("\n").slice(0, 4000));

  await interaction.editReply({ embeds: [first] });
  for (const chunk of chunks) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

async function apply(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const plan = await buildPlan(interaction);

  if (plan.roleErrors.length) {
    return interaction.editReply({
      content: `❌ Staff position roles are not fully resolved, so nothing was changed.\n${plan.roleErrors.map((x) => `• ${x}`).join("\n")}`.slice(0, 1900),
    });
  }

  const allPositionRoles = [...plan.roleMap.values()];
  const results = [];
  let repaired = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of plan.matched) {
    const desiredRoles = new Map();
    desiredRoles.set(item.positionRole.id, item.positionRole);
    for (const role of plan.sharedRoles) desiredRoles.set(role.id, role);
    for (const role of item.desiredSeparators) desiredRoles.set(role.id, role);

    const managedRolePool = new Map();
    for (const role of allPositionRoles) managedRolePool.set(role.id, role);
    for (const role of plan.allRecognizedSeparators) managedRolePool.set(role.id, role);

    const toRemove = [...managedRolePool.values()].filter(
      (role) => item.member.roles.cache.has(role.id) && !desiredRoles.has(role.id),
    );
    const toAdd = [...desiredRoles.values()].filter((role) => !item.member.roles.cache.has(role.id));

    if (toRemove.length === 0 && toAdd.length === 0) {
      unchanged += 1;
      results.push(`☑️ ${item.member} — **${item.positionLabel}** already correct`);
      continue;
    }

    try {
      if (toRemove.length) {
        await item.member.roles.remove(
          toRemove,
          `Staff onboarding rank repair by ${interaction.user.username} (${interaction.user.id})`,
        );
      }
      if (toAdd.length) {
        await item.member.roles.add(
          toAdd,
          `Staff onboarding rank/separator repair by ${interaction.user.username} (${interaction.user.id})`,
        );
      }

      repaired += 1;
      const changes = [];
      if (toRemove.length) changes.push(`removed: ${toRemove.map((role) => role.name).join(", ")}`);
      if (toAdd.length) changes.push(`added: ${toAdd.map((role) => role.name).join(", ")}`);
      results.push(`✅ ${item.member} — **${item.positionLabel}** (${changes.join(" | ")})`);
    } catch (error) {
      failed += 1;
      results.push(`❌ ${item.member} — **${item.positionLabel}** — ${error.message || "role repair failed"}`);
    }
  }

  for (const item of plan.missing) {
    results.push(`❓ **${item.username}** — ${item.positionLabel} — skipped: member not found`);
  }
  for (const item of plan.ambiguous) {
    results.push(`⚠️ **${item.username}** — ${item.positionLabel} — skipped: ambiguous member match`);
  }

  await interaction.editReply({
    content: [
      "## 🍺 Staff onboarding repair complete",
      `✅ Repaired: **${repaired}**`,
      `☑️ Already correct: **${unchanged}**`,
      `❌ Failed: **${failed}**`,
      `❓ Missing: **${plan.missing.length}**`,
      `⚠️ Ambiguous: **${plan.ambiguous.length}**`,
      "",
      "This repair reconciles only the six staff-position roles and recognized staff separator roles. Unrelated member/reward roles are untouched.",
    ].join("\n"),
  });

  for (const chunk of chunkLines(results, 1800)) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

function addRoleSelectors(subcommand) {
  for (const config of Object.values(POSITION_CONFIG)) {
    subcommand.addRoleOption((option) =>
      option
        .setName(config.option)
        .setDescription(`Exact ${config.label} role (use if auto-detection is wrong)`)
        .setRequired(false),
    );
  }

  for (const config of Object.values(SEPARATOR_CONFIG)) {
    subcommand.addRoleOption((option) =>
      option
        .setName(config.option)
        .setDescription(`Exact ${config.label} (optional; decorated roles are auto-detected)`)
        .setRequired(false),
    );
  }

  return subcommand;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-onboard")
    .setDescription("Preview or repair the accepted staff application roster")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addRoleSelectors(
        subcommand
          .setName("preview")
          .setDescription("Check final ranks and separator mappings without changing anything"),
      ),
    )
    .addSubcommand((subcommand) =>
      addRoleSelectors(
        subcommand
          .setName("apply")
          .setDescription("Repair accepted staff ranks and assign required separator roles"),
      ),
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
      return interaction.reply({ content: "❌ Unknown staff onboarding action.", flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error("[STAFF ONBOARD]", error);
      const payload = { content: `❌ ${error.message || "Staff onboarding failed."}`.slice(0, 1900) };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  },
};
