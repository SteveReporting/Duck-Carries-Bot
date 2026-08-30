const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const FINAL_ROSTER = [
  { username: "Xx_JTea_xX", position: "high-innkeeper", timezone: "EST", company: "americas" },
  { username: "swirlyshawn", position: "high-innkeeper", timezone: "GMT+8", company: "europe-asia" },

  { username: "pbaox4", position: "innkeeper", timezone: "EST", company: "americas" },
  { username: "resilienttt", position: "innkeeper", timezone: "GMT+3", company: "europe-asia" },
  { username: "cq4w", position: "innkeeper", timezone: "EST", company: "americas" },
  { username: ".noctyx.", position: "innkeeper", timezone: "GMT+1", company: "europe-asia" },

  { username: "csaboh_", position: "senior-moderator", timezone: "UTC+1/2", company: "europe-asia" },
  { username: "cedbriick", position: "senior-moderator", timezone: "CET", company: "europe-asia" },
  { username: ".swattie", position: "senior-moderator", timezone: "GMT+2", company: "europe-asia" },
  { username: "vi_akame", position: "senior-moderator", timezone: "GMT+7", company: "europe-asia" },
  { username: "Verexu", position: "senior-moderator", timezone: "EET", company: "europe-asia" },
  { username: "inkopscentralensaktiebolag", position: "senior-moderator", timezone: "CEST", company: "europe-asia" },
  { username: "RainbowCatplayzagain", position: "senior-moderator", timezone: "GMT-5", company: "americas" },
  { username: "holospices.", position: "senior-moderator", timezone: "GMT+8", company: "europe-asia" },

  { username: "dasbonkersa_1", position: "moderator", timezone: "AEST", company: "europe-asia" },
  { username: "Saellies.", position: "moderator", timezone: "GMT+1", company: "europe-asia" },
  { username: "donification", position: "moderator", timezone: "EST", company: "americas" },
  { username: "yizzzz69", position: "moderator", timezone: "GMT+8", company: "europe-asia" },
  { username: "jnxy_xl", position: "moderator", timezone: "GMT+8", company: "europe-asia" },
  { username: "zenoispro", position: "moderator", timezone: "GMT+1", company: "europe-asia" },
  { username: "crimordial", position: "moderator", timezone: "PST", company: "americas" },
  { username: "paxrizz", position: "moderator", timezone: "EST", company: "americas" },

  { username: "9kaz", position: "doorhand", timezone: "EDT", company: "americas" },
  { username: "hello33368", position: "doorhand", timezone: "GMT+2", company: "europe-asia" },
  { username: "Dogestrate", position: "doorhand", timezone: "GMT", company: "europe-asia" },

  { username: "aorkza", position: "treasurer", timezone: "UTC+1", company: "europe-asia" },
  { username: "burgerwall", position: "treasurer", timezone: "EST-4", company: "americas" },
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

const COMPANY_CONFIG = {
  americas: {
    label: "🛡️ Americas",
    roleName: "🛡️ Americas",
    env: "STAFF_COMPANY_AMERICAS_ROLE_ID",
    option: "americas_role",
    aliases: ["Americas", "Americas Company", "Western Company"],
  },
  "europe-asia": {
    label: "🌍 Europe & Asia",
    roleName: "🌍 Europe & Asia",
    env: "STAFF_COMPANY_EUROPE_ASIA_ROLE_ID",
    option: "europe_asia_role",
    aliases: ["Europe & Asia", "Europe Asia", "Europe / Asia", "Europe Asia Company", "Eastern Company"],
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
      error: `${config.label}: multiple matching roles found (${candidates.map((role) => role.name).join(", ")}). Select the exact role in the command if you want that rank repaired.`,
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
    const name = normalize(role.name);
    return name && wanted.some((alias) => name.includes(alias) || alias.includes(name));
  });
}

function resolveConfiguredOrNamedRole(guild, config, explicit = null, predicate = () => true) {
  if (explicit) return { role: explicit, source: "command selection" };

  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const role = guild.roles.cache.get(configuredId);
    if (role) return { role, source: config.env };
    return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
  }

  const exact = uniqueRoleResult(roleCandidatesByAlias(guild, config.aliases, predicate), config, "exact name");
  if (exact) return exact;

  const fuzzy = uniqueRoleResult(fuzzyRoleCandidates(guild, config.aliases, predicate), config, "unique name match");
  if (fuzzy) return fuzzy;

  return { role: null, source: "not-detected" };
}

function resolvePositionRole(guild, config, explicit = null) {
  return resolveConfiguredOrNamedRole(
    guild,
    config,
    explicit,
    (role) => !looksLikeSeparatorRole(role),
  );
}

function resolveOptionalSharedRole(guild, config) {
  return resolveConfiguredOrNamedRole(
    guild,
    config,
    null,
    (role) => !looksLikeSeparatorRole(role),
  );
}

function resolveSeparatorRole(guild, config, explicit = null) {
  return resolveConfiguredOrNamedRole(guild, config, explicit, (role) => looksLikeSeparatorRole(role));
}

function resolveCompanyRole(guild, config, explicit = null) {
  return resolveConfiguredOrNamedRole(guild, config, explicit);
}

function rankSpecificSeparatorApplies(role, position) {
  if (!looksLikeSeparatorRole(role)) return false;
  const name = normalize(role.name);
  if (!name) return false;

  if (name.includes("highinnkeeper") || name.includes("senioradministrator")) return position === "high-innkeeper";
  if (name.includes("innkeeper") || name.includes("administrator")) return position === "innkeeper";
  if ((name.includes("senior") || name.includes("sr")) && (name.includes("moderator") || name.includes("mod"))) {
    return position === "senior-moderator";
  }
  if (name.includes("doorhand") || name.includes("juniormoderator")) return position === "doorhand";
  if (name.includes("treasurer")) return position === "treasurer";
  return false;
}

function autoRankSeparatorRoles(guild, position) {
  return guild.roles.cache.filter((role) => rankSpecificSeparatorApplies(role, position));
}

function memberIdentityValues(member) {
  return [member.user?.username, member.user?.globalName, member.displayName, member.nickname].filter(Boolean);
}

function findExactMembers(guild, username) {
  const target = String(username || "").trim().toLowerCase();
  const targetNormalized = normalize(target);
  return guild.members.cache.filter((member) =>
    memberIdentityValues(member).some((value) => {
      const text = String(value).trim();
      return text.toLowerCase() === target || normalize(text) === targetNormalized;
    }),
  );
}

function selectedRole(interaction, optionName) {
  return interaction.options.getRole(optionName) || null;
}

async function buildPlan(interaction) {
  const guild = interaction.guild;
  await guild.roles.fetch();
  await guild.members.fetch();

  const supportTeamRole = selectedRole(interaction, "support_team_role");
  const ticketSupportRole = selectedRole(interaction, "ticket_support_role");

  const roleMap = new Map();
  const roleSources = new Map();
  const roleErrors = [];
  for (const [key, config] of Object.entries(POSITION_CONFIG)) {
    const resolved = resolvePositionRole(guild, config, selectedRole(interaction, config.option));
    if (resolved.error) {
      roleErrors.push(resolved.error);
      roleSources.set(key, "unresolved — rank left untouched");
    } else if (resolved.role) {
      roleMap.set(key, resolved.role);
      roleSources.set(key, resolved.source);
    } else {
      roleSources.set(key, "not detected — rank left untouched");
    }
  }

  const companyMap = new Map();
  const companySources = new Map();
  const companyIssues = [];
  for (const [key, config] of Object.entries(COMPANY_CONFIG)) {
    const resolved = resolveCompanyRole(guild, config, selectedRole(interaction, config.option));
    if (resolved.error) companyIssues.push(resolved.error);
    else if (resolved.role) {
      companyMap.set(key, resolved.role);
      companySources.set(key, resolved.source);
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
    const resolved = resolveSeparatorRole(guild, config, selectedRole(interaction, config.option));
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
    const companyLabel = COMPANY_CONFIG[entry.company]?.label || entry.company;

    if (!candidates.size) {
      missing.push({ ...entry, positionLabel, companyLabel });
      continue;
    }
    if (candidates.size > 1) {
      ambiguous.push({
        ...entry,
        positionLabel,
        companyLabel,
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
      companyLabel,
      member: candidates.first(),
      positionRole,
      companyRole: companyMap.get(entry.company) || null,
      desiredSeparators: [...desiredSeparators.values()],
    });
  }

  return {
    supportTeamRole,
    ticketSupportRole,
    roleMap,
    roleSources,
    roleErrors,
    companyMap,
    companySources,
    companyIssues,
    sharedRoles,
    sharedIssues,
    separatorMap,
    separatorSources,
    separatorIssues,
    allRecognizedSeparators: [...allRecognizedSeparators.values()],
    matched,
    missing,
    ambiguous,
  };
}

async function ensureCompanyRoles(interaction, plan) {
  for (const [key, config] of Object.entries(COMPANY_CONFIG)) {
    if (plan.companyMap.has(key)) continue;
    const role = await interaction.guild.roles.create({
      name: config.roleName,
      permissions: 0n,
      hoist: false,
      mentionable: false,
      reason: `Staff timezone company created by ${interaction.user.username} (${interaction.user.id})`,
    });
    plan.companyMap.set(key, role);
    plan.companySources.set(key, "created by /staff-onboard apply");
  }

  for (const item of plan.matched) {
    item.companyRole = plan.companyMap.get(item.company) || null;
  }
}

function planLines(plan) {
  const lines = [];
  for (const item of plan.matched) {
    const companyRole = item.companyRole || `*${item.companyLabel} role will be created on apply*`;
    const rankState = item.positionRole ? item.positionRole.toString() : "current rank left untouched";
    const separators = item.desiredSeparators.length
      ? item.desiredSeparators.map((role) => role.name).join(", ")
      : "none detected";
    lines.push(
      `✅ ${item.member} — **${item.positionLabel}** (${rankState}) — **${item.timezone}** — ${companyRole} | separators: ${separators}`,
    );
  }
  for (const item of plan.missing) {
    lines.push(`❓ **${item.username}** — ${item.positionLabel} — ${item.timezone} — ${item.companyLabel} — member not found`);
  }
  for (const item of plan.ambiguous) {
    lines.push(`⚠️ **${item.username}** — ${item.positionLabel} — ${item.companyLabel} — ambiguous (${item.candidates.length} matches)`);
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

  const roleSummary = Object.entries(POSITION_CONFIG).map(([key, config]) => {
    const role = plan.roleMap.get(key);
    const source = plan.roleSources.get(key);
    return `${role ? "✅" : "ℹ️"} ${config.label}: ${role || "not resolved"}${source ? ` (${source})` : ""}`;
  }).join("\n");

  const companySummary = Object.entries(COMPANY_CONFIG).map(([key, config]) => {
    const role = plan.companyMap.get(key);
    const source = plan.companySources.get(key);
    return `${role ? "✅" : "🆕"} ${config.label}: ${role || "will be created on apply"}${source ? ` (${source})` : ""}`;
  }).join("\n");

  const sharedSummary = plan.sharedRoles.length
    ? plan.sharedRoles.map((role) => `✅ Shared: ${role}`).join("\n")
    : "ℹ️ No Staff/Trial shared role detected.";

  const separatorSummary = Object.entries(SEPARATOR_CONFIG).map(([key, config]) => {
    const role = plan.separatorMap.get(key);
    const source = plan.separatorSources.get(key);
    return `${role ? "✅" : "ℹ️"} ${config.label}: ${role || "not detected"}${source ? ` (${source})` : ""}`;
  }).join("\n");

  const first = new EmbedBuilder()
    .setTitle("🍺 Staff Onboarding Preview")
    .setDescription([
      `**Accepted roster:** ${FINAL_ROSTER.length}`,
      `**Matched:** ${plan.matched.length}`,
      `**Missing:** ${plan.missing.length}`,
      `**Ambiguous:** ${plan.ambiguous.length}`,
      "",
      "**Selected access roles — given to ALL matched staff**",
      `✅ Support Team: ${plan.supportTeamRole}`,
      `✅ Ticket Support: ${plan.ticketSupportRole}`,
      "",
      "**Position roles**",
      roleSummary,
      "Unresolved position roles are skipped and the member's current rank is left untouched.",
      "",
      "**Regional companies**",
      companySummary,
      "",
      "**Shared roles**",
      sharedSummary,
      "",
      "**Separator roles**",
      separatorSummary,
      ...(plan.roleErrors.length ? ["", "**Position-role notes (non-blocking)**", ...plan.roleErrors.map((x) => `• ${x}`)] : []),
      ...(plan.companyIssues.length ? ["", "**Company-role issues**", ...plan.companyIssues.map((x) => `• ${x}`)] : []),
      ...(plan.sharedIssues.length ? ["", "**Shared-role issues**", ...plan.sharedIssues.map((x) => `• ${x}`)] : []),
      ...(plan.separatorIssues.length ? ["", "**Separator issues**", ...plan.separatorIssues.map((x) => `• ${x}`)] : []),
    ].join("\n").slice(0, 4000));

  await interaction.editReply({ embeds: [first] });
  for (const chunk of chunkLines(planLines(plan))) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

async function apply(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const plan = await buildPlan(interaction);

  if (plan.companyIssues.length) {
    return interaction.editReply({
      content: [
        "❌ Regional company roles could not be safely resolved, so nothing was changed.",
        ...plan.companyIssues.map((x) => `• ${x}`),
      ].join("\n").slice(0, 1900),
    });
  }

  await ensureCompanyRoles(interaction, plan);

  const allPositionRoles = [...plan.roleMap.values()];
  const allCompanyRoles = [...plan.companyMap.values()];
  const results = [];
  let repaired = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of plan.matched) {
    const desiredRoles = new Map();
    if (item.positionRole) desiredRoles.set(item.positionRole.id, item.positionRole);
    if (item.companyRole) desiredRoles.set(item.companyRole.id, item.companyRole);
    desiredRoles.set(plan.supportTeamRole.id, plan.supportTeamRole);
    desiredRoles.set(plan.ticketSupportRole.id, plan.ticketSupportRole);
    for (const role of plan.sharedRoles) desiredRoles.set(role.id, role);
    for (const role of item.desiredSeparators) desiredRoles.set(role.id, role);

    const managedRolePool = new Map();
    if (item.positionRole) {
      for (const role of allPositionRoles) managedRolePool.set(role.id, role);
    }
    for (const role of allCompanyRoles) managedRolePool.set(role.id, role);
    for (const role of plan.allRecognizedSeparators) managedRolePool.set(role.id, role);

    const toRemove = [...managedRolePool.values()].filter(
      (role) => item.member.roles.cache.has(role.id) && !desiredRoles.has(role.id),
    );
    const toAdd = [...desiredRoles.values()].filter(
      (role) => !item.member.roles.cache.has(role.id),
    );

    if (!toRemove.length && !toAdd.length) {
      unchanged += 1;
      results.push(`☑️ ${item.member} — **${item.positionLabel}** — ${item.companyLabel} already correct`);
      continue;
    }

    try {
      if (toRemove.length) {
        await item.member.roles.remove(
          toRemove,
          `Staff onboarding repair by ${interaction.user.username} (${interaction.user.id})`,
        );
      }
      if (toAdd.length) {
        await item.member.roles.add(
          toAdd,
          `Staff onboarding rank/company/access repair by ${interaction.user.username} (${interaction.user.id})`,
        );
      }

      repaired += 1;
      const changes = [];
      if (toRemove.length) changes.push(`removed: ${toRemove.map((role) => role.name).join(", ")}`);
      if (toAdd.length) changes.push(`added: ${toAdd.map((role) => role.name).join(", ")}`);
      results.push(`✅ ${item.member} — **${item.positionLabel}** — **${item.timezone}** — ${item.companyLabel} (${changes.join(" | ")})`);
    } catch (error) {
      failed += 1;
      results.push(`❌ ${item.member} — **${item.positionLabel}** — ${item.companyLabel} — ${error.message || "role repair failed"}`);
    }
  }

  for (const item of plan.missing) {
    results.push(`❓ **${item.username}** — ${item.positionLabel} — ${item.companyLabel} — skipped: member not found`);
  }
  for (const item of plan.ambiguous) {
    results.push(`⚠️ **${item.username}** — ${item.positionLabel} — ${item.companyLabel} — skipped: ambiguous member match`);
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
      `🎫 Support Team: ${plan.supportTeamRole}`,
      `🛟 Ticket Support: ${plan.ticketSupportRole}`,
      `🛡️ **Americas:** ${FINAL_ROSTER.filter((x) => x.company === "americas").length} staff`,
      `🌍 **Europe & Asia:** ${FINAL_ROSTER.filter((x) => x.company === "europe-asia").length} staff`,
      ...(plan.roleErrors.length ? ["", `ℹ️ ${plan.roleErrors.length} unresolved position role(s) were left untouched.`] : []),
      "",
      "All matched accepted staff received both selected support roles. Unresolved ranks were left untouched.",
    ].join("\n"),
  });

  for (const chunk of chunkLines(results, 1800)) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

function addRoleSelectors(subcommand) {
  // Required first: Discord requires required options before optional options.
  subcommand
    .addRoleOption((option) =>
      option
        .setName("support_team_role")
        .setDescription("Support Team role to give every accepted staff member")
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName("ticket_support_role")
        .setDescription("Ticket Support role to give every accepted staff member")
        .setRequired(true),
    );

  for (const config of Object.values(POSITION_CONFIG)) {
    subcommand.addRoleOption((option) =>
      option
        .setName(config.option)
        .setDescription(`Exact ${config.label} role (optional; leave blank to leave unresolved ranks alone)`)
        .setRequired(false),
    );
  }

  for (const config of Object.values(COMPANY_CONFIG)) {
    subcommand.addRoleOption((option) =>
      option
        .setName(config.option)
        .setDescription(`Exact ${config.label} role (created on apply if missing)`)
        .setRequired(false),
    );
  }

  for (const config of Object.values(SEPARATOR_CONFIG)) {
    subcommand.addRoleOption((option) =>
      option
        .setName(config.option)
        .setDescription(`Exact ${config.label} (decorated roles are also auto-detected)`)
        .setRequired(false),
    );
  }

  return subcommand;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-onboard")
    .setDescription("Preview or repair accepted staff roles and access")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      addRoleSelectors(
        subcommand
          .setName("preview")
          .setDescription("Preview accepted staff ranks, companies, separators and access roles"),
      ),
    )
    .addSubcommand((subcommand) =>
      addRoleSelectors(
        subcommand
          .setName("apply")
          .setDescription("Repair accepted staff roles and give selected support access"),
      ),
    ),

  async execute(interaction) {
    if (!interaction.inGuild()) {
      return interaction.reply({
        content: "❌ This command can only be used in the server.",
        flags: MessageFlags.Ephemeral,
      });
    }
    if (!isAdministrator(interaction)) {
      return interaction.reply({
        content: "❌ Administrator permission is required.",
        flags: MessageFlags.Ephemeral,
      });
    }

    try {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "preview") return preview(interaction);
      if (subcommand === "apply") return apply(interaction);
      return interaction.reply({
        content: "❌ Unknown staff onboarding action.",
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      console.error("[STAFF ONBOARD]", error);
      const payload = {
        content: `❌ ${error.message || "Staff onboarding failed."}`.slice(0, 1900),
      };
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    }
  },
};
