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

const STATUS = {
  new: "🆕 New",
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
  return value === "Urgent" ? "🔴 Urgent" : value === "High" ? "🟠 High" : "🟢 Normal";
}

function cyclePriority(current) {
  if (current === "Normal") return "High";
  if (current === "High") return "Urgent";
  return "Normal";
}

function validHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value).trim());
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

function channelUrl(guildId, channelId) {
  return `https://discord.com/channels/${guildId}/${channelId}`;
}

function baseEmbed(title, subtitle, colour = GOLD) {
  return new EmbedBuilder()
    .setColor(colour)
    .setAuthor({ name: "THE CARRY TAVERN • TICKET SYSTEM V2" })
    .setTitle(title)
    .setDescription(subtitle)
    .setFooter({ text: "🧪 TEST MODE • No real ticket records are being changed" })
    .setTimestamp();
}

function supportPayload(state, requesterId) {
  const embed = baseEmbed(
    "🛟 SUPPORT CASE • SUP-TEST-001",
    "Live Support case file. Staff actions update this panel in-place instead of filling the ticket with bot status messages.",
    BLUE,
  ).addFields(
    { name: "👤 Requester", value: `<@${requesterId}>`, inline: true },
    { name: "📌 Status", value: STATUS[state.status], inline: true },
    { name: "🙋 Assigned Staff", value: who(state.assigned), inline: true },
    { name: "⚠️ Priority", value: priorityLabel(state.priority), inline: true },
    { name: "🗂️ Issue Type", value: "Bot / Discord / Website", inline: true },
    { name: "📝 Internal Notes", value: `**${state.notes}** private note${state.notes === 1 ? "" : "s"}`, inline: true },
    {
      name: "📋 Request",
      value: "My verified Traveller role disappeared after I changed my Roblox account. I can still use Discord normally but the carry request system says I am not verified.",
      inline: false,
    },
    { name: "🕒 Latest Activity", value: `**${state.lastAction}**`, inline: false },
  );

  return {
    embeds: [embed],
    components: [
      row(
        button("demo_sup_claim", "Claim", ButtonStyle.Primary, "🙋"),
        button("demo_sup_wait", "Wait for User", ButtonStyle.Secondary, "🟣"),
        button("demo_sup_escalate", "Escalate", ButtonStyle.Danger, "⬆️"),
        button("demo_sup_resolve", "Resolve", ButtonStyle.Success, "✅"),
      ),
      row(
        button("demo_sup_priority", "Change Priority", ButtonStyle.Secondary, "⚠️"),
        button("demo_sup_note", "Internal Note", ButtonStyle.Secondary, "📝"),
      ),
    ],
  };
}

function carrierPayload(state, requesterId) {
  const score = state.score == null ? "`Not Scored`" : `**${state.score}/20** • ${state.recommendation}`;
  const applicationDisplay = state.applicationUrl
    ? `[Open exact submitted application](${state.applicationUrl})`
    : "`No application response linked in this demo`";

  const embed = baseEmbed(
    "⚔️ CARRIER APPLICATION • APP-TEST-001",
    "Recruitment case file. The applicant's exact submitted application stays permanently linked to this ticket for reviewers.",
    GOLD,
  ).addFields(
    { name: "👤 Applicant", value: `<@${requesterId}>`, inline: true },
    { name: "📌 Stage", value: STATUS[state.status], inline: true },
    { name: "📋 Reviewer", value: who(state.assigned), inline: true },
    { name: "🎮 Roblox", value: "`DemoRobloxUser`", inline: true },
    { name: "⚔️ DQ Level", value: "**200**", inline: true },
    { name: "📊 Application Score", value: score, inline: true },
    { name: "📄 Submitted Application", value: applicationDisplay, inline: false },
    {
      name: "🏰 Carry Capability",
      value: "Volcanic Chambers NM HC • Enchanted Forest INS HC • Group carries",
      inline: false,
    },
    {
      name: "📝 Applicant Snapshot",
      value: "I want to join Carrier Team because I enjoy helping players progress and I can be active most evenings. I understand all official Tavern carries are free.",
      inline: false,
    },
    {
      name: "🔎 Review State",
      value: `Internal notes: **${state.notes}** • Last action: **${state.lastAction}**`,
      inline: false,
    },
  );

  const secondRow = [button("demo_app_note", "Internal Note", ButtonStyle.Secondary, "📝")];
  if (state.applicationUrl) secondRow.push(linkButton("View Full Application", state.applicationUrl, "📄"));

  return {
    embeds: [embed],
    components: [
      row(
        button("demo_app_claim", "Take Review", ButtonStyle.Primary, "🙋"),
        button("demo_app_score", "Score", ButtonStyle.Secondary, "📊"),
        button("demo_app_interview", "Interview", ButtonStyle.Secondary, "🎙️"),
        button("demo_app_accept", "Accept", ButtonStyle.Success, "✅"),
        button("demo_app_deny", "Deny", ButtonStyle.Danger, "❌"),
      ),
      row(...secondRow),
    ],
  };
}

function treasuryPayload(state, requesterId) {
  const embed = baseEmbed(
    "💰 TREASURY REQUEST • TRE-TEST-001",
    "Treasury keeps a transaction-style case file with ownership, proof and approval states.",
    GREEN,
  ).addFields(
    { name: "👤 Requester", value: `<@${requesterId}>`, inline: true },
    { name: "📌 Status", value: STATUS[state.status], inline: true },
    { name: "💼 Treasurer", value: who(state.assigned), inline: true },
    { name: "⚠️ Priority", value: priorityLabel(state.priority), inline: true },
    { name: "💎 Item", value: "Enchanted Ice Rapier", inline: true },
    { name: "🔎 Ownership", value: state.verified ? "✅ **Verified**" : "🟡 `Not Verified`", inline: true },
    { name: "💵 Requested Price", value: "**25B Gold**", inline: true },
    { name: "📎 Proof", value: state.proofRequested ? "🟣 **Requested from user**" : "`Not requested`", inline: true },
    { name: "📝 Internal Notes", value: `**${state.notes}** private note${state.notes === 1 ? "" : "s"}`, inline: true },
    { name: "📋 Request", value: "Requester wants the item reviewed and approved for a Marketplace listing.", inline: false },
    { name: "🕒 Latest Activity", value: `**${state.lastAction}**`, inline: false },
  );

  return {
    embeds: [embed],
    components: [
      row(
        button("demo_tre_claim", "Claim", ButtonStyle.Primary, "🙋"),
        button("demo_tre_verify", "Verify Item", ButtonStyle.Secondary, "🔎"),
        button("demo_tre_proof", "Request Proof", ButtonStyle.Secondary, "📎"),
        button("demo_tre_approve", "Approve", ButtonStyle.Success, "✅"),
        button("demo_tre_reject", "Reject", ButtonStyle.Danger, "❌"),
      ),
      row(
        button("demo_tre_priority", "Change Priority", ButtonStyle.Secondary, "⚠️"),
        button("demo_tre_note", "Internal Note", ButtonStyle.Secondary, "📝"),
      ),
    ],
  };
}

function statusIsClosed(status) {
  return ["resolved", "accepted", "approved", "denied", "rejected"].includes(status);
}

function attentionLine(label, id, state, channelId) {
  const critical = state.status === "escalated" || state.priority === "Urgent";
  const waiting = state.status === "waiting";
  const unassigned = !state.assigned && !statusIsClosed(state.status);
  const marker = critical ? "🔴" : waiting ? "🟣" : unassigned ? "🟡" : "🔵";
  return `${marker} **${id}** • <#${channelId}>\n${STATUS[state.status]} • ${who(state.assigned)}${state.priority ? ` • ${priorityLabel(state.priority)}` : ""}`;
}

function dashboardPayload(states) {
  const all = [states.support, states.carrier, states.treasury];
  const open = all.filter((s) => !statusIsClosed(s.status)).length;
  const unassigned = all.filter((s) => !statusIsClosed(s.status) && !s.assigned).length;
  const waiting = all.filter((s) => s.status === "waiting").length;
  const escalated = all.filter((s) => s.status === "escalated").length;
  const urgent = all.filter((s) => s.priority === "Urgent" && !statusIsClosed(s.status)).length;
  const notes = all.reduce((sum, s) => sum + Number(s.notes || 0), 0);

  const command = new EmbedBuilder()
    .setColor(GOLD)
    .setAuthor({ name: "THE CARRY TAVERN • STAFF OPERATIONS" })
    .setTitle("📊 TICKET OPERATIONS COMMAND BOARD")
    .setDescription([
      "`● LIVE DEMO`  One glance should tell staff what needs attention without opening every ticket.",
      "",
      `**${open}** active case${open === 1 ? "" : "s"} across Support, Carrier Recruitment and Treasury.`,
    ].join("\n"))
    .addFields(
      { name: "📥 Active", value: `## ${open}`, inline: true },
      { name: "👤 Unassigned", value: `## ${unassigned}`, inline: true },
      { name: "🟣 Waiting User", value: `## ${waiting}`, inline: true },
      { name: "🟠 Escalated", value: `## ${escalated}`, inline: true },
      { name: "🔴 Urgent", value: `## ${urgent}`, inline: true },
      { name: "📝 Private Notes", value: `## ${notes}`, inline: true },
    )
    .setFooter({ text: "🧪 TEST MODE • Dashboard edits in-place with every ticket action" })
    .setTimestamp();

  const queue = new EmbedBuilder()
    .setColor(0xD49A00)
    .setTitle("🚨 NEEDS ATTENTION")
    .setDescription([
      attentionLine("Support", "SUP-TEST-001", states.support, states.channels.support),
      "",
      attentionLine("Carrier", "APP-TEST-001", states.carrier, states.channels.carrier),
      "",
      attentionLine("Treasury", "TRE-TEST-001", states.treasury, states.channels.treasury),
    ].join("\n"))
    .addFields(
      {
        name: "🛟 SUPPORT OPERATIONS",
        value: [
          `**Case:** SUP-TEST-001`,
          `**Status:** ${STATUS[states.support.status]}`,
          `**Owner:** ${who(states.support.assigned)}`,
          `**Priority:** ${priorityLabel(states.support.priority)}`,
          `**Last Action:** ${states.support.lastAction}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "⚔️ RECRUITMENT PIPELINE",
        value: [
          `**Application:** APP-TEST-001`,
          `**Stage:** ${STATUS[states.carrier.status]}`,
          `**Reviewer:** ${who(states.carrier.assigned)}`,
          `**Score:** ${states.carrier.score == null ? "Not scored" : `${states.carrier.score}/20 • ${states.carrier.recommendation}`}`,
          `**Submission:** ${states.carrier.applicationUrl ? "✅ Exact response linked" : "⚠️ No response URL linked"}`,
          `**Last Action:** ${states.carrier.lastAction}`,
        ].join("\n"),
        inline: false,
      },
      {
        name: "💰 TREASURY OPERATIONS",
        value: [
          `**Case:** TRE-TEST-001`,
          `**Status:** ${STATUS[states.treasury.status]}`,
          `**Treasurer:** ${who(states.treasury.assigned)}`,
          `**Priority:** ${priorityLabel(states.treasury.priority)}`,
          `**Ownership:** ${states.treasury.verified ? "✅ Verified" : "🟡 Pending"}`,
          `**Last Action:** ${states.treasury.lastAction}`,
        ].join("\n"),
        inline: false,
      },
    );

  const links = [
    linkButton("Support Case", channelUrl(states.guildId, states.channels.support), "🛟"),
    linkButton("Carrier Application", channelUrl(states.guildId, states.channels.carrier), "⚔️"),
    linkButton("Treasury Case", channelUrl(states.guildId, states.channels.treasury), "💰"),
  ];
  if (states.carrier.applicationUrl) {
    links.splice(2, 0, linkButton("View Exact Application", states.carrier.applicationUrl, "📄"));
  }

  return { embeds: [command, queue], components: [row(...links)] };
}

function noteModal(customId, title) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("note")
          .setLabel("Internal note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setMaxLength(800),
      ),
    );
}

function scoreModal() {
  return new ModalBuilder()
    .setCustomId("demo_app_score_modal")
    .setTitle("Score Carrier Application")
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("score")
          .setLabel("Total score (0-20)")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("16")
          .setRequired(true)
          .setMaxLength(2),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId("reason")
          .setLabel("Short reviewer note")
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setMaxLength(500),
      ),
    );
}

async function createDemoCategory(interaction) {
  const guild = interaction.guild;
  const existing = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME);
  if (existing) throw new Error(`A ${CATEGORY_NAME} category already exists. Run /ticket-v2-demo cleanup first.`);

  const category = await guild.channels.create({
    name: CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: interaction.client.user.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages],
      },
    ],
    reason: `Ticket V2 isolated demo requested by ${interaction.user.tag}`,
  });

  const channelDefs = [
    ["📊・test-dashboard", "Live Ticket V2 staff operations command board."],
    ["🛟・support-demo", "Interactive Support Ticket V2 preview."],
    ["⚔️・carrier-application-demo", "Interactive Carrier Application Ticket V2 preview with exact application linking."],
    ["💰・treasury-demo", "Interactive Treasury Ticket V2 preview."],
  ];
  const channels = {};
  for (const [name, topic] of channelDefs) {
    channels[name] = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category.id,
      topic,
      reason: `Ticket V2 isolated demo requested by ${interaction.user.tag}`,
    });
  }
  return { category, channels };
}

async function destroyDemoCategory(interaction) {
  const guild = interaction.guild;
  const category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === CATEGORY_NAME);
  if (!category) return 0;
  const children = guild.channels.cache.filter((c) => c.parentId === category.id);
  let deleted = 0;
  for (const channel of children.values()) {
    await channel.delete(`Ticket V2 demo cleanup by ${interaction.user.tag}`).catch(() => {});
    deleted += 1;
  }
  await category.delete(`Ticket V2 demo cleanup by ${interaction.user.tag}`).catch(() => {});
  return deleted;
}

async function addNoteFromButton(component, state, message, payloadBuilder, dashboardMessage, states) {
  const modalId = `${component.customId}_modal_${Date.now()}`;
  await component.showModal(noteModal(modalId, "Add Internal Note"));
  const submitted = await component.awaitModalSubmit({
    filter: (i) => i.customId === modalId && i.user.id === component.user.id,
    time: 120_000,
  }).catch(() => null);
  if (!submitted) return;
  state.notes += 1;
  state.lastAction = `Internal note added by ${component.user.username}`;
  await submitted.reply({ content: "✅ Demo internal note stored. Only the note count is shown to the case panel.", flags: MessageFlags.Ephemeral });
  await message.edit(payloadBuilder(state, states.requesterId));
  await dashboardMessage.edit(dashboardPayload(states));
}

function installSupportCollector(message, dashboardMessage, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (i) => {
    const s = states.support;
    try {
      if (i.customId === "demo_sup_note") return addNoteFromButton(i, s, message, supportPayload, dashboardMessage, states);
      if (i.customId === "demo_sup_claim") {
        s.assigned = i.user.id;
        s.status = "progress";
        s.lastAction = `Claimed by ${i.user.username}`;
      } else if (i.customId === "demo_sup_wait") {
        s.status = "waiting";
        s.lastAction = `Waiting on requester set by ${i.user.username}`;
      } else if (i.customId === "demo_sup_escalate") {
        s.status = "escalated";
        s.lastAction = `Escalated by ${i.user.username}`;
      } else if (i.customId === "demo_sup_resolve") {
        s.status = "resolved";
        s.lastAction = `Resolved by ${i.user.username}`;
      } else if (i.customId === "demo_sup_priority") {
        s.priority = cyclePriority(s.priority);
        s.lastAction = `Priority changed to ${s.priority}`;
      } else return;
      await i.update(supportPayload(s, states.requesterId));
      await dashboardMessage.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 DEMO SUPPORT]", error);
      if (!i.replied && !i.deferred) await i.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}

function installCarrierCollector(message, dashboardMessage, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (i) => {
    const s = states.carrier;
    try {
      if (i.customId === "demo_app_note") return addNoteFromButton(i, s, message, carrierPayload, dashboardMessage, states);
      if (i.customId === "demo_app_score") {
        await i.showModal(scoreModal());
        const submitted = await i.awaitModalSubmit({
          filter: (m) => m.customId === "demo_app_score_modal" && m.user.id === i.user.id,
          time: 120_000,
        }).catch(() => null);
        if (!submitted) return;
        const value = Number(submitted.fields.getTextInputValue("score").trim());
        if (!Number.isInteger(value) || value < 0 || value > 20) {
          return submitted.reply({ content: "❌ Enter a whole number from 0 to 20.", flags: MessageFlags.Ephemeral });
        }
        s.score = value;
        s.recommendation = value >= 17 ? "Strong Accept" : value >= 14 ? "Accept / Trial" : value >= 11 ? "Interview" : "Normally Deny";
        s.status = "review";
        s.assigned = s.assigned || submitted.user.id;
        s.lastAction = `Scored ${value}/20 by ${submitted.user.username}`;
        await submitted.reply({ content: `✅ Demo score saved: **${value}/20 • ${s.recommendation}**`, flags: MessageFlags.Ephemeral });
        await message.edit(carrierPayload(s, states.requesterId));
        return dashboardMessage.edit(dashboardPayload(states));
      }

      if (i.customId === "demo_app_claim") {
        s.assigned = i.user.id;
        s.status = "review";
        s.lastAction = `Review taken by ${i.user.username}`;
      } else if (i.customId === "demo_app_interview") {
        s.assigned = s.assigned || i.user.id;
        s.status = "interview";
        s.lastAction = `Interview stage started by ${i.user.username}`;
      } else if (i.customId === "demo_app_accept") {
        s.assigned = s.assigned || i.user.id;
        s.status = "accepted";
        s.lastAction = `Accepted by ${i.user.username}`;
      } else if (i.customId === "demo_app_deny") {
        s.assigned = s.assigned || i.user.id;
        s.status = "denied";
        s.lastAction = `Denied by ${i.user.username}`;
      } else return;
      await i.update(carrierPayload(s, states.requesterId));
      await dashboardMessage.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 DEMO CARRIER]", error);
      if (!i.replied && !i.deferred) await i.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
  });
}

function installTreasuryCollector(message, dashboardMessage, states) {
  const collector = message.createMessageComponentCollector({ time: 2 * 60 * 60 * 1000 });
  collector.on("collect", async (i) => {
    const s = states.treasury;
    try {
      if (i.customId === "demo_tre_note") return addNoteFromButton(i, s, message, treasuryPayload, dashboardMessage, states);
      if (i.customId === "demo_tre_claim") {
        s.assigned = i.user.id;
        s.status = "progress";
        s.lastAction = `Claimed by ${i.user.username}`;
      } else if (i.customId === "demo_tre_verify") {
        s.assigned = s.assigned || i.user.id;
        s.verified = true;
        s.status = "progress";
        s.lastAction = `Item verified by ${i.user.username}`;
      } else if (i.customId === "demo_tre_proof") {
        s.assigned = s.assigned || i.user.id;
        s.proofRequested = true;
        s.status = "waiting";
        s.lastAction = `Proof requested by ${i.user.username}`;
      } else if (i.customId === "demo_tre_approve") {
        s.assigned = s.assigned || i.user.id;
        s.status = "approved";
        s.lastAction = `Approved by ${i.user.username}`;
      } else if (i.customId === "demo_tre_reject") {
        s.assigned = s.assigned || i.user.id;
        s.status = "rejected";
        s.lastAction = `Rejected by ${i.user.username}`;
      } else if (i.customId === "demo_tre_priority") {
        s.priority = cyclePriority(s.priority);
        s.lastAction = `Priority changed to ${s.priority}`;
      } else return;
      await i.update(treasuryPayload(s, states.requesterId));
      await dashboardMessage.edit(dashboardPayload(states));
    } catch (error) {
      console.error("[TICKET V2 DEMO TREASURY]", error);
      if (!i.replied && !i.deferred) await i.reply({ content: `❌ ${error.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
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
        .setDescription("Create the private interactive Ticket V2 test category")
        .addStringOption((option) =>
          option
            .setName("application_url")
            .setDescription("Exact submitted Carrier application URL to link to APP-TEST-001")
            .setRequired(false)
        )
    )
    .addSubcommand((sub) => sub.setName("cleanup").setDescription("Delete the Ticket V2 test category and its demo channels")),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    if (!canRun(interaction)) {
      return interaction.editReply("❌ You do not have permission to run the Ticket V2 demo.");
    }

    const action = interaction.options.getSubcommand();
    try {
      if (action === "cleanup") {
        const deleted = await destroyDemoCategory(interaction);
        return interaction.editReply(deleted
          ? `✅ Removed **${CATEGORY_NAME}** and ${deleted} demo channel${deleted === 1 ? "" : "s"}. No real tickets were touched.`
          : `ℹ️ No **${CATEGORY_NAME}** category exists.`);
      }

      const rawApplicationUrl = interaction.options.getString("application_url");
      const applicationUrl = rawApplicationUrl ? validHttpUrl(rawApplicationUrl) : null;
      if (rawApplicationUrl && !applicationUrl) {
        return interaction.editReply("❌ `application_url` must be a valid http:// or https:// link.");
      }

      const { category, channels } = await createDemoCategory(interaction);
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
          notes: 0,
          applicationUrl,
          lastAction: applicationUrl ? "Application submitted and exact response linked" : "Application submitted",
        },
        treasury: { status: "open", assigned: null, priority: "Normal", verified: false, proofRequested: false, notes: 0, lastAction: "Request submitted" },
      };

      const dashboard = await channels["📊・test-dashboard"].send(dashboardPayload(states));
      const support = await channels["🛟・support-demo"].send(supportPayload(states.support, states.requesterId));
      const carrier = await channels["⚔️・carrier-application-demo"].send(carrierPayload(states.carrier, states.requesterId));
      const treasury = await channels["💰・treasury-demo"].send(treasuryPayload(states.treasury, states.requesterId));

      await dashboard.pin("Ticket V2 demo command board").catch(() => {});
      await support.pin("Ticket V2 Support demo").catch(() => {});
      await carrier.pin("Ticket V2 Carrier application demo").catch(() => {});
      await treasury.pin("Ticket V2 Treasury demo").catch(() => {});

      installSupportCollector(support, dashboard, states);
      installCarrierCollector(carrier, dashboard, states);
      installTreasuryCollector(treasury, dashboard, states);

      return interaction.editReply([
        `✅ Created upgraded isolated **${CATEGORY_NAME}** preview: <#${states.channels.dashboard}>`,
        "",
        `🛟 <#${states.channels.support}>`,
        `⚔️ <#${states.channels.carrier}>`,
        `💰 <#${states.channels.treasury}>`,
        "",
        applicationUrl
          ? "📄 **APP-TEST-001 is linked to the exact application URL you supplied.** Staff can open it from both the recruitment ticket and the dashboard."
          : "⚠️ No application URL was supplied, so the demo shows the unlinked state. Recreate it with `application_url` to test the exact-response workflow.",
        "",
        "The dashboard and ticket panels update in-place. Nothing is connected to the real Support, Carrier Application or Treasury systems.",
        "",
        "When finished: `/ticket-v2-demo cleanup`",
      ].join("\n"));
    } catch (error) {
      console.error("[TICKET V2 DEMO]", error);
      return interaction.editReply(`❌ Ticket V2 demo failed: ${error.message || "Unknown error"}`.slice(0, 1900));
    }
  },
};