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
const { hasAnyPlatformRole, requireLinkedProfile } = require("./helpers");
const { carrierCanHandle } = require("./communitySystems");
const { canonicalizeDungeon, canonicalizeDifficulty } = require("./dungeons");

const CARRIER_ROLES = ["carrier", "moderator", "administrator", "owner"];

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

async function rollbackClaim(supabase, requestId, carrierId) {
  await supabase
    .from("carry_requests")
    .update({
      carrier_id: null,
      status: "queued",
      claimed_at: null,
      started_at: null,
      ticket_channel_id: null,
      session_runs: null,
      carrier_confirmed_at: null,
      requester_confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("carrier_id", carrierId);
}

async function claimSpecificCarryWithTicket(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!interaction.guild) {
    await interaction.editReply("❌ Carry claims must be made inside the server.");
    return null;
  }

  const carrierProfile = await requireLinkedProfile(interaction, {
    alreadyDeferred: true,
    requireRoblox: false,
  });
  if (!carrierProfile) return null;

  const allowed = await hasAnyPlatformRole(carrierProfile.id, CARRIER_ROLES);
  if (!allowed) {
    await interaction.editReply("❌ You need the Tavern Carrier role to claim carry requests.");
    return null;
  }

  const requestId = interaction.options.getString("request", true).trim();
  const supabase = getSupabase();

  const { data: existing, error: existingError } = await supabase
    .from("carry_requests")
    .select("id,dungeon,difficulty,status")
    .eq("id", requestId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (!existing) {
    await interaction.editReply("❌ Carry request not found.");
    return null;
  }

  const dungeon = canonicalizeDungeon(existing.dungeon);
  const difficulty = canonicalizeDifficulty(existing.difficulty);
  if (!carrierCanHandle(interaction.guildId, interaction.user.id, dungeon, difficulty)) {
    await interaction.editReply(`❌ Your Carrier dungeon permissions do not allow **${dungeon} • ${difficulty}**.`);
    return null;
  }

  const { data: claimData, error: claimError } = await supabase.rpc("bot_claim_carry", {
    _request_id: requestId,
    _actor_id: carrierProfile.id,
  });
  if (claimError) throw new Error(claimError.message);
  if (!claimData || (Array.isArray(claimData) && !claimData.length)) {
    await interaction.editReply("❌ That carry was already claimed or is no longer available.");
    return null;
  }

  let ticket = null;
  try {
    const { data: request, error: requestError } = await supabase
      .from("carry_requests")
      .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,availability,notes,status,claimed_at,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
      .eq("id", requestId)
      .eq("carrier_id", carrierProfile.id)
      .maybeSingle();
    if (requestError) throw new Error(requestError.message);
    if (!request) throw new Error("The carry was claimed but could not be loaded for ticket creation.");

    const sessionRuns = remainingRuns(request);
    const { error: sessionError } = await supabase
      .from("carry_requests")
      .update({ session_runs: sessionRuns, updated_at: new Date().toISOString() })
      .eq("id", request.id)
      .eq("carrier_id", carrierProfile.id);
    if (sessionError) throw new Error(`Could not prepare the carry session: ${sessionError.message}`);
    request.session_runs = sessionRuns;

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
          PermissionFlagsBits.ManageChannels,
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

    ticket = await interaction.guild.channels.create({
      name: `carry-${safeChannelName(dungeon)}-${String(Date.now()).slice(-5)}`,
      type: ChannelType.GuildText,
      parent: await getTicketParent(interaction.guild, interaction),
      permissionOverwrites: overwrites,
      reason: `Carry Tavern carry claimed by ${interaction.user.tag}`,
    });

    const { error: attachError } = await supabase.rpc("bot_attach_carry_ticket", {
      _request_ids: [request.id],
      _actor_id: carrierProfile.id,
      _channel_id: ticket.id,
    });
    if (attachError) throw new Error(`Could not attach the private ticket: ${attachError.message}`);

    const requesterMention = requesterDiscordId ? `<@${requesterDiscordId}>` : "Requester";
    const roblox = request.requester?.roblox_username ? `@${request.requester.roblox_username}` : "Not linked";
    const embed = new EmbedBuilder()
      .setColor(0xc89532)
      .setTitle(`🍺 ${dungeon} • ${difficulty}`)
      .setDescription([
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
      .setFooter({ text: "The Carry Tavern • Private Carry Ticket" })
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
          `🍺 **Your ${dungeon} carry has been claimed.**`,
          `Difficulty: **${difficulty}**`,
          `Runs this session: **${sessionRuns}**`,
          `Carrier: <@${interaction.user.id}>`,
          `Private ticket: <#${ticket.id}>`,
        ].join("\n"));
      } catch (error) {
        console.warn(`[SINGLE CARRY TICKET] Could not DM ${requesterDiscordId}:`, error.message);
      }
    }

    await interaction.editReply([
      `✅ Carry **${dungeon} • ${difficulty}** claimed.`,
      `🎟️ Private ticket created: <#${ticket.id}>`,
      `🏃 **${sessionRuns}** run${sessionRuns === 1 ? "" : "s"} in this session.`,
    ].join("\n"));

    return { request, ticket };
  } catch (error) {
    if (ticket) await ticket.delete("Carry ticket setup failed").catch(() => {});
    await rollbackClaim(supabase, requestId, carrierProfile.id);
    throw error;
  }
}

module.exports = {
  claimSpecificCarryWithTicket,
};
