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
    return { created: [], traineesAssigned: 0, warnings: ["GUILD_ID is not configured."] };
  }

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) {
    return {
      created: [],
      traineesAssigned: 0,
      warnings: [`Could not access configured guild ${process.env.GUILD_ID}.`],
    };
  }

  await guild.roles.fetch();

  const botMember = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!botMember?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return {
      created: [],
      traineesAssigned: 0,
      warnings: ["Bot does not have Manage Roles, so Carrier Department startup repair was skipped."],
    };
  }

  const created = [];
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

  const traineeRole = roles.get("Trainee Carrier") || findRole(guild, "Trainee Carrier");
  const bartenderRole = findRole(guild, "Bartender");

  if (!traineeRole) {
    warnings.push("Trainee Carrier role is unavailable, so no trainees were assigned.");
    return { created, traineesAssigned: 0, warnings };
  }

  if (!bartenderRole) {
    warnings.push("Bartender role was not found, so no existing Bartenders were assumed to be trainees.");
    return { created, traineesAssigned: 0, warnings };
  }

  if (botMember.roles.highest.comparePositionTo(traineeRole) <= 0) {
    warnings.push("Trainee Carrier is above the bot role, so the bot cannot assign it. Move the bot role above Trainee Carrier.");
    return { created, traineesAssigned: 0, warnings };
  }

  try {
    await guild.members.fetch();
  } catch (error) {
    warnings.push(`Could not fetch all guild members before trainee migration: ${error.message}`);
  }

  let traineesAssigned = 0;
  for (const member of bartenderRole.members.values()) {
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

  return { created, traineesAssigned, warnings };
}

module.exports = {
  DEPARTMENT_ROLE_SPECS,
  ensureCarrierDepartmentStartup,
};
