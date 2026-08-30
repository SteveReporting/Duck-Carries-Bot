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
    aliases: ["High Innkeeper", "High Innkeeper (Senior Administrator)"],
  },
  innkeeper: {
    label: "Innkeeper",
    env: "STAFF_ROLE_INNKEEPER",
    aliases: ["Innkeeper", "Innkeeper (Administrator)"],
  },
  "senior-moderator": {
    label: "Senior Moderator",
    env: "STAFF_ROLE_SENIOR_MODERATOR",
    aliases: ["Senior Moderator"],
  },
  moderator: {
    label: "Moderator",
    env: "STAFF_ROLE_MODERATOR",
    aliases: ["Moderator"],
  },
  doorhand: {
    label: "Doorhand",
    env: "STAFF_ROLE_DOORHAND",
    aliases: ["Doorhand", "Doorhand (Junior Moderator)"],
  },
  treasurer: {
    label: "Treasurer",
    env: "STAFF_ROLE_TREASURER",
    aliases: ["Treasurer"],
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

function roleCandidatesByAlias(guild, aliases) {
  const wanted = new Set(aliases.map(normalize).filter(Boolean));
  return guild.roles.cache.filter((role) => wanted.has(normalize(role.name)));
}

function resolveRole(guild, config, { optional = false } = {}) {
  const configuredId = String(process.env[config.env] || "").trim();
  if (configuredId) {
    const byId = guild.roles.cache.get(configuredId);
    if (byId) return { role: byId, source: config.env };
    return { error: `${config.label}: ${config.env} points to missing role ${configuredId}` };
  }

  const candidates = roleCandidatesByAlias(guild, config.aliases);
  if (candidates.size === 1) {
    return { role: candidates.first(), source: "name" };
  }
  if (candidates.size > 1) {
    return { error: `${config.label}: multiple matching roles found (${candidates.map((r) => r.name).join(", ")})` };
  }
  if (optional) return { role: null, source: "not-configured" };
  return { error: `${config.label}: role not found. Set ${config.env} to its Discord role ID.` };
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

async function buildPlan(interaction) {
  const guild = interaction.guild;
  await guild.roles.fetch();
  await guild.members.fetch();

  const roleMap = new Map();
  const roleErrors = [];

  for (const [key, config] of Object.entries(POSITION_CONFIG)) {
    const resolved = resolveRole(guild, config);
    if (resolved.error) roleErrors.push(resolved.error);
    else roleMap.set(key, resolved.role);
  }

  const sharedRoles = [];
  for (const config of OPTIONAL_SHARED_ROLES) {
    const resolved = resolveRole(guild, config, { optional: true });
    if (resolved.error) roleErrors.push(resolved.error);
    else if (resolved.role) sharedRoles.push(resolved.role);
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

    matched.push({
      ...entry,
      positionLabel,
      member: candidates.first(),
      positionRole,
    });
  }

  return { roleMap, sharedRoles, roleErrors, matched, missing, ambiguous };
}

function planLines(plan) {
  const lines = [];
  for (const item of plan.matched) {
    const status = item.positionRole ? "✅" : "⚠️";
    lines.push(`${status} ${item.member} — **${item.positionLabel}**${item.positionRole ? ` → ${item.positionRole}` : " (role unresolved)"}`);
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
    return `${role ? "✅" : "❌"} ${config.label}: ${role || "not resolved"}`;
  }).join("\n");

  const sharedSummary = plan.sharedRoles.length
    ? plan.sharedRoles.map((role) => `✅ Shared: ${role}`).join("\n")
    : "ℹ️ No optional Staff/Trial shared role detected. Position roles will still be assigned.";

  const first = new EmbedBuilder()
    .setTitle("🍺 Staff Onboarding Preview")
    .setDescription([
      `**Accepted roster:** ${FINAL_ROSTER.length}`,
      `**Matched:** ${plan.matched.length}`,
      `**Missing:** ${plan.missing.length}`,
      `**Ambiguous:** ${plan.ambiguous.length}`,
      "",
      roleSummary,
      sharedSummary,
      ...(plan.roleErrors.length ? ["", "**Role issues**", ...plan.roleErrors.map((x) => `• ${x}`)] : []),
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
      content: `❌ Staff roles are not fully configured, so nothing was changed.\n${plan.roleErrors.map((x) => `• ${x}`).join("\n")}`.slice(0, 1900),
    });
  }

  const results = [];
  let success = 0;
  let unchanged = 0;
  let failed = 0;

  for (const item of plan.matched) {
    const desiredRoles = [item.positionRole, ...plan.sharedRoles].filter(Boolean);
    const missingRoles = desiredRoles.filter((role) => !item.member.roles.cache.has(role.id));

    if (missingRoles.length === 0) {
      unchanged += 1;
      results.push(`☑️ ${item.member} — **${item.positionLabel}** already assigned`);
      continue;
    }

    try {
      await item.member.roles.add(
        missingRoles,
        `Staff application onboarding by ${interaction.user.username} (${interaction.user.id})`,
      );
      success += 1;
      results.push(`✅ ${item.member} — **${item.positionLabel}** (+${missingRoles.map((r) => r.name).join(", ")})`);
    } catch (error) {
      failed += 1;
      results.push(`❌ ${item.member} — **${item.positionLabel}** — ${error.message || "role assignment failed"}`);
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
      "## 🍺 Staff onboarding complete",
      `✅ Updated: **${success}**`,
      `☑️ Already correct: **${unchanged}**`,
      `❌ Failed: **${failed}**`,
      `❓ Missing: **${plan.missing.length}**`,
      `⚠️ Ambiguous: **${plan.ambiguous.length}**`,
      "",
      "The command only **adds** staff roles. It never removes existing roles or edits channel permissions.",
    ].join("\n"),
  });

  for (const chunk of chunkLines(results, 1800)) {
    await interaction.followUp({ content: chunk, flags: MessageFlags.Ephemeral });
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("staff-onboard")
    .setDescription("Preview or apply the accepted staff application roster")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((subcommand) =>
      subcommand
        .setName("preview")
        .setDescription("Check accepted applicants and role mappings without changing anything"),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("apply")
        .setDescription("Give the accepted applicants their assigned staff roles"),
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
