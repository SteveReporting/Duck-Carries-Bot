const ADDITIONAL_SEPARATOR_NAME = "━━━ ➕ ADDITIONAL ROLES ━━━";
const CARRIER_PROGRESSION_SEPARATOR_NAME = "━━━ 🏆 CARRIER PROGRESSION ━━━";

const CARRIER_ROLE_NAMES = new Set([
  "carrierteam",
  "traineecarrier",
  "barback",
  "bartender",
  "caskkeeper",
  "tapmaster",
  "brewmaster",
  "masterofthetap",
]);

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

function memberHasCarrierRole(member) {
  return member.roles.cache.some((role) => CARRIER_ROLE_NAMES.has(normalizeName(role.name)));
}

async function ensureMemberSeparatorRoles(member, reason = "Automatic Carrier separator role sync") {
  const guild = member.guild;
  const botMember = guild.members.me;
  const additional = findRole(guild, ADDITIONAL_SEPARATOR_NAME);
  const progression = findRole(guild, CARRIER_PROGRESSION_SEPARATOR_NAME);

  const result = {
    additionalAdded: false,
    progressionAdded: false,
    progressionRemoved: false,
    warnings: [],
  };

  if (!botMember) {
    result.warnings.push("Bot guild member is unavailable.");
    return result;
  }

  if (additional) {
    if (botMember.roles.highest.comparePositionTo(additional) <= 0) {
      result.warnings.push(`${ADDITIONAL_SEPARATOR_NAME} is at or above the bot role.`);
    } else if (!member.roles.cache.has(additional.id)) {
      try {
        await member.roles.add(additional, reason);
        result.additionalAdded = true;
      } catch (error) {
        result.warnings.push(`Could not add Additional Roles to ${member.user?.tag || member.id}: ${error.message}`);
      }
    }
  } else {
    result.warnings.push(`${ADDITIONAL_SEPARATOR_NAME} does not exist.`);
  }

  const isCarrier = memberHasCarrierRole(member);

  if (progression) {
    if (botMember.roles.highest.comparePositionTo(progression) <= 0) {
      result.warnings.push(`${CARRIER_PROGRESSION_SEPARATOR_NAME} is at or above the bot role.`);
    } else if (isCarrier && !member.roles.cache.has(progression.id)) {
      try {
        await member.roles.add(progression, reason);
        result.progressionAdded = true;
      } catch (error) {
        result.warnings.push(`Could not add Carrier Progression to ${member.user?.tag || member.id}: ${error.message}`);
      }
    } else if (!isCarrier && member.roles.cache.has(progression.id)) {
      try {
        await member.roles.remove(progression, reason);
        result.progressionRemoved = true;
      } catch (error) {
        result.warnings.push(`Could not remove Carrier Progression from ${member.user?.tag || member.id}: ${error.message}`);
      }
    }
  } else {
    result.warnings.push(`${CARRIER_PROGRESSION_SEPARATOR_NAME} does not exist.`);
  }

  return result;
}

async function listAllMembersRest(guild) {
  const members = new Map();
  let after;

  while (true) {
    const page = await guild.members.list({
      limit: 1000,
      after,
      cache: true,
    });

    for (const [id, member] of page) members.set(id, member);
    if (page.size < 1000) break;

    after = [...page.keys()].at(-1);
    if (!after) break;
  }

  return [...members.values()];
}

async function syncSeparatorMembershipForMembers(members, reason) {
  const summary = {
    scanned: 0,
    additionalAdded: 0,
    progressionAdded: 0,
    progressionRemoved: 0,
    warnings: [],
  };

  const list = [...members];
  const concurrency = 8;

  for (let index = 0; index < list.length; index += concurrency) {
    const chunk = list.slice(index, index + concurrency);
    const results = await Promise.all(
      chunk.map((member) => ensureMemberSeparatorRoles(member, reason)),
    );

    for (const result of results) {
      summary.scanned += 1;
      if (result.additionalAdded) summary.additionalAdded += 1;
      if (result.progressionAdded) summary.progressionAdded += 1;
      if (result.progressionRemoved) summary.progressionRemoved += 1;
      summary.warnings.push(...result.warnings);
    }
  }

  return summary;
}

let fullBackfillStarted = false;

function startCarrierSeparatorMembership(client) {
  if (fullBackfillStarted) return;
  fullBackfillStarted = true;

  const run = async () => {
    const guildId = process.env.GUILD_ID;
    if (!guildId) return;

    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) {
      console.warn(`[CARRIER SEPARATORS] Could not access configured guild ${guildId}.`);
      return;
    }

    await guild.roles.fetch().catch(() => null);

    try {
      const members = await listAllMembersRest(guild);
      const summary = await syncSeparatorMembershipForMembers(
        members,
        "Automatic Carrier separator membership backfill",
      );

      console.log(
        `✅ [CARRIER SEPARATORS] Backfill complete: ${summary.scanned} member(s) checked, ${summary.additionalAdded} given Additional Roles, ${summary.progressionAdded} carrier(s) given Carrier Progression, ${summary.progressionRemoved} stale Carrier Progression role(s) removed.`,
      );

      for (const warning of summary.warnings.slice(0, 10)) {
        console.warn(`[CARRIER SEPARATORS] ${warning}`);
      }
      if (summary.warnings.length > 10) {
        console.warn(`[CARRIER SEPARATORS] +${summary.warnings.length - 10} more warning(s).`);
      }
    } catch (error) {
      console.warn(`[CARRIER SEPARATORS] Full membership backfill failed: ${error.message}`);
    }
  };

  const timer = setTimeout(() => void run(), 2500);
  timer.unref?.();
}

module.exports = {
  ADDITIONAL_SEPARATOR_NAME,
  CARRIER_PROGRESSION_SEPARATOR_NAME,
  memberHasCarrierRole,
  ensureMemberSeparatorRoles,
  startCarrierSeparatorMembership,
};
