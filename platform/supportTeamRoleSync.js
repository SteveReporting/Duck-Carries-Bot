const STAFF_ROLE_ENV_KEYS = [
  "STAFF_BASE_ROLE_ID",
  "STAFF_TRIAL_ROLE_ID",
  "STAFF_ROLE_HIGH_INNKEEPER",
  "STAFF_ROLE_INNKEEPER",
  "STAFF_ROLE_SENIOR_MODERATOR",
  "STAFF_ROLE_MODERATOR",
  "STAFF_ROLE_DOORHAND",
  "STAFF_ROLE_TREASURER",
  "STAFF_COMPANY_AMERICAS_ROLE_ID",
  "STAFF_COMPANY_EUROPE_ASIA_ROLE_ID",
];

const STAFF_ROLE_NAMES = new Set([
  "staff",
  "tavernstaff",
  "staffteam",
  "trialstaff",
  "stafftrial",
  "highinnkeeper",
  "highinnkeepersenioradministrator",
  "senioradministrator",
  "innkeeper",
  "innkeeperadministrator",
  "seniormoderator",
  "seniormod",
  "srmoderator",
  "srmod",
  "moderator",
  "staffmoderator",
  "doorhand",
  "doorhandjuniormoderator",
  "juniormoderator",
  "treasurer",
  "stafftreasurer",
  "americas",
  "americascompany",
  "europeasia",
  "europeasiacompany",
]);

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function findSupportTeamRole(guild) {
  return guild.roles.cache.find((role) =>
    !role.managed && normalize(role.name) === "supportteam",
  ) || null;
}

function configuredStaffRoleIds(guild) {
  const ids = new Set();
  for (const key of STAFF_ROLE_ENV_KEYS) {
    const id = String(process.env[key] || "").trim();
    if (id && guild.roles.cache.has(id)) ids.add(id);
  }
  return ids;
}

function isStaffMember(member, configuredIds = null) {
  if (!member || member.user?.bot) return false;
  if (member.guild?.ownerId === member.id) return true;

  const envIds = configuredIds || configuredStaffRoleIds(member.guild);
  for (const role of member.roles.cache.values()) {
    if (envIds.has(role.id)) return true;
    if (STAFF_ROLE_NAMES.has(normalize(role.name))) return true;
  }

  return false;
}

async function syncSupportTeamMember(member, supportRole = null, configuredIds = null) {
  if (!member?.guild || member.user?.bot) return { changed: false, reason: "not-member" };

  const role = supportRole || findSupportTeamRole(member.guild);
  if (!role) return { changed: false, reason: "support-role-missing" };
  if (!isStaffMember(member, configuredIds)) return { changed: false, reason: "not-staff" };
  if (member.roles.cache.has(role.id)) return { changed: false, reason: "already-assigned" };

  await member.roles.add(role, "Automatic Support Team access for Tavern staff");
  return { changed: true, reason: "assigned" };
}

async function syncAllSupportTeam(guild) {
  await guild.roles.fetch();
  await guild.members.fetch();

  const supportRole = findSupportTeamRole(guild);
  if (!supportRole) {
    return { supportRole: null, staff: 0, assigned: 0, already: 0, failed: 0 };
  }

  const configuredIds = configuredStaffRoleIds(guild);
  let staff = 0;
  let assigned = 0;
  let already = 0;
  let failed = 0;

  for (const member of guild.members.cache.values()) {
    if (!isStaffMember(member, configuredIds)) continue;
    staff += 1;

    if (member.roles.cache.has(supportRole.id)) {
      already += 1;
      continue;
    }

    try {
      await member.roles.add(supportRole, "Automatic Support Team access for Tavern staff");
      assigned += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[SUPPORT TEAM] Could not add ${supportRole.name} to ${member.user?.username || member.id}: ${error.message}`);
    }
  }

  return { supportRole, staff, assigned, already, failed };
}

module.exports = {
  findSupportTeamRole,
  isStaffMember,
  syncSupportTeamMember,
  syncAllSupportTeam,
};
