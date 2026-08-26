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

function scoreText(app) {
  if (app.total == null || app.total === "") return "Not scored";
  return `${app.total}/20${app.recommendation ? ` • ${app.recommendation}` : ""}`;
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

function applicantSelect(applicants, selectedId) {
  const options = applicants.slice(0, 25).map((app) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(safe(`${app.applicationId} • ${app.discordUsername || "Unknown"}`, 100))
      .setDescription(safe(`${app.robloxUsername || "No Roblox"} • ${app.status || "New"} • ${scoreText(app)}`, 100))
      .setValue(app.applicationId)
      .setDefault(app.applicationId === selectedId),
  );

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("carrier_review_applicant")
      .setPlaceholder(applicants.length ? "Select an applicant" : "No applications found")
      .setDisabled(!applicants.length)
      .addOptions(options.length ? options : [
        new StringSelectMenuOptionBuilder().setLabel("No applications").setValue("none"),
      ]),
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

function reviewEmbed(app, page) {
  if (!app) {
    return new EmbedBuilder()
      .setColor(GOLD)
      .setAuthor({ name: "THE CARRY TAVERN • CARRIER RECRUITMENT" })
      .setTitle("⚔️ Carrier Application Review")
      .setDescription("Select an applicant from the dropdown below. Their Google Form answers will be loaded here privately for you.")
      .setFooter({ text: "Private staff review console • Google Sheets stays backend-only" });
  }

  const groups = groupAnswers(app);
  const group = groups[Math.max(0, Math.min(page, groups.length - 1))];
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
      `**Decision:** ${safe(app.decision || "Pending", 80)}`,
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

    const loadList = async () => {
      const body = await apiGet("list");
      applicants = Array.isArray(body.applicants) ? body.applicants : [];
    };

    const loadApp = async (id) => {
      if (!id) { app = null; page = 0; return; }
      const body = await apiGet("get", { id });
      app = body.application || null;
      page = 0;
    };

    const payload = () => {
      const groups = app ? groupAnswers(app) : [];
      return {
        embeds: [reviewEmbed(app, page)],
        components: [
          applicantSelect(applicants, app?.applicationId),
          controls(page, groups.length || 1, Boolean(app)),
          ...(app ? [decisionSelect(app)] : []),
        ],
      };
    };

    try {
      await loadList();
      if (applicants.length) await loadApp(applicants[0].applicationId);
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
          if (selected) await loadApp(selected).catch(async () => applicants.length && loadApp(applicants[0].applicationId));
          else if (applicants.length) await loadApp(applicants[0].applicationId);
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

          await apiPost({ action: "saveReview", applicationId: app.applicationId, reviewerDiscordId: submitted.user.id, reviewerName: submitted.user.username, scores });
          await submitted.reply({ content: "✅ Application grade saved.", flags: MessageFlags.Ephemeral });
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
          await i.deferUpdate();
          await apiPost({ action: "saveReview", applicationId: app.applicationId, reviewerDiscordId: i.user.id, reviewerName: i.user.username, decision });
          await loadApp(app.applicationId);
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
