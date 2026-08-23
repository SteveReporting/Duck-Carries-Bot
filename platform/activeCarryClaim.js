const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { requireLinkedProfile } = require("./helpers");
const { canonicalizeDungeon, canonicalizeDifficulty } = require("./dungeons");

function safeChannelName(value) {
  return String(value || "carry")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45) || "carry";
}

function remainingRuns(request) {
  return Math.max(1, Number(request.runs_requested || 1) - Number(request.runs_completed || 0));
}

async function getTicketParent(guild, interaction) {
  if (process.env.TICKET_CATEGORY_ID) {
    const configured = await guild.channels.fetch(process.env.TICKET_CATEGORY_ID).catch(() => null);
    if (configured?.type === ChannelType.GuildCategory) return configured.id;
  }

  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guild.id);
  if (settings?.queueChannel) {
    const queueChannel = await guild.channels.fetch(settings.queueChannel).catch(() => null);
    if (queueChannel?.parentId) return queueChannel.parentId;
  }

  return interaction.channel?.parentId || null;
}

function ticketButtons(requestId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("carry_carrier_complete")
        .setLabel("Carrier Complete Session")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId("carry_release_claim")
        .setLabel("Release Claim")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("carry_show_ids")
        .setLabel("Show Request IDs")
        .setStyle(ButtonStyle.Primary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`carry_cancel_${requestId}`)
        .setLabel("Cancel Request")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`carry_delete_${requestId}`)
        .setLabel("Delete Request")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`carry_noshow_${requestId}`)
        .setLabel("Report No-Show")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function loadActiveClaims(carrierId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,availability,notes,status,claimed_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("carrier_id", carrierId)
    .in("status", ["claimed", "in_progress"])
    .order("claimed_at", { ascending: true });

  if (error) throw new Error(`Could not load your active carries: ${error.message}`);
  return data || [];
}

async function resolveExistingTicket(guild, request) {
  if (!request.ticket_channel_id) return null;
  const channel = await guild.channels.fetch(String(request.ticket_channel_id)).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) return null;
  return channel;
}

async function createMissingTicket(interaction, request, carrierProfile) {
  const supabase = getSupabase();
  const dungeon = canonicalizeDungeon(request.dungeon);
  const difficulty = canonicalizeDifficulty(request.difficulty);
  const sessionRuns = Number(request.session_runs || 0) > 0
    ? Math.min(remainingRuns(request), Number(request.session_runs))
    : remainingRuns(request);

  const requesterDiscordId = request.requester?.discord_id || null;
  const overwrites = [
    { id: interaction.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  if (requesterDiscordId && requesterDiscordId !== interaction.user.id) {
    overwrites.push({
      id: requesterDiscordId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  let ticket;
  try {
    ticket = await interaction.guild.channels.create({
      name: `carry-${safeChannelName(dungeon)}-${String(Date.now()).slice(-5)}`,
      type: ChannelType.GuildText,
      parent: await getTicketParent(interaction.guild, interaction),
      permissionOverwrites: overwrites,
      reason: `Repairing missing Carry Tavern ticket for ${interaction.user.tag}`,
    });

    const { data: attached, error: attachError } = await supabase
      .from("carry_requests")
      .update({
        ticket_channel_id: ticket.id,
        session_runs: sessionRuns,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("carrier_id", carrierProfile.id)
      .in("status", ["claimed", "in_progress"])
      .select("id")
      .maybeSingle();

    if (attachError) throw new Error(`Could not attach repaired ticket: ${attachError.message}`);
    if (!attached) throw new Error("The claim changed before the repaired ticket could be attached.");

    const requesterMention = requesterDiscordId ? `<@${requesterDiscordId}>` : "Requester";
    const roblox = request.requester?.roblox_username ? `@${request.requester.roblox_username}` : "Not linked";
    const embed = new EmbedBuilder()
      .setColor(0xc89532)
      .setTitle(`🍺 ${dungeon} • ${difficulty}`)
      .setDescription([
        "**Recovered Carry Ticket**",
        "This carry was already claimed before its Discord ticket was created, so the Tavern rebuilt it automatically.",
        "",
        `**Carrier:** <@${interaction.user.id}>`,
        `**Requester:** ${requesterMention}`,
        `**Roblox:** **${roblox}**`,
        `**Runs this session:** **${sessionRuns}**`,
        `**Request ID:** \`${request.id}\``,
        request.availability ? `**Availability:** ${request.availability}` : null,
        request.notes ? `**Notes:** ${request.notes}` : null,
        "",
        "The Carrier should press **Carrier Complete Session** when the runs are finished.",
        "Requester confirmation is not required.",
      ].filter(Boolean).join("\n"))
      .setFooter({ text: "The Carry Tavern • Recovered Private Carry Ticket" })
      .setTimestamp();

    await ticket.send({
      content: [
        `<@${interaction.user.id}>`,
        requesterDiscordId ? `<@${requesterDiscordId}>` : null,
      ].filter(Boolean).join(" "),
      embeds: [embed],
      components: ticketButtons(request.id),
    });

    if (requesterDiscordId) {
      try {
        const requester = await interaction.client.users.fetch(requesterDiscordId);
        await requester.send([
          `🍺 **Your ${dungeon} carry ticket has been restored.**`,
          `Difficulty: **${difficulty}**`,
          `Runs this session: **${sessionRuns}**`,
          `Carrier: <@${interaction.user.id}>`,
          `Private ticket: <#${ticket.id}>`,
        ].join("\n"));
      } catch (error) {
        console.warn(`[ACTIVE CARRY] Could not DM ${requesterDiscordId}:`, error.message);
      }
    }

    return ticket;
  } catch (error) {
    if (ticket) await ticket.delete("Recovered carry ticket setup failed").catch(() => {});
    throw error;
  }
}

async function viewOrRepairActiveClaims(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply("❌ Active carry claims can only be viewed inside the server.");
    return null;
  }

  const carrierProfile = await requireLinkedProfile(interaction, {
    alreadyDeferred: true,
    requireRoblox: false,
  });
  if (!carrierProfile) return null;

  const claims = await loadActiveClaims(carrierProfile.id);
  if (!claims.length) {
    await interaction.editReply("🍺 You do not currently have any active carry claims.");
    return [];
  }

  const lines = [];
  let repaired = 0;

  for (const request of claims) {
    const dungeon = canonicalizeDungeon(request.dungeon);
    const difficulty = canonicalizeDifficulty(request.difficulty);
    const runs = remainingRuns(request);

    let ticket = await resolveExistingTicket(interaction.guild, request);
    let repairError = null;

    if (!ticket) {
      try {
        ticket = await createMissingTicket(interaction, request, carrierProfile);
        repaired += 1;
      } catch (error) {
        repairError = error;
        console.error(`[ACTIVE CARRY] Could not repair ${request.id}:`, error);
      }
    }

    lines.push([
      `**🍺 ${dungeon} • ${difficulty}**`,
      `🏃 **${runs}** run${runs === 1 ? "" : "s"} remaining • 📌 ${request.status}`,
      ticket
        ? `🎟️ Ticket: <#${ticket.id}>${request.ticket_channel_id ? "" : " • **recovered now**"}`
        : `⚠️ Ticket could not be recovered: ${repairError?.message || "unknown error"}`,
      `ID: \`${request.id}\``,
    ].join("\n"));
  }

  await interaction.editReply([
    `⚔️ **Your Active Carry Claim${claims.length === 1 ? "" : "s"}**`,
    repaired ? `✅ Recovered **${repaired}** missing private ticket${repaired === 1 ? "" : "s"}.` : null,
    "",
    ...lines,
  ].filter(Boolean).join("\n\n").slice(0, 1900));

  return claims;
}

module.exports = {
  viewOrRepairActiveClaims,
};
