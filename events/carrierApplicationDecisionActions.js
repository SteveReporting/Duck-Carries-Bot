const { MessageFlags, PermissionFlagsBits } = require("discord.js");
const { carrierTeamRoleId } = require("../platform/carrierDirectory");
const { ensureMemberSeparatorRoles } = require("../platform/carrierSeparatorMembership");

const PASS_MARK = 14;
const APPLICATION_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdIT98g11GKA2uJ9iTDGrOIHgK3FNrj-oo94g56JJBws8S-rQ/viewform";
const RECRUITMENT_SOP_URL = "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk";
const TRAINEE_ROLE_NAME = "Trainee Carrier";
const CARRIER_TEAM_ROLE_NAME = "Carrier Team";

const RESOURCE_CHANNEL_NAMES = new Set([
  "carriertraining",
  "training",
  "carrierresources",
  "carrierguides",
  "carrierrules",
  "carrierinfo",
]);

function normalize(value) {
  return String(value || "").trim().toLowerCase().replace(/^@+/, "");
}

function normalizeRole(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function extractDiscordId(value) {
  const text = String(value || "").trim();
  const mention = text.match(/^<@!?(\d{15,22})>$/);
  if (mention) return mention[1];
  const raw = text.match(/^(\d{15,22})$/);
  return raw ? raw[1] : null;
}

function candidateNames(app) {
  return [...new Set([
    app?.discordUsername,
    extractDiscordId(app?.discordUserId) ? null : app?.discordUserId,
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function memberMatches(member, rawCandidate) {
  const candidate = normalize(rawCandidate);
  if (!candidate) return false;

  const values = [
    member?.user?.username,
    member?.user?.globalName,
    member?.user?.tag,
    member?.nickname,
    member?.displayName,
  ]
    .map(normalize)
    .filter(Boolean);

  if (values.includes(candidate)) return true;

  const withoutDiscriminator = candidate.replace(/#\d{4}$/, "");
  return Boolean(withoutDiscriminator) && values.some((value) => value === withoutDiscriminator);
}

async function resolveApplicantMember(guild, app) {
  const idCandidates = [app?.discordUserId, app?.discordUsername]
    .map(extractDiscordId)
    .filter(Boolean);

  for (const id of idCandidates) {
    const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (member) return { member, method: "Discord ID" };
  }

  for (const rawName of candidateNames(app)) {
    const cached = guild.members.cache.find((member) => memberMatches(member, rawName));
    if (cached) return { member: cached, method: `Discord username (${rawName})` };

    const query = String(rawName).trim().replace(/^@+/, "").replace(/#\d{4}$/, "").slice(0, 32);
    if (!query) continue;

    const results = await guild.members.search({ query, limit: 20 }).catch(() => null);
    if (!results) continue;

    const exact = results.find((member) => memberMatches(member, rawName));
    if (exact) return { member: exact, method: `Discord username (${rawName})` };
  }

  return {
    member: null,
    method: null,
    attempted: candidateNames(app).join(", ") || String(app?.discordUserId || "").trim() || "no Discord account supplied",
  };
}

async function loadApplication(applicationId) {
  const url = String(process.env.CARRIER_APPLICATION_API_URL || "").trim();
  const token = String(process.env.CARRIER_APPLICATION_API_TOKEN || "").trim();
  if (!url || !token) throw new Error("Carrier application bridge is not configured.");

  const target = new URL(url);
  target.searchParams.set("action", "get");
  target.searchParams.set("token", token);
  target.searchParams.set("id", applicationId);

  const response = await fetch(target, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Google bridge returned invalid JSON (${response.status}).`); }
  if (!response.ok || !body.ok) throw new Error(body.error || `Google bridge request failed (${response.status}).`);
  return body.application || null;
}

function applicationIdFromInteraction(interaction) {
  const title = interaction.message?.embeds?.[0]?.title || "";
  const match = title.match(/^⚔️\s*(.+?)\s*•/);
  if (match?.[1]) return match[1].trim();

  const rows = interaction.message?.components || [];
  for (const row of rows) {
    for (const component of row.components || []) {
      if (component.customId !== "carrier_review_applicant") continue;
      const selected = component.options?.find((option) => option.default);
      if (selected?.value) return selected.value;
    }
  }
  return null;
}

function scoreOf(app) {
  const n = Number(app?.total);
  return Number.isFinite(n) ? n : null;
}

function isPassDecision(decision) {
  return ["Accept", "Accept / Trial"].includes(decision);
}

function isFailDecision(decision) {
  return decision === "Deny";
}

function findRoleByName(guild, roleName) {
  const wanted = normalizeRole(roleName);
  return guild.roles.cache.find(
    (candidate) => !candidate.managed && normalizeRole(candidate.name) === wanted,
  ) || null;
}

async function addRoleIfPossible(guild, member, role, label) {
  if (!role) return { ok: false, label, reason: `${label} role was not found.` };
  if (member.roles.cache.has(role.id)) return { ok: true, label, alreadyHad: true, role };

  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, label, reason: "Bot does not have Manage Roles." };
  }
  if (!role.editable || me.roles.highest.comparePositionTo(role) <= 0) {
    return { ok: false, label, reason: `Bot role must be above ${label}.` };
  }

  try {
    await member.roles.add(role, `Carrier application accepted — automatic ${label} assignment`);
    return { ok: true, label, alreadyHad: false, role };
  } catch (error) {
    return { ok: false, label, reason: error.message };
  }
}

async function assignAcceptedRoles(guild, member) {
  await guild.roles.fetch().catch(() => null);

  const teamRole = guild.roles.cache.get(carrierTeamRoleId()) || findRoleByName(guild, CARRIER_TEAM_ROLE_NAME);
  const traineeRole = findRoleByName(guild, TRAINEE_ROLE_NAME);

  const results = [];
  results.push(await addRoleIfPossible(guild, member, teamRole, CARRIER_TEAM_ROLE_NAME));
  results.push(await addRoleIfPossible(guild, member, traineeRole, TRAINEE_ROLE_NAME));

  const refreshedMember = await guild.members.fetch(member.id).catch(() => member);
  const separatorResult = await ensureMemberSeparatorRoles(
    refreshedMember,
    "Carrier application accepted — automatic separator role sync",
  ).catch((error) => ({ warnings: [error.message] }));

  return {
    results,
    separatorResult,
  };
}

function resourceChannelMentions(guild) {
  const channels = guild.channels.cache
    .filter((channel) => channel.isTextBased?.() && RESOURCE_CHANNEL_NAMES.has(normalizeRole(channel.name)))
    .map((channel) => `<#${channel.id}>`);
  return [...new Set(channels)].slice(0, 6);
}

function fallbackResultDm(app, decision, guild, roleSummary = null) {
  const score = scoreOf(app);
  const passed = isPassDecision(decision);
  const resourceChannels = resourceChannelMentions(guild);

  const assignedRoles = roleSummary?.results
    ?.filter((result) => result.ok)
    .map((result) => result.label) || [];

  const roleLine = assignedRoles.length
    ? `🎓 **Discord roles:** ${assignedRoles.map((name) => `**${name}**`).join(" + ")}`
    : null;

  const lines = passed
    ? [
        "🍺 **The Carry Tavern — Carrier Team Application Result**",
        "",
        `✅ **Result: PASSED • ${decision}**`,
        score == null ? null : `📊 **Score:** ${score}/20 — pass mark is ${PASS_MARK}/20`,
        roleLine,
        app?.reasoning ? `📝 **Reviewer note:** ${String(app.reasoning).slice(0, 700)}` : null,
        "",
        "### What happens next",
        "1. You are now part of the **Carrier Team** and begin as a **Trainee Carrier**.",
        "2. Read the recruitment/training process before your assessment.",
        "3. Complete training and the practical assessment when Carrier management schedules it.",
        "4. Successful trainees then complete the **7-day probation** before becoming a full Carrier.",
        app?.nextAction ? `5. **Your next action:** ${String(app.nextAction).slice(0, 500)}` : null,
        "",
        "### Documents & resources",
        `📚 **Recruitment / Training Process:** ${RECRUITMENT_SOP_URL}`,
        resourceChannels.length ? `📌 **Carrier channels:** ${resourceChannels.join(" • ")}` : null,
        "",
        "### Important Carrier rule",
        "Official Tavern carries are **100% free**. Never demand Robux, gold, items, gifts or any other payment for an official carry.",
        "",
        "If you are unsure about training, assessment, probation or Carrier procedure, ask Carrier management before running official carries.",
      ]
    : [
        "🍺 **The Carry Tavern — Carrier Team Application Result**",
        "",
        `❌ **Result: NOT PASSED • ${decision}**`,
        score == null ? null : `📊 **Score:** ${score}/20 — pass mark is ${PASS_MARK}/20`,
        app?.reasoning ? `📝 **Reviewer note:** ${String(app.reasoning).slice(0, 700)}` : null,
        app?.nextAction ? `➡️ **Next action:** ${String(app.nextAction).slice(0, 500)}` : null,
        "",
        "Your previous application remains in the staff archive for future review.",
        `📚 **Recruitment Process:** ${RECRUITMENT_SOP_URL}`,
        `📝 **Application Form:** ${APPLICATION_FORM_URL}`,
        "",
        "You can apply again when you are ready and recruitment is accepting applications.",
      ];

  return lines.filter(Boolean).join("\n").slice(0, 1950);
}

async function safeStaffFollowUp(interaction, content) {
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp({ content: content.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
  return interaction.reply({ content: content.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
}

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
    if (!interaction.isStringSelectMenu?.()) return;
    if (interaction.customId !== "carrier_review_decision") return;

    const decision = interaction.values?.[0];
    if (!isPassDecision(decision) && !isFailDecision(decision)) return;

    const applicationId = applicationIdFromInteraction(interaction);
    if (!applicationId) return safeStaffFollowUp(interaction, "⚠️ Could not identify the selected Carrier application.");

    try {
      const app = await loadApplication(applicationId);
      if (!app) return safeStaffFollowUp(interaction, `⚠️ Could not reload application **${applicationId}**.`);

      const resolved = await resolveApplicantMember(interaction.guild, app);
      if (!resolved.member) {
        return safeStaffFollowUp(
          interaction,
          `⚠️ Decision saved, but I could not match the applicant to a Discord member from **${resolved.attempted}**. Ask them for their actual Discord username or user ID, then update/review the application. No role was assigned and no fallback DM was sent.`,
        );
      }

      const notes = [`✅ Matched applicant to <@${resolved.member.id}> using **${resolved.method}**.`];
      let roleSummary = null;

      if (isPassDecision(decision)) {
        roleSummary = await assignAcceptedRoles(interaction.guild, resolved.member);

        for (const roleResult of roleSummary.results) {
          if (roleResult.ok) {
            notes.push(roleResult.alreadyHad
              ? `🎓 They already had **${roleResult.label}**.`
              : `🎓 Assigned **${roleResult.label}** automatically.`);
          } else {
            notes.push(`⚠️ Could not assign **${roleResult.label}**: ${roleResult.reason}`);
          }
        }

        if (roleSummary.separatorResult?.additionalAdded) {
          notes.push("➕ Assigned the Additional Roles separator automatically.");
        }
        if (roleSummary.separatorResult?.progressionAdded) {
          notes.push("🏆 Assigned the Carrier Progression separator automatically.");
        }
        for (const warning of roleSummary.separatorResult?.warnings || []) {
          notes.push(`⚠️ Separator sync: ${warning}`);
        }
      }

      // The main review flow already handles DMs for applications containing a
      // valid numeric Discord ID. This fallback handles username/name submissions
      // so both submission styles receive the same result information.
      const hasValidStoredId = Boolean(extractDiscordId(app.discordUserId));
      if (!hasValidStoredId) {
        try {
          await resolved.member.user.send(fallbackResultDm(app, decision, interaction.guild, roleSummary));
          notes.push("📨 Result DM sent using the resolved Discord username, including next steps and Carrier documents/resources.");
        } catch (error) {
          notes.push(`⚠️ Could not DM them: ${error.message}`);
        }
      }

      return safeStaffFollowUp(interaction, notes.join("\n"));
    } catch (error) {
      console.error("[CARRIER APPLICATION DECISION ACTIONS]", error);
      return safeStaffFollowUp(interaction, `❌ Carrier decision follow-up failed: ${error.message}`);
    }
  },
};
