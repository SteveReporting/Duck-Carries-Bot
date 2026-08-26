const { PermissionFlagsBits } = require("discord.js");

const DEPARTMENT_ROLE_SPECS = [
  { name: "Head of Carriers", color: "#D4A24C" },
  { name: "Deputy Head of Carriers", color: "#C28A2C" },
  { name: "Recruitment Lead", color: "#9B6B1F" },
  { name: "Training Lead", color: "#9B6B1F" },
  { name: "Carrier Supervisor", color: "#8A672E" },
  { name: "Carrier Mentor", color: "#7B6542" },
  { name: "Trainee Carrier", color: "#6B6258" },
];

const SEPARATOR_ROLE_SPECS = [
  "━━━ 🍺 TAVERN LEADERSHIP ━━━",
  "━━━ 🛡️ CARRIER MANAGEMENT ━━━",
  "━━━ 🏆 CARRIER PROGRESSION ━━━",
  "━━━ ➕ ADDITIONAL ROLES ━━━",
];

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findRole(guild, name) {
  const wanted = normalizeName(name);
  return guild.roles.cache.find(
    (role) => !role.managed && normalizeName(role.name) === wanted,
  ) || null;
}

async function ensureCarrierDepartmentStartup(client) {
  if (!process.env.GUILD_ID) {
    return {
      created: [],
      separatorsCreated: [],
      traineesAssigned: 0,
      bartendersScanned: 0,
      warnings: ["GUILD_ID is not configured."],
    };
  }

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) {
    return {
      created: [],
      separatorsCreated: [],
      traineesAssigned: 0,
      bartendersScanned: 0,
      warnings: [`Could not access configured guild ${process.env.GUILD_ID}.`],
    };
  }

  await guild.roles.fetch();

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return {
      created: [],
      separatorsCreated: [],
      traineesAssigned: 0,
      bartendersScanned: 0,
      warnings: ["Bot does not have Manage Roles, so Carrier Department startup repair was skipped."],
    };
  }

  const created = [];
  const separatorsCreated = [];
  const warnings = [];
  const roles = new Map();

  for (const spec of DEPARTMENT_ROLE_SPECS) {
    let role = findRole(guild, spec.name);

    if (!role) {
      try {
        role = await guild.roles.create({
          name: spec.name,
          color: spec.color,
          hoist: false,
          mentionable: false,
          permissions: [],
          reason: "Automatic Carrier Department startup repair",
        });
        created.push(role.name);
      } catch (error) {
        warnings.push(`Could not create ${spec.name}: ${error.message}`);
        continue;
      }
    }

    roles.set(spec.name, role);
  }

  // The explicit hierarchy command still controls positioning. Startup only
  // guarantees that the revised separator roles exist; it never moves roles.
  for (const name of SEPARATOR_ROLE_SPECS) {
    if (findRole(guild, name)) continue;

    try {
      const role = await guild.roles.create({
        name,
        permissions: [],
        hoist: false,
        mentionable: false,
        color: 0,
        reason: "Automatic Carrier Department startup repair",
      });
      separatorsCreated.push(role.name);
    } catch (error) {
      warnings.push(`Could not create ${name}: ${error.message}`);
    }
  }

  const traineeRole = roles.get("Trainee Carrier") || findRole(guild, "Trainee Carrier");
  const bartenderRole = findRole(guild, "Bartender");

  if (!traineeRole) {
    warnings.push("Trainee Carrier role is unavailable, so no trainees were assigned.");
    return { created, separatorsCreated, traineesAssigned: 0, bartendersScanned: 0, warnings };
  }

  if (!bartenderRole) {
    warnings.push("Bartender role was not found, so no existing Bartenders were assumed to be trainees.");
    return { created, separatorsCreated, traineesAssigned: 0, bartendersScanned: 0, warnings };
  }

  if (botMember.roles.highest.comparePositionTo(traineeRole) <= 0) {
    warnings.push("Trainee Carrier is above the bot role, so the bot cannot assign it. Move the bot role above Trainee Carrier.");
    return {
      created,
      separatorsCreated,
      traineesAssigned: 0,
      bartendersScanned: bartenderRole.members.size,
      warnings,
    };
  }

  // Do NOT request a full GuildMembers opcode-8 fetch here. Other Tavern startup
  // services already maintain the member cache, and forcing another full fetch on
  // every restart can be rate-limited for ~30 seconds and stall this repair. The
  // cached Bartender set is migrated immediately instead.
  const bartenders = [...bartenderRole.members.values()].filter((member) => !member.user?.bot);
  let traineesAssigned = 0;

  for (const member of bartenders) {
    if (member.roles.cache.has(traineeRole.id)) continue;

    try {
      await member.roles.add(
        traineeRole,
        "Automatic Carrier Department migration: existing Bartender treated as Trainee Carrier",
      );
      traineesAssigned += 1;
    } catch (error) {
      warnings.push(`Could not add Trainee Carrier to ${member.user?.tag || member.id}: ${error.message}`);
    }
  }

  return {
    created,
    separatorsCreated,
    traineesAssigned,
    bartendersScanned: bartenders.length,
    warnings,
  };
}

module.exports = {
  DEPARTMENT_ROLE_SPECS,
  SEPARATOR_ROLE_SPECS,
  ensureCarrierDepartmentStartup,
};
