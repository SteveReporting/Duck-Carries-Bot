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

let timer = null;
let running = false;

function safeChannelName(value) {
  return String(value || "carry")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45) || "carry";
}

function remainingRuns(request) {
  return Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
}

async function getTicketParent(guild) {
  if (process.env.TICKET_CATEGORY_ID) {
    const configured = await guild.channels.fetch(process.env.TICKET_CATEGORY_ID).catch(() => null);
    if (configured?.type === ChannelType.GuildCategory) return configured.id;
  }

  const settings = db.prepare("SELECT queueChannel FROM settings WHERE guild = ?").get(guild.id);
  if (!settings?.queueChannel) return null;
  const queueChannel = await guild.channels.fetch(settings.queueChannel).catch(() => null);
  return queueChannel?.parentId || null;
}

async function loadRequest(requestId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,completed_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
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

function ratingButtons(requestId) {
  const row = new ActionRowBuilder();
  for (let score = 1; score <= 5; score += 1) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`carry_rate_${requestId}_${score}`)
        .setLabel(`${score} ⭐`)
        .setStyle(score === 5 ? ButtonStyle.Success : ButtonStyle.Secondary),
    );
  }
  return row;
}

async function createWebsiteTicket(client, request, actorId) {
  if (!request || request.status !== "claimed" || request.carrier_id !== actorId) {
    throw new Error("Carry is no longer reserved for this Carrier.");
  }
  if (request.ticket_channel_id) return request.ticket_channel_id;

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  const carrierDiscordId = request.carrier?.discord_id;
  const requesterDiscordId = request.requester?.discord_id;
  if (!carrierDiscordId) throw new Error("Carrier Discord identity is missing.");
  if (!requesterDiscordId) throw new Error("Requester Discord identity is missing.");

  // Ensure members are resolvable before creating permission overwrites.
  await Promise.all([
    guild.members.fetch(carrierDiscordId).catch(() => null),
    guild.members.fetch(requesterDiscordId).catch(() => null),
  ]);

  const ticket = await guild.channels.create({
    name: `carry-${safeChannelName(request.dungeon)}-${String(Date.now()).slice(-5)}`,
    type: ChannelType.GuildText,
    parent: await getTicketParent(guild),
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: client.user.id,
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
        id: carrierDiscordId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
      {
        id: requesterDiscordId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
      },
    ],
    reason: `Carry Tavern website claim by ${carrierDiscordId}`,
  });

  const supabase = getSupabase();
  const { data: attached, error: attachError } = await supabase.rpc("bot_attach_carry_ticket", {
    _request_ids: [request.id],
    _actor_id: actorId,
    _channel_id: ticket.id,
  });
  if (attachError || !attached?.length) {
    await ticket.delete("Website carry ticket attachment failed").catch(() => {});
    throw new Error(attachError?.message || "Could not attach carry ticket.");
  }

  const remaining = remainingRuns(request);
  const embed = new EmbedBuilder()
    .setTitle(`🍺 ${request.dungeon} • ${request.difficulty}`)
    .setDescription([
      `**Carrier:** <@${carrierDiscordId}>`,
      `**Requester:** <@${requesterDiscordId}>${request.requester?.roblox_username ? ` (@${request.requester.roblox_username})` : ""}`,
      `**Runs:** ${remaining}`,
      `**Request ID:** \`${request.id}\``,
      "",
      "This carry was claimed from **carrytavern.com**.",
      "The same controls work from Discord or from the website.",
      "When the runs are finished, the assigned Carrier can complete the carry from either place.",
    ].join("\n"))
    .setFooter({ text: "Website and Discord share the same live carry state." })
    .setTimestamp();

  await ticket.send({
    content: `<@${carrierDiscordId}> <@${requesterDiscordId}>`,
    embeds: [embed],
    components: ticketButtons(request.id),
  });

  try {
    const requester = await client.users.fetch(requesterDiscordId);
    await requester.send([
      `🍺 **Your ${request.dungeon} carry was claimed from the Tavern website.**`,
      `Carrier: <@${carrierDiscordId}>`,
      `Difficulty: **${request.difficulty}**`,
      `Runs: **${remaining}**`,
      `Request ID: \`${request.id}\``,
      `Private ticket: <#${ticket.id}>`,
    ].join("\n"));
  } catch (error) {
    console.warn(`[WEB CARRY] Could not DM requester ${requesterDiscordId}:`, error.message);
  }

  return ticket.id;
}

async function processClaim(client, action) {
  const request = await loadRequest(action.request_id);
  try {
    const ticketId = await createWebsiteTicket(client, request, action.actor_id);
    return { ticket_channel_id: ticketId };
  } catch (error) {
    // A website claim reserves the row before Discord performs its side effects.
    // If ticket creation fails, safely return only that untouched reservation to the queue.
    const supabase = getSupabase();
    await supabase
      .from("carry_requests")
      .update({
        carrier_id: null,
        status: "queued",
        claimed_at: null,
        started_at: null,
        ticket_channel_id: null,
        session_runs: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", action.request_id)
      .eq("carrier_id", action.actor_id)
      .eq("status", "claimed")
      .is("ticket_channel_id", null);
    throw error;
  }
}

async function closeTicket(client, channelId, message) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send(message).catch(() => {});
  setTimeout(() => channel.delete(message).catch(() => {}), 15_000).unref?.();
}

async function processRelease(client, action) {
  const request = await loadRequest(action.request_id);
  if (!request || !["claimed", "in_progress"].includes(request.status)) {
    throw new Error("Carry is no longer active.");
  }
  if (request.carrier_id !== action.actor_id) {
    const supabase = getSupabase();
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", action.actor_id);
    if (!(roles || []).some((row) => ["moderator", "administrator", "owner"].includes(row.role))) {
      throw new Error("Only the assigned Carrier can release this claim.");
    }
  }

  const channelId = request.ticket_channel_id;
  const supabase = getSupabase();
  if (channelId) {
    const { error } = await supabase.rpc("bot_release_carry_ticket", {
      _channel_id: channelId,
      _actor_id: action.actor_id,
    });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("carry_requests")
      .update({
        carrier_id: null,
        status: "queued",
        claimed_at: null,
        started_at: null,
        ticket_channel_id: null,
        session_runs: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", request.id)
      .eq("carrier_id", request.carrier_id)
      .in("status", ["claimed", "in_progress"]);
    if (error) throw new Error(error.message);
  }

  if (request.requester?.discord_id) {
    try {
      const user = await client.users.fetch(request.requester.discord_id);
      await user.send(`🍺 Your **${request.dungeon} • ${request.difficulty}** carry was returned to the queue because the Carrier released the claim from the website.`);
    } catch {}
  }

  await closeTicket(client, channelId, "🔒 The Carrier released this carry from the website. The request is back in the queue.");
  return { released: true };
}

async function processCancel(client, action) {
  const request = await loadRequest(action.request_id);
  if (!request || !["queued", "claimed", "in_progress"].includes(request.status)) {
    throw new Error("Carry request is no longer active.");
  }

  const supabase = getSupabase();
  const { data: actor } = await supabase.from("profiles").select("discord_id").eq("id", action.actor_id).maybeSingle();
  const { error } = await supabase
    .from("carry_requests")
    .update({
      status: "cancelled",
      cancel_reason: `cancelled via website by ${actor?.discord_id || action.actor_id}`.slice(0, 120),
      session_runs: null,
      carrier_confirmed_at: null,
      requester_confirmed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", request.id)
    .in("status", ["queued", "claimed", "in_progress"]);
  if (error) throw new Error(error.message);

  const participants = [request.requester?.discord_id, request.carrier?.discord_id]
    .filter(Boolean)
    .filter((id) => id !== actor?.discord_id);
  for (const id of participants) {
    try {
      const user = await client.users.fetch(id);
      await user.send(`❌ Carry request \`${request.id}\` for **${request.dungeon} • ${request.difficulty}** was cancelled from the Tavern website.`);
    } catch {}
  }

  await closeTicket(client, request.ticket_channel_id, "🔒 This carry request was cancelled from the website.");
  return { cancelled: true };
}

async function processFinish(client, action) {
  const request = await loadRequest(action.request_id);
  if (!request || !["claimed", "in_progress"].includes(request.status)) {
    throw new Error("Carry is no longer active.");
  }
  if (!request.ticket_channel_id) throw new Error("Discord ticket is not ready yet.");

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_complete_carry_session", {
    _channel_id: request.ticket_channel_id,
    _actor_id: action.actor_id,
    _service_minutes: 0,
  });
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("This carry session was already recorded.");

  const result = data.find((row) => row.id === request.id) || data[0];
  if (Number(result.runs_completed || 0) >= Number(result.runs_requested || 0)) {
    const now = new Date().toISOString();
    const { error: finalError } = await supabase
      .from("carry_requests")
      .update({ status: "completed", completed_at: now, session_runs: null, updated_at: now })
      .eq("id", request.id);
    if (finalError) throw new Error(finalError.message);
  }

  const refreshed = await loadRequest(request.id);
  if (refreshed?.requester?.discord_id) {
    try {
      const requester = await client.users.fetch(refreshed.requester.discord_id);
      await requester.send({
        content: [
          `✅ **Your ${refreshed.dungeon} carry is complete.**`,
          `Runs completed: **${refreshed.runs_requested}/${refreshed.runs_requested}**`,
          `Request ID: \`${refreshed.id}\``,
          "The assigned Carrier finished it from the Tavern website.",
          "You can rate the Carrier below.",
        ].join("\n"),
        components: [ratingButtons(refreshed.id)],
      });
    } catch {}
  }

  await closeTicket(client, request.ticket_channel_id, "✅ The Carrier marked this carry complete from the website.");
  return { completed: true, runs_completed: result.runs_completed };
}

async function processAction(client, action) {
  if (action.action === "claim") return processClaim(client, action);
  if (action.action === "release") return processRelease(client, action);
  if (action.action === "cancel") return processCancel(client, action);
  if (action.action === "finish") return processFinish(client, action);
  throw new Error(`Unsupported website carry action: ${action.action}`);
}

async function pollWebsiteCarryActions(client) {
  if (running) return;
  running = true;
  const supabase = getSupabase();
  try {
    const { data: actions, error } = await supabase
      .from("carry_web_actions")
      .select("id,request_id,actor_id,action,status,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);
    if (error) throw new Error(error.message);

    for (const action of actions || []) {
      const { data: locked, error: lockError } = await supabase
        .from("carry_web_actions")
        .update({ status: "processing", error: null })
        .eq("id", action.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (lockError) {
        console.warn(`[WEB CARRY] Could not lock action ${action.id}:`, lockError.message);
        continue;
      }
      if (!locked) continue;

      try {
        const result = await processAction(client, action);
        await supabase
          .from("carry_web_actions")
          .update({
            status: "completed",
            result: result || {},
            error: null,
            processed_at: new Date().toISOString(),
          })
          .eq("id", action.id);
        console.log(`[WEB CARRY] ${action.action} completed for ${action.request_id}`);
      } catch (actionError) {
        console.error(`[WEB CARRY] ${action.action} failed for ${action.request_id}:`, actionError);
        await supabase
          .from("carry_web_actions")
          .update({
            status: "failed",
            error: String(actionError?.message || actionError).slice(0, 1500),
            processed_at: new Date().toISOString(),
          })
          .eq("id", action.id);
      }
    }
  } catch (error) {
    // Keep old deployments usable until the new migration is applied.
    if (!String(error.message || "").includes("carry_web_actions")) {
      console.error("[WEB CARRY] Poll failed:", error);
    }
  } finally {
    running = false;
  }
}

function startWebsiteCarryActions(client) {
  if (timer) return;
  void pollWebsiteCarryActions(client);
  timer = setInterval(() => void pollWebsiteCarryActions(client), 3000);
  timer.unref?.();
  console.log("✅ Website carry claim/control bridge started.");
}

module.exports = { startWebsiteCarryActions, pollWebsiteCarryActions };
