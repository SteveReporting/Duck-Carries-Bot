const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");

const CATEGORY_NAME = "🧪 TICKET V2 TEST";
const GOLD = 0xF2B705;
const BLUE = 0x3498DB;
const GREEN = 0x2ECC71;

const CARRIER_APPLICATION = {
  formId: "1LgPAHMBHKCTvnDgMb4Q8LI03qNG2cYUYfDMqwE9HF_A",
  publicUrl: "https://docs.google.com/forms/d/e/1FAIpQLSdIT98g11GKA2uJ9iTDGrOIHgK3FNrj-oo94g56JJBws8S-rQ/viewform",
  editUrl: "https://docs.google.com/forms/d/1LgPAHMBHKCTvnDgMb4Q8LI03qNG2cYUYfDMqwE9HF_A/edit",
  responseSheetUrl: "https://docs.google.com/spreadsheets/d/1RvkYMyIjT7SGbu4nq5Pnqk2p2r6MnWLdXH17r1VI0fU/edit",
  recordsFolderUrl: "https://drive.google.com/drive/folders/1vTcEc9qbwCgaYdtOCajDpYgI6ys3OHHH",
};

const STATUS = {
  open: "🟢 Open",
  review: "🟡 Under Review",
  progress: "🔵 In Progress",
  waiting: "🟣 Waiting on Requester",
  escalated: "🟠 Escalated",
  interview: "🎙️ Interview",
  accepted: "✅ Accepted",
  approved: "✅ Approved",
  denied: "❌ Denied",
  rejected: "❌ Rejected",
  resolved: "✅ Resolved",
};

function canRun(interaction) {
  if (!interaction.inGuild()) return false;
  return interaction.guild.ownerId === interaction.user.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ||
    Boolean(process.env.AI_MANAGER_ROLE_ID && interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID));
}

function button(id, label, style, emoji) {
  const item = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) item.setEmoji(emoji);
  return item;
}

function linkButton(label, url, emoji) {
  const item = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url);
  if (emoji) item.setEmoji(emoji);
  return item;
}

function row(...items) {
  return new ActionRowBuilder().addComponents(...items);
}

function who(id) {
  return id ? `<@${id}>` : "`Unassigned`";
}

function priorityLabel(value) {
  if (value === "Urgent") return "🔴 Urgent";
  if (value === "High") return "🟠 High";
  return "🟢 Normal";
}

function cyclePriority(value) {
  if (value === "Normal") return "High";
  if (value === "High") return "Urgent";
  return "Normal";
}

function validHttpUrl(value) {
  if (!value) return null;
  try {
    const parsed = new URL(String(value).trim());
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function baseEmbed(title, description, colour = GOLD) {
  return new EmbedBuilder()
    .setColor(colour)
    .setAuthor({ name: "THE CARRY TAVERN • TICKET SYSTEM V2" })
    .setTitle(title)
    .setDescription(description)
    .setFooter({ text: "🧪 TEST MODE • Existing ticket systems are untouched" })
    .setTimestamp();
}

function supportPayload(state, requesterId) {
  return {
    embeds: [baseEmbed(
      "🛟 SUPPORT CASE • SUP-TEST-001",
      "A live Support case file. Staff actions update this same panel rather than filling the ticket with status messages.",
      BLUE,
    ).addFields(
      { name: "👤 Requester", value: `<@${requesterId}>`, inline: true },
      { name: "📌 Status", value: STATUS[state.status], inline: true },
      { name: "🙋 Assigned", value: who(state.assigned), inline: true },
      { name: "⚠️ Priority", value: priorityLabel(state.priority), inline: true },
      { name: "🗂️ Issue", value: "Bot / Discord / Website", inline: true },
      { name: "📝 Private Notes", value: `**${state.notes}**`, inline: true },
      { name: "📋 Request", value: "My verified Traveller role disappeared after I changed my Roblox account.", inline: false },
      { name: "🕒 Latest Activity", value: state.lastAction, inline: false },
    )],
    components: [
      row(
        button("demo_sup_claim", "Claim", ButtonStyle.Primary, "🙋"),
        button("demo_sup_wait", "Wait for User", ButtonStyle.Secondary, "🟣"),
        button("demo_sup_escalate", "Escalate", ButtonStyle.Danger, "⬆️"),
        button("demo_sup_resolve", "Resolve", ButtonStyle.Success, "✅"),
      ),
      row(
        button("demo_sup_priority", "Priority", ButtonStyle.Secondary, "⚠️"),
        button("demo_sup_note", "Internal Note", ButtonStyle.Secondary, "📝"),
      ),
    ],
  };
}

function carrierPayload(state, requesterId) {
  const score = state.score == null ? "`Not scored`" : `**${state.score}/20** • ${state.recommendation}`;
  const exact = state.exactApplicationUrl
    ? `[Open APP-TEST-001 exact submission](${state.exactApplicationUrl})`
    : "`Awaiting a submitted application record`";

  const links = [
    linkButton("Open Live Application", CARRIER_APPLICATION.publicUrl, "📝"),
    linkButton("Staff Review Sheet", CARRIER_APPLICATION.responseSheetUrl, "📊"),
    linkButton("Application Records", CARRIER_APPLICATION.recordsFolderUrl, "📁"),
  ];
  if (state.exactApplicationUrl) links.push(linkButton("View Exact Application", state.exactApplicationUrl, "📄"));

  return {
    embeds: [baseEmbed(
      "⚔️ CARRIER APPLICATION • APP-TEST-001",
      "This demo is connected to the real **The Carry Tavern — Carrier Team Application** Google Form and its real staff review system.",
      GOLD,
    ).addFields(
      { name: "👤 Applicant", value: `<@${requesterId}>`, inline: true },
      { name: "📌 Stage", value: STATUS[state.status], inline: true },
      { name: "📋 Reviewer", value: who(state.assigned), inline: true },
      { name: "📊 Score", value: score, inline: true },
      { name: "📝 Form", value: "✅ **Real Carrier Application connected**", inline: true },
      { name: "📄 Exact Submission", value: state.exactApplicationUrl ? "✅ Linked" : "🟡 Waiting for submission", inline: true },
      { name: "🔗 Application Record", value: exact, inline: false },
      {
        name: "⚙️ How the real flow works",
        value: [
          "1. Applicant completes the live Google Form.",
          "2. Google writes the response to the Carrier Applications Sheet.",
          "3. The Apps Script creates an `APP-YYYY-####` record in the Application Records folder.",
          "4. That exact record URL is attached to the applicant's Discord ticket for staff.",
        ].join("\n"),
        inline: false,
      },
      { name: "🕒 Latest Activity", value: state.lastAction, inline: false },
    )],
    components: [
      row(
        button("demo_app_claim", "Take Review", ButtonStyle.Primary, "🙋"),
        button("demo_app_score", "Score", ButtonStyle.Secondary, "📊"),
        button("demo_app_interview", "Interview", ButtonStyle.Secondary, "🎙️"),
        button("demo_app_accept", "Accept", ButtonStyle.Success, "✅"),
        button("demo_app_deny", "Deny", ButtonStyle.Danger, "❌"),
      ),
      row(...links),
    ],
  };
}

function treasuryPayload(state, requesterId) {
  return {
    embeds: [baseEmbed(
      "💰 TREASURY REQUEST • TRE-TEST-001",
      "Treasury keeps its own transaction-focused controls and identity.",
      GREEN,
    ).addFields(
      { name: "👤 Requester", value: `<@${requesterId}>`, inline: true },
      { name: "📌 Status", value: STATUS[state.status], inline: true },
      { name: "💼 Treasurer", value: who(state.assigned), inline: true },
      { name: "⚠️ Priority", value: priorityLabel(state.priority), inline: true },
      { name: "💎 Item", value: "Enchanted Ice Rapier", inline: true },
      { name: "🔎 Ownership", value: state.verified ? "✅ Verified" : "🟡 Pending", inline: true },
      { name: "📎 Proof", value: state.proofRequested ? "🟣 Requested" : "Not requested", inline: true },
      { name: "📝 Private Notes", value: `**${state.notes}**`, inline: true },
      { name: "🕒 Latest Activity", value: state.lastAction, inline: false },
    )],
    components: [
      row(
        button("demo_tre_claim", "Claim", ButtonStyle.Primary, "🙋"),
        button("demo_tre_verify", "Verify Item", ButtonStyle.Secondary, "🔎"),
        button("demo_tre_proof", "Request Proof", ButtonStyle.Secondary, "📎"),
        button("demo_tre_approve", "Approve", ButtonStyle.Success, "✅"),
        button("demo_tre_reject", "Reject", ButtonStyle.Danger, "❌"),
      ),
      row(
        button("demo_tre_priority", "Priority", ButtonStyle.Secondary, "⚠️"),
        button("demo_tre_note", "Internal Note", ButtonStyle.Secondary, "📝"),
      ),
    ],
  };
}

function isClosed(status) {
  return ["resolved", "accepted", "approved", "denied", "rejected"].includes(status);
}

function dashboardPayload(states) {
  const cases = [states.support, states.carrier, states.treasury];
  const active = cases.filter((item) => !isClosed(item.status)).length;
  const unassigned = cases.filter((item) => !isClosed(item.status) && !item.assigned).length;
  const waiting = cases.filter((item) => item.status === "waiting").length;
  const escalated = cases.filter((item) => item.status === "escalated").length;
  const notes = cases.reduce((sum, item) => sum + Number(item.notes || 0), 0);

  const command = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • STAFF OPERATIONS" })
    .setTitle("📊 TICKET OPERATIONS COMMAND BOARD")
    .setDescription("`● LIVE TEST`  Staff should be able to understand workload and jump into the right case without opening every ticket channel.")
    .addFields(
      { name: "📥 Active", value: `## ${active}`, inline: true },
      { name: "👤 Unassigned", value: `## ${unassigned}`, inline: true },
      { name: "🟣 Waiting User", value: `## ${waiting}`, inline: true },
      { name: "🟠 Escalated", value: `## ${escalated}`, inline: true },
      { name: "📝 Private Notes", value: `## ${notes}`, inline: true },
      { name: "⚔️ Application System", value: "## CONNECTED", inline: true },
    )
    .setFooter({ text: "🧪 TEST MODE • Dashboard updates in-place" })
    .setTimestamp();

  const operations = new EmbedBuilder()
    .setColor(0xD49A00)
    .setTitle("🚨 OPERATIONS QUEUE")
    .addFields(
      {
        name: "🛟 SUPPORT • SUP-TEST-001",
        value: [
          `**Status:** ${STATUS[states.support.status]}`,
          `**Assigned:** ${who(states.support.assigned)}`,
          `**Priority:** ${priorityLabel(states.support.priority)}`,
          `**Last:** ${states.support.lastAction}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚔️ RECRUITMENT • APP-TEST-001",
        value: [
          `**Stage:** ${STATUS[states.carrier.status]}`,
          `**Reviewer:** ${who(states.carrier.assigned)}`,
          `**Score:** ${states.carrier.score == null ? "Not scored" : `${states.carrier.score}/20 • ${states.carrier.recommendation}`}`,
          `**Google Form:** ✅ Connected`,
          `**Exact record:** ${states.carrier.exactApplicationUrl ? "✅ Linked" : "🟡 Awaiting submission"}`,
          `**Last:** ${states.carrier.lastAction}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "💰 TREASURY • TRE-TEST-001",
        value: [
          `**Status:** ${STATUS[states.treasury.status]}`,
          `**Assigned:** ${who(states.treasury.assigned)}`,
          `**Priority:** ${priorityLabel(states.treasury.priority)}`,
          `**Ownership:** ${states.treasury.verified ? "✅ Verified" : "🟡 Pending"}`,
          `**Last:** ${states.treasury.lastAction}`,
        ].join("\n"),
        inline: false,
      },
    );

  const links = [
    linkButton("Support Case", channelUrl(states.guildId, states.channels.support), "🛟"),
    linkButton("Carrier Case", channelUrl(states.guildId, states.channels.carrier), "⚔️"),
    linkButton("Live Application", CARRIER_APPLICATION.publicUrl, "📝"),
    linkButton("Staff Review Sheet", CARRIER_APPLICATION.responseSheetUrl, "📊"),
    linkButton("Treasury Case", channelUrl(states.guildId, states.channels.treasury), "💰"),
  ];

  const components = [row(...links)];
  const records = [linkButton("Application Records", CARRIER_APPLICATION.recordsFolderUrl, "📁")];
  if (states.carrier.exactApplicationUrl) records.push(linkButton("Exact APP-TEST-001", states.carrier.exactApplicationUrl, "📄"));
  components.push(row(...records));

  return { embeds: [command, operations], components };
}

function noteModal(customId) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle("Add Internal Note")
    .addComponents(row(
      new TextInputBuilder()
        .setCustomId("note")
        .setLabel("Internal note")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(800),
    ));
}

function scoreModal() {
  return new ModalBuilder()
    .setCustomId("demo_app_score_modal")
    .setTitle("Score Carrier Application")
    .addComponents(
      row(
        new TextInputBuilder()
          .setCustomId("score")
          .setLabel("Total score (0-20)")
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(2),
      ),
      row(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Reviewer note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
}

async function createDemoCategory(interaction) {
  const guild = interaction.guild;
  const existing = guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === CATEGORY_NAME);
  if (existing) throw new Error(`A ${CATEGORY_NAME} category already exists. Run /ticket-v2-demo cleanup first.`);

  const category = await guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] },
    ],
    reason: `Ticket V2 demo requested by ${interaction.user.tag}`,
  });

  const definitions = [
    ["📊・test-dashboard", "Ticket V2 staff operations dashboard."],
    ["🛟・support-demo", "Interactive Support Ticket V2 preview."],
    ["⚔️・carrier-application-demo", "Carrier application preview connected to the real Google Form."],
    ["💰・treasury-demo", "Interactive Treasury Ticket V2 preview."],
  ];
  const channels = {};
  for (const [name, topic] of definitions) {
    channels[name] = await guild.channels.create({ name, type: ChannelType.GuildText, parent: category.id, topic });
  }
  return { category, channels };
}

async function destroyDemoCategory(interaction) {
  const category = interaction.guild.channels.cache.find((item) => item.type === ChannelType.GuildCategory && item.name === CATEGORY_NAME);
  if (!category) return 0;
  const children = interaction.guild.channels.cache.filter((item) => item.parentId === category.id);
  let count = 0;
  for (const channel of children.values()) {
    await channel.delete(`Ticket V2 demo cleanup by ${interaction.user.tag}`).catch(() => {});
    count += 1;
  }
  await category.delete(`Ticket V2 demo cleanup by ${interaction.user.tag}`).catch(() => {});
  return count;
}

async function addNote(interaction, state, message, payloadBuilder, dashboard, states) {
  const modalId = `${interaction.customId}_modal_${Date.now()}`;
  await interaction.showModal(noteModal(modalId));
  const submitted = await interaction.awaitModalSubmit({
    filter: (item) => item.customId === modalId && item.user.id === interaction.user.id,
    time: 120_000,
  }).catch(() => null);
  if (!submitted) return;
  state.notes += 1;
  state.lastAction = `Internal note added by ${submitted.user.username}`;
  await submitted.reply({ content: "✅ Internal demo note stored.", flags: MessageFlags.Ephemeral });
  await message.edit(payloadBuilder(state, states.requesterId));
  await dashboard.edit(dashboardPayload(states));
}

function installSupportCollector(message, dashboard, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (interaction) => {
    const state = states.support;
    try {
      if (interaction.customId === "demo_sup_note") return addNote(interaction, state, message, supportPayload, dashboard, states);
      if (interaction.customId === "demo_sup_claim") {
        state.assigned = interaction.user.id;
        state.status = "progress";
        state.lastAction = `Claimed by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_sup_wait") {
        state.status = "waiting";
        state.lastAction = `Waiting on requester set by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_sup_escalate") {
        state.status = "escalated";
        state.lastAction = `Escalated by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_sup_resolve") {
        state.status = "resolved";
        state.lastAction = `Resolved by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_sup_priority") {
        state.priority = cyclePriority(state.priority);
        state.lastAction = `Priority changed to ${state.priority}`;
      } else return;
      await interaction.update(supportPayload(state, states.requesterId));
      await dashboard.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 SUPPORT]", error);
    }
  });
}

function installCarrierCollector(message, dashboard, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (interaction) => {
    const state = states.carrier;
    try {
      if (interaction.customId === "demo_app_score") {
        await interaction.showModal(scoreModal());
        const submitted = await interaction.awaitModalSubmit({
          filter: (item) => item.customId === "demo_app_score_modal" && item.user.id === interaction.user.id,
          time: 120_000,
        }).catch(() => null);
        if (!submitted) return;
        const score = Number(submitted.fields.getTextInputValue("score").trim());
        if (!Number.isInteger(score) || score < 0 || score > 20) {
          return submitted.reply({ content: "❌ Enter a whole number from 0 to 20.", flags: MessageFlags.Ephemeral });
        }
        state.score = score;
        state.recommendation = score >= 17 ? "Strong Accept" : score >= 14 ? "Accept / Trial" : score >= 11 ? "Interview" : "Normally Deny";
        state.status = "review";
        state.assigned = state.assigned || submitted.user.id;
        state.lastAction = `Scored ${score}/20 by ${submitted.user.username}`;
        await submitted.reply({ content: `✅ Score saved: **${score}/20 • ${state.recommendation}**`, flags: MessageFlags.Ephemeral });
        await message.edit(carrierPayload(state, states.requesterId));
        return dashboard.edit(dashboardPayload(states));
      }

      if (interaction.customId === "demo_app_claim") {
        state.assigned = interaction.user.id;
        state.status = "review";
        state.lastAction = `Review taken by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_app_interview") {
        state.assigned = state.assigned || interaction.user.id;
        state.status = "interview";
        state.lastAction = `Interview started by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_app_accept") {
        state.assigned = state.assigned || interaction.user.id;
        state.status = "accepted";
        state.lastAction = `Accepted by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_app_deny") {
        state.assigned = state.assigned || interaction.user.id;
        state.status = "denied";
        state.lastAction = `Denied by ${interaction.user.username}`;
      } else return;
      await interaction.update(carrierPayload(state, states.requesterId));
      await dashboard.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 CARRIER]", error);
    }
  });
}

function installTreasuryCollector(message, dashboard, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (interaction) => {
    const state = states.treasury;
    try {
      if (interaction.customId === "demo_tre_note") return addNote(interaction, state, message, treasuryPayload, dashboard, states);
      if (interaction.customId === "demo_tre_claim") {
        state.assigned = interaction.user.id;
        state.status = "progress";
        state.lastAction = `Claimed by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_tre_verify") {
        state.assigned = state.assigned || interaction.user.id;
        state.verified = true;
        state.status = "progress";
        state.lastAction = `Item verified by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_tre_proof") {
        state.assigned = state.assigned || interaction.user.id;
        state.proofRequested = true;
        state.status = "waiting";
        state.lastAction = `Proof requested by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_tre_approve") {
        state.assigned = state.assigned || interaction.user.id;
        state.status = "approved";
        state.lastAction = `Approved by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_tre_reject") {
        state.assigned = state.assigned || interaction.user.id;
        state.status = "rejected";
        state.lastAction = `Rejected by ${interaction.user.username}`;
      } else if (interaction.customId === "demo_tre_priority") {
        state.priority = cyclePriority(state.priority);
        state.lastAction = `Priority changed to ${state.priority}`;
      } else return;
      await interaction.update(treasuryPayload(state, states.requesterId));
      await dashboard.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 TREASURY]", error);
    }
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("ticket-v2-demo")
    .setDescription("Create or remove an isolated interactive Ticket System V2 preview")
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Create the Ticket V2 test connected to the real Carrier application")
        .addStringOption((option) =>
          option
            .setName("exact_application")
            .setDescription("Optional exact APP-YYYY-#### Google Doc URL after a test submission")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("cleanup").setDescription("Delete the Ticket V2 test category and demo channels")),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canRun(interaction)) return interaction.editReply("❌ You do not have permission to run the Ticket V2 demo.");

    const action = interaction.options.getSubcommand();
    try {
      if (action === "cleanup") {
        const deleted = await destroyDemoCategory(interaction);
        return interaction.editReply(deleted
          ? `✅ Removed **${CATEGORY_NAME}** and ${deleted} demo channels. No real tickets were touched.`
          : `ℹ️ No **${CATEGORY_NAME}** category exists.`);
      }

      const rawExactUrl = interaction.options.getString("exact_application");
      const exactApplicationUrl = rawExactUrl ? validHttpUrl(rawExactUrl) : null;
      if (rawExactUrl && !exactApplicationUrl) {
        return interaction.editReply("❌ `exact_application` must be a valid http:// or https:// link.");
      }

      const { channels } = await createDemoCategory(interaction);
      const states = {
        guildId: interaction.guildId,
        requesterId: interaction.user.id,
        channels: {
          dashboard: channels["📊・test-dashboard"].id,
          support: channels["🛟・support-demo"].id,
          carrier: channels["⚔️・carrier-application-demo"].id,
          treasury: channels["💰・treasury-demo"].id,
        },
        support: { status: "open", assigned: null, priority: "Normal", notes: 0, lastAction: "Ticket created" },
        carrier: {
          status: "review",
          assigned: null,
          score: null,
          recommendation: "Not scored",
          exactApplicationUrl,
          lastAction: exactApplicationUrl ? "Real Carrier application record linked" : "Real Carrier Google Form connected",
        },
        treasury: { status: "open", assigned: null, priority: "Normal", verified: false, proofRequested: false, notes: 0, lastAction: "Request submitted" },
      };

      const dashboard = await channels["📊・test-dashboard"].send(dashboardPayload(states));
      const support = await channels["🛟・support-demo"].send(supportPayload(states.support, states.requesterId));
      const carrier = await channels["⚔️・carrier-application-demo"].send(carrierPayload(states.carrier, states.requesterId));
      const treasury = await channels["💰・treasury-demo"].send(treasuryPayload(states.treasury, states.requesterId));

      await dashboard.pin("Ticket V2 demo dashboard").catch(() => {});
      await support.pin("Ticket V2 Support demo").catch(() => {});
      await carrier.pin("Ticket V2 Carrier application demo").catch(() => {});
      await treasury.pin("Ticket V2 Treasury demo").catch(() => {});

      installSupportCollector(support, dashboard, states);
      installCarrierCollector(carrier, dashboard, states);
      installTreasuryCollector(treasury, dashboard, states);

      return interaction.editReply([
        `✅ Ticket V2 test rebuilt with the **real Carrier Team Application**: <#${states.channels.dashboard}>`,
        "",
        `⚔️ Carrier demo: <#${states.channels.carrier}>`,
        `📝 Live application: ${CARRIER_APPLICATION.publicUrl}`,
        `📊 Staff Review Sheet: ${CARRIER_APPLICATION.responseSheetUrl}`,
        "",
        exactApplicationUrl
          ? "📄 The demo also has an exact submitted application record attached."
          : "📄 There are currently no Form submissions, so there is no APP-YYYY-#### record to attach yet. After a test submission, the Apps Script creates one automatically.",
        "",
        "Your current real Support, Carrier ticket and Treasury systems are untouched.",
      ].join("\n").slice(0, 1900));
    } catch (error) {
      console.error("[TICKET V2 DEMO]", error);
      return interaction.editReply(`❌ Ticket V2 demo failed: ${error.message || "Unknown error"}`.slice(0, 1900));
    }
  },
};
