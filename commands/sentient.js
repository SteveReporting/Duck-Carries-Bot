"use strict";

const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const GOLD = 0xf2b705;
const RED = 0xd94b4b;
const GREEN = 0x57f287;

function truncate(value, max = 900) {
  const text = String(value ?? "").trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function runtime(interaction) {
  const sentient = interaction.client?.sentient;
  if (!sentient) throw new Error("SENTIENT is not attached to this bot process.");
  return sentient;
}

function control(interaction) {
  return runtime(interaction).control;
}

function configuredMessage(interaction) {
  const state = runtime(interaction).status();
  const reason = state.reason || "control plane unavailable";
  return [
    "🧠 **SENTIENT is installed in the Carry Tavern bot, but the private control-plane link is not active on this host.**",
    `Reason: **${reason}**`,
    "The ordinary Carry Tavern queue, Treasury, marketplace, tickets and moderation systems remain online.",
    "Set `SENTIENT_ADMIN_SECRET` on the bot host to the same private secret used by `sentient-control`, then restart the bot.",
  ].join("\n");
}

async function ensureConfigured(interaction) {
  if (runtime(interaction).configured()) return true;
  await interaction.editReply({ content: configuredMessage(interaction) });
  return false;
}

function manager(interaction) {
  return Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));
}

async function requireManager(interaction) {
  if (manager(interaction)) return true;
  await interaction.editReply({ content: "❌ **Manage Server** is required for that SENTIENT control." });
  return false;
}

function rows(payload, keys) {
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function memoryLine(row) {
  const subject = row.subject || row.title || row.memory_type || "Memory";
  const content = row.content || row.body || row.text || "";
  const importance = row.importance == null ? "" : ` · importance ${row.importance}`;
  return `• **${truncate(subject, 120)}**${importance}\n  ${truncate(content, 360)}`;
}

function archiveLine(row) {
  return `• **${truncate(row.title || row.archive_type || "Archive record", 120)}**\n  ${truncate(row.body || row.content || row.summary || "", 360)}`;
}

function knowledgeLine(row) {
  const ns = row.namespace ? ` · \`${truncate(row.namespace, 60)}\`` : "";
  return `• **${truncate(row.title || "Knowledge", 120)}**${ns}\n  ${truncate(row.content || row.body || "", 360)}`;
}

function statusEmbed(report, dispatch, sentientState) {
  const summary = report?.summary || report?.report?.summary || {};
  const matches = rows(dispatch, ["assignments", "matches"]).slice(0, 4).map((row) => {
    const target = row.carrierUsername || row.carrierDiscordId || row.carrier || "carrier";
    return `• ${truncate(row.dungeon || row.activity || "Carry", 80)} → **${truncate(target, 80)}**`;
  });

  const warningText = Array.isArray(summary.warnings) && summary.warnings.length
    ? summary.warnings.map((value) => `• ${truncate(value, 220)}`).join("\n")
    : "No operational warning thresholds triggered.";

  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • SENTIENT" })
    .setTitle("🧠 SENTIENT Operational State")
    .setDescription([
      `Control link: **${sentientState.configured ? "ONLINE" : "OFFLINE"}**`,
      `Carries (7d): **${summary.completedCarries ?? 0}/${summary.carryRequests ?? 0} completed** · queued **${summary.queuedCarries ?? 0}**`,
      `Available carriers: **${summary.activeCarriers ?? 0}**${summary.avgClaimMinutes == null ? "" : ` · avg claim **${summary.avgClaimMinutes}m**`}`,
      `Applications pending: **${summary.pendingApplications ?? 0}** · Treasury requests: **${summary.treasuryRequests ?? 0}**`,
    ].join("\n"))
    .addFields(
      { name: "Suggested dispatch", value: matches.length ? matches.join("\n") : "No deterministic dispatch matches right now." },
      { name: "Warnings", value: truncate(warningText, 1000) },
    )
    .setFooter({ text: "Tenant-scoped intelligence • deterministic operations first" })
    .setTimestamp();
}

function capabilitiesEmbed(sentientState) {
  return new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • SENTIENT" })
    .setTitle("⚙️ Unified SENTIENT Capabilities")
    .setDescription([
      "**Now integrated into the active Carry Tavern bot:**",
      "• tenant-scoped event perception across commands, buttons, joins/leaves and Discord structure",
      "• digital twins, durable memory, searchable archive and knowledge retrieval",
      "• operational reports, deterministic carry dispatch and what-if simulation",
      "• community graph, health/SLA telemetry, incidents and governance actions",
      "• server snapshots, event programs, network opt-ins and autonomic analysis",
      "• CITADEL default-deny approvals and recovery control-plane access",
      "• Project Sentient Cloudflare/Bartender control bridge through the private control plane",
      "• self-hosted/local reasoning through `/sentient ask` when the local model is connected",
      "",
      "Existing Carry Tavern queue, Treasury, ticket, marketplace, carrier and security systems remain authoritative; SENTIENT observes and coordinates them rather than replacing them.",
    ].join("\n"))
    .addFields({
      name: "Bridge state",
      value: sentientState.configured
        ? `Online · queue ${sentientState.queueDepth} · dropped ${sentientState.droppedEvents}`
        : `Passive · ${sentientState.reason || "not configured"}`,
    })
    .setTimestamp();
}

async function answerHealth(interaction) {
  const sentient = runtime(interaction);
  const state = sentient.status();
  if (!state.configured) return interaction.editReply({ content: configuredMessage(interaction) });

  const [controlResult, workerResult] = await Promise.allSettled([
    sentient.control.health(),
    sentient.control.worker("/health", "GET"),
  ]);
  const controlText = controlResult.status === "fulfilled" ? "🟢 Online" : `🔴 ${truncate(controlResult.reason?.message, 180)}`;
  const workerText = workerResult.status === "fulfilled" ? "🟢 Online" : `🟠 ${truncate(workerResult.reason?.message, 180)}`;

  const embed = new EmbedBuilder()
    .setColor(controlResult.status === "fulfilled" ? GREEN : RED)
    .setTitle("🧠 SENTIENT Health")
    .addFields(
      { name: "Private control plane", value: controlText, inline: true },
      { name: "Cloudflare Sentient", value: workerText, inline: true },
      { name: "Carry Tavern bridge", value: `🟢 Attached · queue ${state.queueDepth} · dropped ${state.droppedEvents}` },
      { name: "Message perception", value: state.captureMessageContent ? "Content enabled" : `Metadata only · sample 1/${state.messageSampleEvery}` },
    )
    .setTimestamp();
  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("sentient")
    .setDescription("The Carry Tavern SENTIENT intelligence and control layer")
    .addSubcommand((sub) => sub
      .setName("ask")
      .setDescription("Ask this guild's tenant-scoped SENTIENT intelligence")
      .addStringOption((opt) => opt.setName("question").setDescription("Question for SENTIENT").setRequired(true).setMaxLength(1500)))
    .addSubcommand((sub) => sub.setName("status").setDescription("Show the live SENTIENT operational state"))
    .addSubcommand((sub) => sub.setName("health").setDescription("Check the integrated SENTIENT services"))
    .addSubcommand((sub) => sub.setName("capabilities").setDescription("Show what SENTIENT now adds to the Carry Tavern bot"))
    .addSubcommand((sub) => sub
      .setName("memory")
      .setDescription("Search this guild's durable SENTIENT memory")
      .addStringOption((opt) => opt.setName("query").setDescription("Memory search query").setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub
      .setName("archive")
      .setDescription("Search this guild's SENTIENT archive")
      .addStringOption((opt) => opt.setName("query").setDescription("Archive search query").setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub
      .setName("knowledge")
      .setDescription("Search guild/shared SENTIENT knowledge")
      .addStringOption((opt) => opt.setName("query").setDescription("Knowledge search query").setRequired(true).setMaxLength(500))
      .addStringOption((opt) => opt.setName("namespace").setDescription("Optional knowledge namespace").setRequired(false).setMaxLength(100)))
    .addSubcommand((sub) => sub
      .setName("simulate")
      .setDescription("Run a deterministic guild what-if simulation")
      .addNumberOption((opt) => opt.setName("member_growth").setDescription("Member growth %").setMinValue(-90).setMaxValue(1000))
      .addNumberOption((opt) => opt.setName("carrier_change").setDescription("Carrier change %").setMinValue(-100).setMaxValue(1000))
      .addNumberOption((opt) => opt.setName("demand_change").setDescription("Carry demand change %").setMinValue(-100).setMaxValue(1000))
      .addNumberOption((opt) => opt.setName("event_demand").setDescription("Extra event demand %").setMinValue(0).setMaxValue(1000)))
    .addSubcommand((sub) => sub.setName("citadel").setDescription("Show CITADEL approvals, incidents and fail-closed state"))
    .addSubcommand((sub) => sub
      .setName("remember")
      .setDescription("Store an explicit guild memory in SENTIENT")
      .addStringOption((opt) => opt.setName("subject").setDescription("Memory subject").setRequired(true).setMaxLength(180))
      .addStringOption((opt) => opt.setName("content").setDescription("Memory content").setRequired(true).setMaxLength(1500))
      .addIntegerOption((opt) => opt.setName("importance").setDescription("Importance 1-100").setMinValue(1).setMaxValue(100)))
    .addSubcommand((sub) => sub.setName("snapshot").setDescription("Create a current Discord structure snapshot"))
    .addSubcommand((sub) => sub.setName("autonomy").setDescription("Run SENTIENT autonomic analysis for this guild"))
    .addSubcommand((sub) => sub.setName("incidents").setDescription("List open SENTIENT incidents"))
    .addSubcommand((sub) => sub.setName("actions").setDescription("List pending CITADEL-governed actions"))
    .addSubcommand((sub) => sub
      .setName("decide")
      .setDescription("Approve or deny a pending CITADEL action")
      .addStringOption((opt) => opt.setName("action_id").setDescription("Action ID").setRequired(true).setMaxLength(120))
      .addStringOption((opt) => opt.setName("decision").setDescription("Decision").setRequired(true).addChoices(
        { name: "Approve", value: "approved" },
        { name: "Deny", value: "denied" },
      )))
    .addSubcommand((sub) => sub
      .setName("setup")
      .setDescription("Run SENTIENT's create-only guild bootstrap")
      .addStringOption((opt) => opt.setName("mode").setDescription("Bootstrap mode").setRequired(false).addChoices(
        { name: "Full", value: "full" },
        { name: "Minimal", value: "minimal" },
      ))),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const sentient = runtime(interaction);
    const sub = interaction.options.getSubcommand();

    try {
      if (sub === "capabilities") {
        return interaction.editReply({ embeds: [capabilitiesEmbed(sentient.status())] });
      }
      if (sub === "health") return answerHealth(interaction);
      if (!(await ensureConfigured(interaction))) return;

      const api = control(interaction);
      const guildId = interaction.guildId;
      const userId = interaction.user.id;
      const username = interaction.member?.displayName || interaction.user.globalName || interaction.user.username;

      if (sub === "ask") {
        const result = await api.intelligence("ask", guildId, {
          userDiscordId: userId,
          username,
          question: interaction.options.getString("question", true),
        });
        return interaction.editReply({ content: `🧠 **SENTIENT**\n${truncate(result.answer || result.result?.answer || "No answer returned.", 1900)}` });
      }

      if (sub === "status") {
        const [report, dispatch] = await Promise.all([
          api.intelligence("report", guildId),
          api.intelligence("dispatch", guildId),
        ]);
        return interaction.editReply({ embeds: [statusEmbed(report, dispatch, sentient.status())] });
      }

      if (sub === "memory") {
        const result = await api.intelligence("memory_search", guildId, { query: interaction.options.getString("query", true), limit: 8 });
        const found = rows(result, ["memories", "results", "items"]);
        return interaction.editReply({ content: found.length ? `🧠 **SENTIENT Memory**\n${found.slice(0, 8).map(memoryLine).join("\n")}` : "No matching guild memory was found." });
      }

      if (sub === "archive") {
        const result = await api.intelligence("archive_search", guildId, { query: interaction.options.getString("query", true), limit: 8 });
        const found = rows(result, ["records", "archive", "results", "items"]);
        return interaction.editReply({ content: found.length ? `🗄️ **SENTIENT Archive**\n${found.slice(0, 8).map(archiveLine).join("\n")}` : "No matching archive records were found." });
      }

      if (sub === "knowledge") {
        const result = await api.intelligence("knowledge_search", guildId, {
          query: interaction.options.getString("query", true),
          namespace: interaction.options.getString("namespace") || null,
          limit: 8,
        });
        const found = rows(result, ["knowledge", "records", "results", "items"]);
        return interaction.editReply({ content: found.length ? `📚 **SENTIENT Knowledge**\n${found.slice(0, 8).map(knowledgeLine).join("\n")}` : "No matching knowledge records were found." });
      }

      if (sub === "simulate") {
        const result = await api.intelligence("simulate", guildId, {
          memberGrowthPct: interaction.options.getNumber("member_growth"),
          carrierChangePct: interaction.options.getNumber("carrier_change"),
          demandChangePct: interaction.options.getNumber("demand_change"),
          eventDemandPct: interaction.options.getNumber("event_demand"),
        });
        const data = result.simulation || result.result || result;
        return interaction.editReply({ content: `🧪 **SENTIENT Simulation**\n\`\`\`json\n${truncate(JSON.stringify(data, null, 2), 1750)}\n\`\`\`` });
      }

      if (sub === "citadel") {
        const [actions, incidents] = await Promise.all([
          api.governance("action_list", guildId, { status: "pending", limit: 25 }),
          api.governance("incident_list", guildId, { status: "open", limit: 25 }),
        ]);
        const pending = rows(actions, ["actions", "results"]).length;
        const openIncidents = rows(incidents, ["incidents", "results"]).length;
        const embed = new EmbedBuilder()
          .setColor(GOLD)
          .setTitle("🛡️ SENTIENT // CITADEL")
          .setDescription([
            "Unknown actions are **denied by default**. Cross-guild private actions are denied. High-risk actions fail closed if auditing/control is unavailable.",
            "Critical actions use independent approval quorum; the initiating operator cannot satisfy their own required approval.",
            "Recovery is allowlisted and approval-gated—there is no arbitrary AI shell execution.",
          ].join("\n"))
          .addFields(
            { name: "Pending governed actions", value: String(pending), inline: true },
            { name: "Open incidents", value: String(openIncidents), inline: true },
          )
          .setTimestamp();
        return interaction.editReply({ embeds: [embed] });
      }

      if (sub === "remember") {
        if (!(await requireManager(interaction))) return;
        const result = await api.intelligence("remember", guildId, {
          memoryType: "staff_explicit",
          subject: interaction.options.getString("subject", true),
          content: interaction.options.getString("content", true),
          importance: interaction.options.getInteger("importance") || 70,
          confidence: 1,
          metadata: { source: "carry-tavern-bot", createdByDiscordId: userId },
        });
        return interaction.editReply({ content: `✅ SENTIENT memory stored${result.result?.id ? ` as \`${result.result.id}\`` : ""}.` });
      }

      if (sub === "snapshot") {
        if (!(await requireManager(interaction))) return;
        const result = await sentient.snapshotGuild(interaction.guild, `manual-${userId}`);
        return interaction.editReply({ content: `✅ SENTIENT structure snapshot created${result?.result?.id ? ` as \`${result.result.id}\`` : ""}.` });
      }

      if (sub === "autonomy") {
        if (!(await requireManager(interaction))) return;
        const result = await api.intelligence("autonomic", guildId);
        const data = result.analysis || result.result || result;
        return interaction.editReply({ content: `🧠 **Autonomic analysis complete**\n\`\`\`json\n${truncate(JSON.stringify(data, null, 2), 1700)}\n\`\`\`` });
      }

      if (sub === "incidents") {
        if (!(await requireManager(interaction))) return;
        const result = await api.governance("incident_list", guildId, { status: "open", limit: 15 });
        const found = rows(result, ["incidents", "results"]);
        const lines = found.slice(0, 15).map((row) => `• \`${row.id}\` **${truncate(row.title || row.incident_type || "Incident", 100)}** · ${row.severity || "unknown"} · ${row.status || "open"}`);
        return interaction.editReply({ content: found.length ? `🚨 **Open SENTIENT incidents**\n${lines.join("\n")}` : "✅ No open SENTIENT incidents." });
      }

      if (sub === "actions") {
        if (!(await requireManager(interaction))) return;
        const result = await api.governance("action_list", guildId, { status: "pending", limit: 15 });
        const found = rows(result, ["actions", "results"]);
        const lines = found.slice(0, 15).map((row) => `• \`${row.id}\` **${truncate(row.title || row.action_type || "Action", 100)}** · ${row.risk || "normal"}`);
        return interaction.editReply({ content: found.length ? `🛡️ **Pending CITADEL actions**\n${lines.join("\n")}` : "✅ No pending CITADEL actions." });
      }

      if (sub === "decide") {
        if (!(await requireManager(interaction))) return;
        const result = await api.governance("action_decide", guildId, {
          actionId: interaction.options.getString("action_id", true),
          decision: interaction.options.getString("decision", true),
          approverDiscordId: userId,
        });
        const action = result.result || result;
        return interaction.editReply({ content: `🛡️ CITADEL decision recorded. Current state: **${action.status || action.decision || "updated"}**.` });
      }

      if (sub === "setup") {
        if (!(await requireManager(interaction))) return;
        const mode = interaction.options.getString("mode") || "full";
        const result = await sentient.bootstrapGuild(interaction.guild, mode);
        const createdRoles = result?.result?.createdRoles?.length ?? 0;
        const createdCategories = result?.result?.createdCategories?.length ?? 0;
        const createdChannels = result?.result?.createdChannels?.length ?? 0;
        return interaction.editReply({
          content: [
            "✅ **SENTIENT create-only bootstrap complete.**",
            `Mode: **${mode}**`,
            `Created: **${createdRoles} roles · ${createdCategories} categories · ${createdChannels} channels**`,
            "Existing unrelated Discord structure was not deleted or overwritten.",
          ].join("\n"),
        });
      }

      return interaction.editReply({ content: "Unknown SENTIENT subcommand." });
    } catch (error) {
      console.error(`[SENTIENT COMMAND] /sentient ${sub}:`, error);
      const status = error?.status ? ` (HTTP ${error.status})` : "";
      return interaction.editReply({ content: `❌ SENTIENT could not complete that request${status}: ${truncate(error?.message || error, 1500)}` });
    }
  },
};
