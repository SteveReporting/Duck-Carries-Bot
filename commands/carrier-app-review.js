const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const GOLD = 0xF2B705;
const PASS_MARK = 14;
const APPLICATION_FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdIT98g11GKA2uJ9iTDGrOIHgK3FNrj-oo94g56JJBws8S-rQ/viewform";
const RECRUITMENT_SOP_URL = "https://docs.google.com/document/d/1eJublVgllteB_6IcAiqTxNcGUenG9m8J0FiPGJzUd7M/edit?usp=drivesdk";
const ALLOWED_ROLES = new Set([
  "headofcarriers",
  "deputyheadofcarriers",
  "recruitmentlead",
  "carriersupervisor",
]);

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function canReview(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return interaction.member?.roles?.cache?.some((role) => ALLOWED_ROLES.has(normalize(role.name))) || false;
}

function apiConfig() {
  const url = String(process.env.CARRIER_APPLICATION_API_URL || "").trim();
  const token = String(process.env.CARRIER_APPLICATION_API_TOKEN || "").trim();
  if (!url || !token) {
    throw new Error("Carrier application bridge is not configured. Set CARRIER_APPLICATION_API_URL and CARRIER_APPLICATION_API_TOKEN on the bot.");
  }
  return { url, token };
}

async function apiGet(action, params = {}) {
  const { url, token } = apiConfig();
  const target = new URL(url);
  target.searchParams.set("action", action);
  target.searchParams.set("token", token);
  for (const [key, value] of Object.entries(params)) {
    if (value != null) target.searchParams.set(key, String(value));
  }
  const response = await fetch(target, { headers: { accept: "application/json" } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Google bridge returned invalid JSON (${response.status}).`); }
  if (!response.ok || !body.ok) throw new Error(body.error || `Google bridge request failed (${response.status}).`);
  return body;
}

async function apiPost(payload) {
  const { url, token } = apiConfig();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ ...payload, token }),
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { throw new Error(`Google bridge returned invalid JSON (${response.status}).`); }
  if (!response.ok || !body.ok) throw new Error(body.error || `Google bridge save failed (${response.status}).`);
  return body;
}

function safe(value, max = 1000) {
  const text = String(value ?? "").trim() || "Not provided";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function numericScore(app) {
  const score = Number(app?.total);
  return Number.isFinite(score) ? score : null;
}

function scoreText(app) {
  const score = numericScore(app);
  if (score == null) return "Not scored";
  return `${score}/20${app.recommendation ? ` • ${app.recommendation}` : ""}`;
}

function decisionBucket(app) {
  const decision = normalize(app?.decision || "");
  const status = normalize(app?.status || "");
  const score = numericScore(app);

  if (["deny", "denied", "reject", "rejected", "fail", "failed"].some((value) => decision === value || status === value)) return "failed";
  if (["accept", "accepted", "accepttrial", "approved", "pass", "passed"].some((value) => decision === value || status === value)) return "passed";
  if (score != null) return score >= PASS_MARK ? "passed" : "failed";
  return "review";
}

function filteredApplicants(applicants, filterMode) {
  if (filterMode === "all") return applicants;
  return applicants.filter((item) => decisionBucket(item) === filterMode);
}

function groupAnswers(app) {
  const groups = [];
  const map = new Map();
  for (const answer of app.answers || []) {
    const section = answer.section || "Application";
    if (!map.has(section)) {
      const group = { section, answers: [] };
      map.set(section, group);
      groups.push(group);
    }
    map.get(section).answers.push(answer);
  }
  return groups.length ? groups : [{ section: "Application", answers: [] }];
}

function applicantSelect(applicants, selectedId, filterMode) {
  const filtered = filteredApplicants(applicants, filterMode);
  const options = filtered.slice(0, 25).map((app) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(safe(`${app.applicationId} • ${app.discordUsername || "Unknown"}`, 100))
      .setDescription(safe(`${app.robloxUsername || "No Roblox"} • ${app.status || "New"} • ${scoreText(app)}`, 100))
      .setValue(app.applicationId)
      .setDefault(app.applicationId === selectedId),
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("carrier_review_applicant")
      .setPlaceholder(filtered.length ? `Select an applicant • ${filterMode}` : `No ${filterMode} applications found`)
      .setDisabled(!filtered.length)
      .addOptions(options.length ? options : [
        new StringSelectMenuOptionBuilder().setLabel("No applications").setValue("none"),
      ]),
  );
}

function filterSelect(filterMode) {
  const options = [
    ["all", "All Applications", "Everything returned by the application archive"],
    ["review", "Needs Review", "Not yet scored or decided"],
    ["passed", "Passed", `Scored ${PASS_MARK}/20+ or accepted`],
    ["failed", "Failed / Denied", `Scored below ${PASS_MARK}/20 or denied`],
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("carrier_review_filter")
      .setPlaceholder("Filter / recall applications")
      .addOptions(options.map(([value, label, description]) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(label)
          .setValue(value)
          .setDescription(description)
          .setDefault(filterMode === value),
      )),
  );
}

function decisionSelect(app) {
  const values = ["Pending", "Accept", "Accept / Trial", "Interview", "Deny"];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("carrier_review_decision")
      .setPlaceholder("Set final decision")
      .addOptions(values.map((value) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(value)
          .setValue(value)
          .setDefault(String(app?.decision || "Pending") === value),
      )),
  );
}

function controls(page, totalPages, hasApp) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("carrier_review_prev").setLabel("Previous").setEmoji("◀️").setStyle(ButtonStyle.Secondary).setDisabled(!hasApp || page <= 0),
    new ButtonBuilder().setCustomId("carrier_review_next").setLabel("Next").setEmoji("▶️").setStyle(ButtonStyle.Secondary).setDisabled(!hasApp || page >= totalPages - 1),
    new ButtonBuilder().setCustomId("carrier_review_grade").setLabel("Grade").setEmoji("📊").setStyle(ButtonStyle.Primary).setDisabled(!hasApp),
    new ButtonBuilder().setCustomId("carrier_review_notes").setLabel("Notes").setEmoji("📝").setStyle(ButtonStyle.Secondary).setDisabled(!hasApp),
    new ButtonBuilder().setCustomId("carrier_review_refresh").setLabel("Refresh").setEmoji("🔄").setStyle(ButtonStyle.Secondary),
  );
}

function reviewEmbed(app, page, filterMode = "all") {
  if (!app) {
    return new EmbedBuilder()
      .setColor(GOLD)
      .setAuthor({ name: "THE CARRY TAVERN • CARRIER RECRUITMENT" })
      .setTitle("⚔️ Carrier Application Review")
      .setDescription(`Select an applicant from the dropdown below. Filter: **${filterMode}**.`)
      .setFooter({ text: "Private staff review console • Google Sheets stays backend-only" });
  }

  const groups = groupAnswers(app);
  const group = groups[Math.max(0, Math.min(page, groups.length - 1))];
  const score = numericScore(app);
  const outcome = score == null ? "Not graded" : score >= PASS_MARK ? `✅ Pass (${PASS_MARK}/20 required)` : `❌ Fail (${PASS_MARK}/20 required)`;
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • CARRIER RECRUITMENT" })
    .setTitle(`⚔️ ${app.applicationId} • ${safe(app.discordUsername, 100)}`)
    .setDescription([
      `**Roblox:** ${safe(app.robloxUsername, 120)}`,
      `**Discord ID:** ${safe(app.discordUserId, 40)}`,
      `**Submitted:** ${safe(app.submitted, 80)}`,
      `**Status:** ${safe(app.status, 80)}`,
      `**Reviewer:** ${safe(app.reviewer || "Unassigned", 100)}`,
      `**Score:** ${scoreText(app)}`,
      `**Threshold:** ${outcome}`,
      `**Decision:** ${safe(app.decision || "Pending", 80)}`,
      `**Archive Filter:** ${filterMode}`,
      "",
      `### ${group.section}`,
    ].join("\n"));

  const answers = (group.answers || []).slice(0, 18);
  if (!answers.length) {
    embed.addFields({ name: "Application", value: "No answers were returned for this section." });
  } else {
    for (const item of answers) {
      embed.addFields({ name: safe(item.question, 256), value: safe(item.answer, 950), inline: false });
    }
  }

  if (app.privateNotes) embed.addFields({ name: "🔒 Private Notes", value: safe(app.privateNotes, 900), inline: false });
  if (app.reasoning) embed.addFields({ name: "📌 Decision Reasoning", value: safe(app.reasoning, 900), inline: false });
  if (app.nextAction) embed.addFields({ name: "➡️ Next Action", value: safe(app.nextAction, 500), inline: false });

  embed.setFooter({ text: `Page ${page + 1}/${groups.length} • ${group.section} • Private staff review console` });
  return embed;
}

function gradeModal(app) {
  const s = app?.scores || {};
  const modal = new ModalBuilder().setCustomId("carrier_review_grade_modal").setTitle("Grade Carrier Application");
  const defs = [
    ["capability", "Capability /5", s.capability ?? ""],
    ["reliability", "Reliability & Activity /4", s.reliability ?? ""],
    ["communication", "Communication /3", s.communication ?? ""],
    ["maturity", "Attitude & Maturity /3", s.maturity ?? ""],
    ["knowledge_effort", "DQ Knowledge /3, Effort /2", `${s.knowledge ?? ""},${s.effort ?? ""}`],
  ];
  modal.addComponents(...defs.map(([id, label, value]) =>
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(true).setValue(String(value)),
    ),
  ));
  return modal;
}

function notesModal(app) {
  return new ModalBuilder()
    .setCustomId("carrier_review_notes_modal")
    .setTitle("Application Notes & Next Action")
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("privateNotes").setLabel("Private review notes").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1800).setValue(String(app?.privateNotes || ""))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("reasoning").setLabel("Decision reasoning").setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1800).setValue(String(app?.reasoning || ""))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("nextAction").setLabel("Next action").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(300).setValue(String(app?.nextAction || ""))),
    );
}

function parseIntRange(value, min, max, label) {
  const n = Number(String(value).trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

function weakAreas(app) {
  const s = app?.scores || {};
  const checks = [
    ["Capability", Number(s.capability), 5],
    ["Reliability & Activity", Number(s.reliability), 4],
    ["Communication", Number(s.communication), 3],
    ["Attitude & Maturity", Number(s.maturity), 3],
    ["Dungeon Quest Knowledge", Number(s.knowledge), 3],
    ["Application Effort", Number(s.effort), 2],
  ];
  return checks
    .filter(([, value, max]) => Number.isFinite(value) && value < Math.ceil(max * 0.67))
    .map(([label, value, max]) => `${label} (${value}/${max})`)
    .slice(0, 4);
}

function finalOutcome(decision, app) {
  const normalized = normalize(decision);
  if (["accept", "accepttrial", "accepted", "approved", "pass", "passed"].includes(normalized)) return "passed";
  if (["deny", "denied", "reject", "rejected", "fail", "failed"].includes(normalized)) return "failed";
  if (normalized === "interview" || normalized === "pending") return null;
  return numericScore(app) != null ? (numericScore(app) >= PASS_MARK ? "passed" : "failed") : null;
}

async function dmDecisionResult(client, app, decision) {
  const discordId = String(app?.discordUserId || "").trim();
  if (!/^\d{15,22}$/.test(discordId)) return { sent: false, reason: "Applicant Discord ID is missing or invalid." };

  const outcome = finalOutcome(decision, app);
  if (!outcome) return { sent: false, reason: "Decision is not final yet." };

  const score = numericScore(app);
  const user = await client.users.fetch(discordId).catch(() => null);
  if (!user) return { sent: false, reason: "Could not find the applicant's Discord account." };

  const lines = outcome === "passed"
    ? [
        "🍺 **The Carry Tavern — Carrier Team Application Result**",
        "",
        `✅ **Result: PASSED${decision ? ` • ${decision}` : ""}**`,
        score == null ? null : `📊 **Score:** ${score}/20 — pass mark is ${PASS_MARK}/20`,
        app?.reasoning ? `📝 **Reviewer note:** ${safe(app.reasoning, 700)}` : null,
        "",
        "### What happens next",
        "1. You will move into the **Trainee Carrier** stage.",
        "2. Read the recruitment/training process before your assessment.",
        "3. Complete training and the practical assessment when Carrier management schedules it.",
        "4. Successful trainees then complete the **7-day probation** before becoming a full Carrier.",
        app?.nextAction ? `5. **Your next action:** ${safe(app.nextAction, 500)}` : null,
        "",
        `📚 **Recruitment / Training Process:** ${RECRUITMENT_SOP_URL}`,
        "",
        "Official Tavern carries are free. Carriers must never demand Robux, gold, items, gifts or payment for an official carry.",
      ]
    : [
        "🍺 **The Carry Tavern — Carrier Team Application Result**",
        "",
        `❌ **Result: NOT PASSED${decision ? ` • ${decision}` : ""}**`,
        score == null ? null : `📊 **Score:** ${score}/20 — pass mark is ${PASS_MARK}/20`,
        app?.reasoning ? `📝 **Reviewer note:** ${safe(app.reasoning, 700)}` : null,
        weakAreas(app).length ? `📌 **Areas to improve:** ${weakAreas(app).join(", ")}` : null,
        app?.nextAction ? `➡️ **Next action:** ${safe(app.nextAction, 500)}` : null,
        "",
        "Your previous application remains in the staff archive so recruitment staff can recall it for future reviews.",
        `📚 **Recruitment Process:** ${RECRUITMENT_SOP_URL}`,
        `📝 **Application Form:** ${APPLICATION_FORM_URL}`,
        "",
        "You can apply again when you are ready and recruitment is accepting applications.",
      ];

  try {
    await user.send(lines.filter(Boolean).join("\n").slice(0, 1950));
    return { sent: true };
  } catch (error) {
    return { sent: false, reason: `DM failed: ${error.message}` };
  }
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("carrier-app-review")
    .setDescription("Open the private Discord Carrier application review console"),

  async execute(interaction) {
    if (!canReview(interaction)) {
      return interaction.reply({ content: "❌ You do not have permission to review Carrier applications.", flags: MessageFlags.Ephemeral });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let applicants = [];
    let app = null;
    let page = 0;
    let filterMode = "review";

    const loadList = async () => {
      const body = await apiGet("list", { includeArchived: 1, includeFailed: 1 });
      applicants = Array.isArray(body.applicants) ? body.applicants : [];
    };

    const loadApp = async (id) => {
      if (!id) { app = null; page = 0; return; }
      const body = await apiGet("get", { id });
      app = body.application || null;
      page = 0;
    };

    const pickFirstVisible = async () => {
      const visible = filteredApplicants(applicants, filterMode);
      if (!visible.length) {
        app = null;
        page = 0;
        return;
      }
      if (!app || !visible.some((item) => item.applicationId === app.applicationId)) {
        await loadApp(visible[0].applicationId);
      }
    };

    const payload = () => {
      const groups = app ? groupAnswers(app) : [];
      return {
        embeds: [reviewEmbed(app, page, filterMode)],
        components: [
          filterSelect(filterMode),
          applicantSelect(applicants, app?.applicationId, filterMode),
          controls(page, groups.length || 1, Boolean(app)),
          ...(app ? [decisionSelect(app)] : []),
        ],
      };
    };

    try {
      await loadList();
      await pickFirstVisible();
      if (!app && applicants.length) {
        filterMode = "all";
        await pickFirstVisible();
      }
    } catch (error) {
      return interaction.editReply(`❌ Could not load Carrier applications: ${error.message}`.slice(0, 1900));
    }

    const message = await interaction.editReply(payload());
    const collector = message.createMessageComponentCollector({ time: 15 * 60 * 1000 });

    collector.on("collect", async (i) => {
      if (i.user.id !== interaction.user.id) {
        return i.reply({ content: "❌ This review console belongs to another staff member.", flags: MessageFlags.Ephemeral });
      }

      try {
        if (i.customId === "carrier_review_filter") {
          filterMode = i.values[0] || "all";
          await i.deferUpdate();
          await pickFirstVisible();
          return interaction.editReply(payload());
        }

        if (i.customId === "carrier_review_applicant") {
          const id = i.values[0];
          if (id === "none") return i.deferUpdate();
          await i.deferUpdate();
          await loadApp(id);
          return interaction.editReply(payload());
        }

        if (i.customId === "carrier_review_prev") {
          page = Math.max(0, page - 1);
          return i.update(payload());
        }

        if (i.customId === "carrier_review_next") {
          page = Math.min(groupAnswers(app).length - 1, page + 1);
          return i.update(payload());
        }

        if (i.customId === "carrier_review_refresh") {
          await i.deferUpdate();
          const selected = app?.applicationId;
          await loadList();
          if (selected) await loadApp(selected).catch(() => {});
          await pickFirstVisible();
          return interaction.editReply(payload());
        }

        if (!app) return i.reply({ content: "❌ Select an application first.", flags: MessageFlags.Ephemeral });

        if (i.customId === "carrier_review_grade") {
          await i.showModal(gradeModal(app));
          const submitted = await i.awaitModalSubmit({ filter: (m) => m.customId === "carrier_review_grade_modal" && m.user.id === i.user.id, time: 120000 }).catch(() => null);
          if (!submitted) return;

          const pair = submitted.fields.getTextInputValue("knowledge_effort").split(/[,/ ]+/).filter(Boolean);
          if (pair.length < 2) return submitted.reply({ content: "❌ Enter DQ Knowledge and Effort like `3,2`.", flags: MessageFlags.Ephemeral });

          const scores = {
            capability: parseIntRange(submitted.fields.getTextInputValue("capability"), 0, 5, "Capability"),
            reliability: parseIntRange(submitted.fields.getTextInputValue("reliability"), 0, 4, "Reliability"),
            communication: parseIntRange(submitted.fields.getTextInputValue("communication"), 0, 3, "Communication"),
            maturity: parseIntRange(submitted.fields.getTextInputValue("maturity"), 0, 3, "Maturity"),
            knowledge: parseIntRange(pair[0], 0, 3, "DQ Knowledge"),
            effort: parseIntRange(pair[1], 0, 2, "Application Effort"),
          };
          const total = Object.values(scores).reduce((sum, value) => sum + value, 0);
          const threshold = total >= PASS_MARK ? "✅ PASS" : "❌ FAIL";

          await apiPost({ action: "saveReview", applicationId: app.applicationId, reviewerDiscordId: submitted.user.id, reviewerName: submitted.user.username, scores });
          await submitted.reply({ content: `✅ Application grade saved: **${total}/20 • ${threshold}**. Set a final decision to DM the applicant their result.`, flags: MessageFlags.Ephemeral });
          await loadList();
          await loadApp(app.applicationId);
          return interaction.editReply(payload());
        }

        if (i.customId === "carrier_review_notes") {
          await i.showModal(notesModal(app));
          const submitted = await i.awaitModalSubmit({ filter: (m) => m.customId === "carrier_review_notes_modal" && m.user.id === i.user.id, time: 120000 }).catch(() => null);
          if (!submitted) return;
          await apiPost({
            action: "saveReview",
            applicationId: app.applicationId,
            reviewerDiscordId: submitted.user.id,
            reviewerName: submitted.user.username,
            privateNotes: submitted.fields.getTextInputValue("privateNotes"),
            reasoning: submitted.fields.getTextInputValue("reasoning"),
            nextAction: submitted.fields.getTextInputValue("nextAction"),
          });
          await submitted.reply({ content: "✅ Notes and next action saved.", flags: MessageFlags.Ephemeral });
          await loadApp(app.applicationId);
          return interaction.editReply(payload());
        }

        if (i.customId === "carrier_review_decision") {
          const decision = i.values[0];
          const previousDecision = String(app.decision || "Pending");
          await i.deferUpdate();
          await apiPost({ action: "saveReview", applicationId: app.applicationId, reviewerDiscordId: i.user.id, reviewerName: i.user.username, decision });
          await loadList();
          await loadApp(app.applicationId);

          if (normalize(previousDecision) !== normalize(decision) && finalOutcome(decision, app)) {
            const dm = await dmDecisionResult(i.client, app, decision);
            const note = dm.sent
              ? `✅ Final decision saved and **${app.discordUsername || "the applicant"}** was DMed their result and next-step documents.`
              : `⚠️ Final decision saved, but the applicant could not be DMed: ${dm.reason}`;
            await interaction.followUp({ content: note.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
          }

          return interaction.editReply(payload());
        }
      } catch (error) {
        console.error("[CARRIER APP REVIEW]", error);
        if (!i.replied && !i.deferred) return i.reply({ content: `❌ ${error.message}`.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
        return interaction.followUp({ content: `❌ ${error.message}`.slice(0, 1900), flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    });

    collector.on("end", () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};