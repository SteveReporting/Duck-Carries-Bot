const { PermissionFlagsBits } = require("discord.js");

const ROLE_SPECS = Object.freeze([
  {
    key: "owner",
    name: "👑・Server Owner",
    aliases: ["Server Owner", "Guild Owner"],
    permissions: [PermissionFlagsBits.Administrator],
    hoist: true,
  },
  {
    key: "administrator",
    name: "🧠・Administrator",
    aliases: ["Administrator", "Admin"],
    permissions: [PermissionFlagsBits.Administrator],
    hoist: true,
  },
  {
    key: "security",
    name: "🔐・Security",
    aliases: ["Security", "Security Team"],
    permissions: [
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers,
    ],
    hoist: true,
  },
  {
    key: "moderator",
    name: "🛡️・Moderator",
    aliases: ["Moderator", "Mod"],
    permissions: [
      PermissionFlagsBits.ViewAuditLog,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageThreads,
      PermissionFlagsBits.ManageNicknames,
      PermissionFlagsBits.KickMembers,
      PermissionFlagsBits.BanMembers,
      PermissionFlagsBits.ModerateMembers,
    ],
    hoist: true,
  },
  {
    key: "staff",
    name: "🛡️・Staff",
    aliases: ["Tavern Staff", "🛡️・Tavern Staff", "Staff"],
    permissions: [],
    hoist: true,
  },
  { key: "leadership_separator", name: "━━━ 🍺 CARRIER LEADERSHIP ━━━", permissions: [], hoist: false },
  { key: "head_carriers", name: "Head of Carriers", permissions: [], hoist: true },
  { key: "deputy_head_carriers", name: "Deputy Head of Carriers", permissions: [], hoist: true },
  { key: "management_separator", name: "━━━ 🛡️ CARRIER MANAGEMENT ━━━", permissions: [], hoist: false },
  { key: "recruitment_lead", name: "Recruitment Lead", permissions: [], hoist: true },
  { key: "training_lead", name: "Training Lead", permissions: [], hoist: true },
  { key: "carrier_supervisor", name: "Carrier Supervisor", permissions: [], hoist: true },
  { key: "carrier_mentor", name: "Carrier Mentor", permissions: [], hoist: true },
  { key: "progression_separator", name: "━━━ 🏆 CARRIER PROGRESSION ━━━", permissions: [], hoist: false },
  { key: "master_tap", name: "Master of the Tap", permissions: [], hoist: true },
  { key: "brewmaster", name: "Brewmaster", permissions: [], hoist: true },
  { key: "tapmaster", name: "Tapmaster", permissions: [], hoist: true },
  { key: "caskkeeper", name: "Caskkeeper", permissions: [], hoist: true },
  { key: "bartender", name: "Bartender", permissions: [], hoist: true },
  { key: "barback", name: "Barback", permissions: [], hoist: true },
  { key: "carrier_team", name: "Carrier Team", permissions: [], hoist: true },
  { key: "carrier", name: "🍺・Carrier", aliases: ["Carrier", "🍺 Carrier"], permissions: [], hoist: true },
  { key: "trainee_carrier", name: "Trainee Carrier", permissions: [], hoist: true },
  { key: "community_separator", name: "━━━ 👥 COMMUNITY ━━━", permissions: [], hoist: false },
  { key: "verified", name: "✅・Verified", aliases: ["Verified", "Traveller"], permissions: [], hoist: false },
  { key: "member", name: "👤・Member", aliases: ["Member"], permissions: [], hoist: false },
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function roleMatches(role, spec) {
  const names = [spec.name, ...(spec.aliases || [])].map(normalize);
  return !role.managed && names.includes(normalize(role.name));
}

function suppliedRoleFor(spec, supplied = {}) {
  if (spec.key === "staff" && supplied.staffRole?.guild?.id) return supplied.staffRole;
  if (spec.key === "carrier" && supplied.carrierRole?.guild?.id) return supplied.carrierRole;
  return null;
}

async function ensureRole(guild, spec, supplied, reason) {
  let role = suppliedRoleFor(spec, supplied);
  if (role?.guild?.id !== guild.id) role = null;
  if (!role) role = guild.roles.cache.find((item) => roleMatches(item, spec)) || null;

  let created = false;
  if (!role) {
    role = await guild.roles.create({
      name: spec.name,
      permissions: spec.permissions,
      hoist: Boolean(spec.hoist),
      mentionable: false,
      reason,
    });
    created = true;
  }

  const bot = guild.members.me || await guild.members.fetchMe().catch(() => null);
  const editable = Boolean(role.editable && bot?.roles?.highest?.comparePositionTo(role) > 0);
  const warnings = [];

  if (editable) {
    if (role.name !== spec.name) {
      await role.setName(spec.name, reason).catch((error) => warnings.push(`name: ${error.message}`));
    }
    await role.setPermissions(spec.permissions, reason).catch((error) => warnings.push(`permissions: ${error.message}`));
    await role.setHoist(Boolean(spec.hoist), reason).catch((error) => warnings.push(`display: ${error.message}`));
    await role.setMentionable(false, reason).catch(() => {});
  } else if (!created) {
    warnings.push("role is above the bot and could not be fully normalised");
  }

  return { role, created, warnings };
}

async function ensureFullGuildRoles(guild, supplied = {}) {
  await guild.roles.fetch();
  const bot = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!bot?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error("The bot needs Manage Roles to install the full server role hierarchy.");
  }

  const reason = "Complete server role hierarchy installed by /setup";
  const roles = {};
  const resources = [];
  const warnings = [];

  // Create high -> low. Discord inserts new roles near the bottom, so this also
  // produces a sensible relative order on a fresh server without disturbing
  // unrelated pre-existing roles.
  for (const spec of ROLE_SPECS) {
    const result = await ensureRole(guild, spec, supplied, reason);
    roles[spec.key] = result.role;
    resources.push({
      kind: "role",
      name: result.role.name,
      id: result.role.id,
      created: result.created,
    });
    for (const warning of result.warnings) warnings.push(`${result.role.name}: ${warning}`);
  }

  const owner = guild.members.cache.get(guild.ownerId)
    || await guild.members.fetch(guild.ownerId).catch(() => null);
  if (owner && roles.owner?.editable && !owner.roles.cache.has(roles.owner.id)) {
    await owner.roles.add(roles.owner, reason).catch((error) => {
      warnings.push(`Could not assign Server Owner role: ${error.message}`);
    });
  }

  return {
    roles,
    resources,
    warnings,
    trustedSecurityRoleIds: [
      roles.owner?.id,
      roles.administrator?.id,
      roles.security?.id,
    ].filter(Boolean),
    staffAccessRoleIds: [
      roles.owner?.id,
      roles.administrator?.id,
      roles.security?.id,
      roles.moderator?.id,
      roles.staff?.id,
    ].filter(Boolean),
    carrierAccessRoleIds: [
      roles.owner?.id,
      roles.administrator?.id,
      roles.staff?.id,
      roles.head_carriers?.id,
      roles.deputy_head_carriers?.id,
      roles.recruitment_lead?.id,
      roles.training_lead?.id,
      roles.carrier_supervisor?.id,
      roles.carrier_mentor?.id,
      roles.carrier?.id,
      roles.carrier_team?.id,
    ].filter(Boolean),
  };
}

function serialiseRoleMap(roles) {
  return JSON.stringify(Object.fromEntries(
    Object.entries(roles || {})
      .filter(([, role]) => role?.id)
      .map(([key, role]) => [key, role.id]),
  ));
}

module.exports = {
  ROLE_SPECS,
  ensureFullGuildRoles,
  serialiseRoleMap,
};
