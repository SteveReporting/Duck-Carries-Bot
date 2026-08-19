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
const {
  getLinkedProfile,
  hasAnyPlatformRole,
  marketplaceBaseUrl,
} = require("./helpers");
const {
  canonicalizeDungeon,
  canonicalizeDifficulty,
  groupKey,
} = require("./dungeons");
const {
  carrierCanHandle,
  carrierReputation,
  maybeSendAbuseAlert,
  recordCarrierRating,
  recordNoShow,
} = require("./communitySystems");

const CARRIER_PLATFORM_ROLES = ["carrier", "moderator", "administrator", "owner"];
const STAFF_PLATFORM_ROLES = ["moderator", "administrator", "owner"];
const MIN_NOSHOW_WAIT_MS = 15 * 60 * 1000;

function remainingRuns(request) {
  return Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
}

function plannedSessionRuns(request) {
  const remaining = remainingRuns(request);
  const planned = Number(request.session_runs || remaining || 1);
  return Math.max(0, Math.min(remaining, planned));
}

function requesterLabel(request) {
  const roblox = request.requester?.roblox_username;
  const discord = request.requester?.discord_display_name || request.requester?.discord_username;
  return String(roblox || discord || "Requester").slice(0, 50);
}

function shortId(id) {
  return String(id || "").slice(0, 8);
}

async function loadPlatformQueue({ statuses = ["queued", "claimed", "in_progress"], limit = 150 } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,availability,notes,status,claimed_at,started_at,completed_at,created_at,updated_at,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load the shared queue: ${error.message}`);
  return data || [];
}

function groupWaitingRequests(rows) {
  const groups = new Map();
  for (const row of rows.filter((r) => r.status === "queued" && remainingRuns(r) > 0)) {
    const dungeon = canonicalizeDungeon(row.dungeon);
    const difficulty = canonicalizeDifficulty(row.difficulty);
    const key = groupKey(dungeon, difficulty);
    const group = groups.get(key) || {
      key,
      dungeon,
      difficulty,
      requests: [],
      runTiers: new Set(),
      oldestAt: row.created_at,
    };
    group.requests.push(row);
    group.runTiers.add(remainingRuns(row));
    if (new Date(row.created_at).getTime() < new Date(group.oldestAt).getTime()) {
      group.oldestAt = row.created_at;
    }
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => ({ ...group, runTiers: [...group.runTiers].sort((a, b) => a - b) }))
    .sort((a, b) => new Date(a.oldestAt).getTime() - new Date(b.oldestAt).getTime());
}

async function requireCarrierProfile(interaction, { alreadyDeferred = false } = {}) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    const base = marketplaceBaseUrl();
    const text = `❌ Link your Tavern account before claiming carries.${base ? `\nSign in with Discord: ${base}/auth` : ""}`;
    if (alreadyDeferred) await interaction.editReply(text);
    else await interaction.reply({ content: text, ephemeral: true });
    return null;
  }

  const allowed = await hasAnyPlatformRole(profile.id, CARRIER_PLATFORM_ROLES);
  if (!allowed) {
    const text = "❌ You need a Tavern Carrier role to claim carries.";
    if (alreadyDeferred) await interaction.editReply(text);
    else await interaction.reply({ content: text, ephemeral: true });
    return null;
  }

  return profile;
}

function finishingThisSession(request) {
  const remaining = remainingRuns(request);
  return remaining > 0 && plannedSessionRuns(request) >= remaining;
}

function initialTicketComponents() {
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
  ];
}

function requestControlComponents(requestId) {
  return [
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

function safeChannelName(value) {
  return String(value || "carry")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 45) || "carry";
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

function ticketRequestLine(request) {
  const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
  const roblox = request.requester?.roblox_username ? ` (@${request.requester.roblox_username})` : "";
  const remaining = remainingRuns(request);
  const session = plannedSessionRuns(request);
  const after = Math.max(0, remaining - session);
  const outcome = after === 0 ? "✅ finishes this session" : `➡️ **${after}** left after this session`;
  return [
    `${mention}${roblox} • **${remaining}** left • **${session}** this session • ${outcome}`,
    `↳ Request ID: \`${request.id}\``,
  ].join("\n");
}

function requestControlEmbed(request) {
  const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
  const roblox = request.requester?.roblox_username ? `@${request.requester.roblox_username}` : "Not linked";
  return new EmbedBuilder()
    .setTitle(`Request Controls • ${requesterLabel(request)}`)
    .setDescription([
      `Requester: ${mention}`,
      `Roblox: **${roblox}**`,
      `Request ID: \`${request.id}\``,
      "",
      "**Cancel Request** removes this request from the active carry.",
      "**Delete Request** removes it from the active system while preserving an audit record.",
      "**Report No-Show** can be used by either side after the 15-minute wait.",
    ].join("\n"));
}

async function createCarryTicket(interaction, requests, carrierProfile) {
  const guild = interaction.guild;
  if (!guild || !requests.length) throw new Error("No carries were selected.");

  const requesterDiscordIds = [...new Set(requests.map((r) => r.requester?.discord_id).filter(Boolean))];
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
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
    ...requesterDiscordIds.map((id) => ({
      id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  const ticket = await guild.channels.create({
    name: `carry-${safeChannelName(requests[0].dungeon)}-${String(Date.now()).slice(-5)}`,
    type: ChannelType.GuildText,
    parent: await getTicketParent(guild),
    permissionOverwrites: overwrites,
    reason: `Carry Tavern grouped carry claimed by ${interaction.user.tag}`,
  });

  const supabase = getSupabase();
  const requestIds = requests.map((r) => r.id);
  const { error: attachError } = await supabase.rpc("bot_attach_carry_ticket", {
    _request_ids: requestIds,
    _actor_id: carrierProfile.id,
    _channel_id: ticket.id,
  });

  if (attachError) {
    await supabase.from("carry_requests").update({
      carrier_id: null,
      status: "queued",
      claimed_at: null,
      ticket_channel_id: null,
      session_runs: null,
    }).in("id", requestIds).eq("carrier_id", carrierProfile.id);
    await ticket.delete("Ticket setup failed").catch(() => {});
    throw new Error(`Could not attach the private ticket: ${attachError.message}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`🍺 ${requests[0].dungeon} • ${requests[0].difficulty}`)
    .setDescription([
      `**Carrier:** <@${interaction.user.id}>`,
      `**Requests included:** ${requests.length}`,
      "",
      ...requests.map(ticketRequestLine),
      "",
      "Only the assigned **Carrier** needs to press **Carrier Complete Session** when the run batch is finished.",
      "Requesters do **not** need to press a second completion button.",
      "Anyone with runs left is automatically updated and returned to the queue with only the remaining runs needed.",
      "Each request has its own controls below for cancel, delete and no-show reporting.",
    ].join("\n"))
    .setFooter({ text: "The Carrier completion button is authoritative for session completion." })
    .setTimestamp();

  await ticket.send({
    content: [`<@${interaction.user.id}>`, ...requesterDiscordIds.map((id) => `<@${id}>`)].join(" "),
    embeds: [embed],
    components: initialTicketComponents(),
  });

  for (const request of requests) {
    await ticket.send({
      embeds: [requestControlEmbed(request)],
      components: requestControlComponents(request.id),
    });

    const discordId = request.requester?.discord_id;
    if (!discordId) continue;

    try {
      const user = await interaction.client.users.fetch(discordId);
      const remaining = remainingRuns(request);
      const session = plannedSessionRuns(request);
      const after = Math.max(0, remaining - session);
      await user.send([
        `🍺 **Your ${request.dungeon} carry joined a Carrier session.**`,
        `Difficulty: **${request.difficulty}**`,
        `Runs currently needed: **${remaining}**`,
        `Runs planned this session: **${session}**`,
        after
          ? `If the planned runs finish, you will have **${after}** left and will automatically return to the queue.`
          : "If the planned runs finish, the Carrier can mark your request complete. You do not need to confirm it yourself.",
        `Carrier: <@${interaction.user.id}>`,
        `Request ID: \`${request.id}\``,
        `Private ticket: <#${ticket.id}>`,
      ].join("\n"));
    } catch (error) {
      console.warn(`[CARRY TICKET] Could not DM ${discordId}:`, error.message);
    }
  }

  return ticket;
}

async function claimCarryGroup(interaction, { dungeon, difficulty, maxRuns }) {
  await interaction.deferReply({ ephemeral: true });
  const carrierProfile = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!carrierProfile) return null;

  const canonicalDungeon = canonicalizeDungeon(dungeon);
  const canonicalDifficulty = canonicalizeDifficulty(difficulty);
  if (!carrierCanHandle(interaction.guildId, interaction.user.id, canonicalDungeon, canonicalDifficulty)) {
    await interaction.editReply(`❌ Your Carrier dungeon permissions do not allow **${canonicalDungeon} • ${canonicalDifficulty}**.`);
    return null;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_claim_carry_group", {
    _actor_id: carrierProfile.id,
    _dungeon: canonicalDungeon,
    _difficulty: canonicalDifficulty,
    _max_runs: Number(maxRuns),
  });
  if (error) throw new Error(error.message);
  if (!data?.length) {
    await interaction.editReply("❌ Those requests were already claimed or are no longer available.");
    return null;
  }

  const requesterIds = [...new Set(data.map((r) => r.requester_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("profiles")
    .select("id,discord_id,discord_username,discord_display_name,roblox_username")
    .in("id", requesterIds);
  if (profileError) throw new Error(profileError.message);

  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const requests = data.map((r) => ({
    ...r,
    dungeon: canonicalizeDungeon(r.dungeon),
    difficulty: canonicalizeDifficulty(r.difficulty),
    requester: profileMap.get(r.requester_id) || null,
  }));

  let ticket;
  try {
    ticket = await createCarryTicket(interaction, requests, carrierProfile);
  } catch (error) {
    await supabase.from("carry_requests").update({
      carrier_id: null,
      status: "queued",
      claimed_at: null,
      ticket_channel_id: null,
      session_runs: null,
    }).in("id", requests.map((r) => r.id)).eq("carrier_id", carrierProfile.id);
    throw error;
  }

  const finishing = requests.filter(finishingThisSession).length;
  const continuing = requests.length - finishing;
  await interaction.editReply([
    `✅ Started a **${maxRuns}-run session** for **${requests.length}** ${requests[0].dungeon} requester${requests.length === 1 ? "" : "s"}.`,
    `✅ **${finishing}** will finish their full request if the Carrier completes the session.`,
    continuing
      ? `🔁 **${continuing}** will keep their progress and return to the queue with fewer runs left.`
      : null,
    `Private ticket: <#${ticket.id}>`,
  ].filter(Boolean).join("\n"));

  return { requests, ticket };
}

async function loadTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,completed_at,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress", "completed"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function loadRequestById(requestId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,completed_at,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

async function closeTicketSoon(channel, reason) {
  await channel.send(`🔒 ${reason}\nThis ticket will close in 60 seconds.`).catch(() => {});
  setTimeout(() => channel.delete(reason).catch(() => {}), 60_000).unref?.();
}

async function maybeCloseEmptyTicket(interaction) {
  const remaining = (await loadTicketRequests(interaction.channelId))
    .filter((request) => request.status === "claimed" || request.status === "in_progress");
  if (!remaining.length) {
    await closeTicketSoon(interaction.channel, "There are no active requests left in this carry ticket.");
    return true;
  }
  return false;
}

async function handleReleaseClaim(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const actor = await requireCarrierProfile(interaction, { alreadyDeferred: true });
  if (!actor) return true;

  const supabase = getSupabase();
  const before = await loadTicketRequests(interaction.channelId);
  const { data, error } = await supabase.rpc("bot_release_carry_ticket", {
    _channel_id: interaction.channelId,
    _actor_id: actor.id,
  });
  if (error) throw new Error(error.message);
  if (!data?.length) {
    await interaction.editReply("❌ There is no active claim here that you can release.");
    return true;
  }

  for (const request of before) {
    const discordId = request.requester?.discord_id;
    if (!discordId) continue;
    try {
      const user = await interaction.client.users.fetch(discordId);
      await user.send(`🍺 Your **${request.dungeon} • ${request.difficulty}** carry was returned to the queue because the Carrier released the claim.`);
    } catch {}
  }

  await interaction.editReply(`✅ Released **${data.length}** request(s) back into the queue.`);
  await closeTicketSoon(interaction.channel, "The Carrier released this carry claim.");
  return true;
}

async function sendRatingPrompt(client, request) {
  const requesterDiscordId = request.requester?.discord_id;
  const carrierDiscordId = request.carrier?.discord_id;
  if (!requesterDiscordId || !carrierDiscordId) return;

  try {
    const requester = await client.users.fetch(requesterDiscordId);
    await requester.send({
      content: [
        `⭐ **Rate your ${request.dungeon} Carrier**`,
        `Carrier: <@${carrierDiscordId}>`,
        `Runs completed: **${request.runs_requested}**`,
        "Your rating helps build the Carrier reputation and leaderboard.",
      ].join("\n"),
      components: [ratingButtons(request.id)],
    });
  } catch (error) {
    console.warn(`[CARRY RATING] Could not DM ${requesterDiscordId}:`, error.message);
  }
}

function carrierSessionSummaryEmbed(before, updatedRows, carrierDiscordId) {
  const updated = new Map((updatedRows || []).map((row) => [row.id, row]));
  const lines = before.map((request) => {
    const result = updated.get(request.id) || request;
    const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
    const roblox = request.requester?.roblox_username ? ` (@${request.requester.roblox_username})` : "";
    const completed = Number(result.runs_completed || 0);
    const total = Number(result.runs_requested || 0);
    const left = Math.max(0, total - completed);

    if (result.status === "queued") {
      return `${mention}${roblox} • **${completed}/${total} done** • 🔁 **${left} runs left** and requeued`;
    }
    if (result.status === "completed" || completed >= total) {
      return `${mention}${roblox} • **${completed}/${total} done** • ✅ completed by Carrier`;
    }
    return `${mention}${roblox} • **${completed}/${total} done** • ${left} left`;
  });

  return new EmbedBuilder()
    .setTitle(`🍺 ${before[0]?.dungeon || "Carry"} • Session Complete`)
    .setDescription([
      `**Carrier:** <@${carrierDiscordId}>`,
      "",
      ...lines,
      "",
      "The Carrier completion has been recorded. No requester confirmation is required.",
      "Anyone with runs left has already been returned to the queue with the remaining amount updated.",
    ].join("\n"))
    .setTimestamp();
}

async function finalizeCarrierCompletedRows(supabase, fullRows) {
  if (!fullRows.length) return [];
  const ids = fullRows.map((row) => row.id);
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("carry_requests")
    .update({
      status: "completed",
      completed_at: now,
      session_runs: null,
      updated_at: now,
    })
    .in("id", ids)
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,status,completed_at,carrier_confirmed_at,ticket_channel_id");
  if (error) throw new Error(`Could not finalize Carrier-completed requests: ${error.message}`);
  return data || [];
}

async function handleCarrierSessionCompletion(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const before = await loadTicketRequests(interaction.channelId);
  const sessionRequests = before.filter(
    (r) => ["claimed", "in_progress"].includes(r.status) && r.session_runs,
  );
  if (!sessionRequests.length) {
    await interaction.editReply("🍺 There are no active grouped session requests left in this ticket.");
    return true;
  }

  const owns = sessionRequests.some((r) => r.carrier_id === profile.id);
  const staff = await hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES);
  if (!owns && !staff) {
    await interaction.editReply("❌ Only the assigned Carrier can complete this session.");
    return true;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_complete_carry_session", {
    _channel_id: interaction.channelId,
    _actor_id: profile.id,
    _service_minutes: 0,
  });
  if (error) throw new Error(error.message);
  if (!data?.length) {
    await interaction.editReply("🍺 This run session was already recorded.");
    return true;
  }

  const full = data.filter(
    (r) => Number(r.runs_completed || 0) >= Number(r.runs_requested || 0),
  );
  const partial = data.filter((r) => r.status === "queued");
  const finalized = await finalizeCarrierCompletedRows(supabase, full);
  const finalMap = new Map(finalized.map((row) => [row.id, row]));
  const summaryRows = data.map((row) => finalMap.get(row.id) || row);

  const fullIds = new Set(full.map((r) => r.id));
  const fullWithProfiles = before
    .filter((r) => fullIds.has(r.id))
    .map((r) => ({ ...r, ...(finalMap.get(r.id) || {}) }));

  for (const request of fullWithProfiles) {
    await sendRatingPrompt(interaction.client, request);
    const requesterDiscordId = request.requester?.discord_id;
    if (requesterDiscordId) {
      try {
        const user = await interaction.client.users.fetch(requesterDiscordId);
        await user.send([
          `✅ **Your ${request.dungeon} carry is complete.**`,
          `Runs completed: **${request.runs_requested}/${request.runs_requested}**`,
          "The assigned Carrier marked the session complete, so no extra requester confirmation is needed.",
        ].join("\n"));
      } catch {}
    }
  }

  const mentions = [...new Set(before.map((r) => r.requester?.discord_id).filter(Boolean))];
  const progressLines = before.map((request) => {
    const result = summaryRows.find((row) => row.id === request.id);
    if (!result) return null;
    const left = Math.max(0, Number(result.runs_requested) - Number(result.runs_completed));
    const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
    if (left === 0) return `${mention} ✅ all requested runs are complete. No further confirmation is needed.`;
    return `${mention} progress saved. **${left} run${left === 1 ? "" : "s"} remain** and your request is back in the queue.`;
  }).filter(Boolean);

  await interaction.channel.send({
    content: [mentions.map((id) => `<@${id}>`).join(" "), "", ...progressLines].join("\n").slice(0, 2000),
  }).catch(() => {});

  if (interaction.message?.editable) {
    await interaction.message.edit({
      embeds: [carrierSessionSummaryEmbed(before, summaryRows, interaction.user.id)],
      components: [],
    }).catch((editError) => {
      console.warn("[CARRY SESSION] Could not update ticket message:", editError.message);
    });
  }

  await interaction.editReply([
    `✅ Carrier completion recorded for **${data.length}** requester${data.length === 1 ? "" : "s"}.`,
    full.length
      ? `✅ **${full.length}** request${full.length === 1 ? "" : "s"} fully completed immediately.`
      : null,
    partial.length
      ? `🔁 **${partial.length}** request${partial.length === 1 ? "" : "s"} had progress saved and were requeued with fewer runs remaining.`
      : null,
    "Requester confirmation is no longer required.",
  ].filter(Boolean).join("\n"));

  await closeTicketSoon(interaction.channel, "The Carrier finished this carry session.");
  return true;
}

async function handleShowIds(interaction) {
  const requests = await loadTicketRequests(interaction.channelId);
  if (!requests.length) {
    await interaction.reply({ content: "❌ No Carry Tavern request IDs are attached to this ticket.", ephemeral: true });
    return true;
  }

  const lines = requests.map((request) => {
    const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : requesterLabel(request);
    return `${mention}: \`${request.id}\``;
  });

  await interaction.reply({
    content: ["📋 **Request IDs**", ...lines].join("\n").slice(0, 2000),
    ephemeral: true,
  });
  return true;
}

async function softRemoveRequest(interaction, request, action, profile) {
  const isRequester = request.requester_id === profile.id;
  const isCarrier = request.carrier_id === profile.id;
  const isStaff = await hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES);
  if (!isRequester && !isCarrier && !isStaff) {
    throw new Error("Only this requester, the assigned Carrier, or staff can manage this request.");
  }
  if (!["claimed", "in_progress"].includes(request.status)) {
    throw new Error("This request is no longer active in the ticket.");
  }

  const label = action === "delete" ? "deleted" : "cancelled";
  const actorSide = isRequester ? "requester" : isCarrier ? "carrier" : "staff";
  const now = new Date().toISOString();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .update({
      status: "cancelled",
      cancel_reason: `${label} in Discord ticket by ${actorSide} ${interaction.user.id}`,
      ticket_channel_id: null,
      session_runs: null,
      carrier_confirmed_at: null,
      requester_confirmed_at: null,
      updated_at: now,
    })
    .eq("id", request.id)
    .in("status", ["claimed", "in_progress"])
    .select("id,dungeon,difficulty,status")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("This request changed before the action could be applied.");

  const requesterDiscordId = request.requester?.discord_id;
  const carrierDiscordId = request.carrier?.discord_id;
  const otherDiscordId = interaction.user.id === requesterDiscordId ? carrierDiscordId : requesterDiscordId;
  if (otherDiscordId) {
    try {
      const user = await interaction.client.users.fetch(otherDiscordId);
      await user.send([
        `⚠️ Carry request **${shortId(request.id)}** was ${label}.`,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Action by: <@${interaction.user.id}>`,
      ].join("\n"));
    } catch {}
  }

  if (request.requester?.discord_id) {
    await interaction.channel.permissionOverwrites.delete(request.requester.discord_id, `Carry request ${label}`).catch(() => {});
  }

  await interaction.channel.send(
    `${action === "delete" ? "🗑️" : "❌"} <@${interaction.user.id}> ${label} request \`${request.id}\` for ${request.requester?.discord_id ? `<@${request.requester.discord_id}>` : requesterLabel(request)}.`,
  ).catch(() => {});

  return data;
}

async function handleRequestAction(interaction, requestId, action) {
  await interaction.deferReply({ ephemeral: true });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const request = await loadRequestById(requestId);
  if (!request || request.ticket_channel_id !== interaction.channelId) {
    await interaction.editReply("❌ That request is not active in this carry ticket.");
    return true;
  }

  await softRemoveRequest(interaction, request, action, profile);
  await interaction.editReply(
    action === "delete"
      ? "✅ Request removed from the active system. Its audit record was preserved."
      : "✅ Request cancelled.",
  );

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: [] }).catch(() => {});
  }
  await maybeCloseEmptyTicket(interaction);
  return true;
}

async function recordTicketNoShow(interaction, request) {
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) throw new Error("Link your Tavern account first.");
  if (!["claimed", "in_progress"].includes(request.status)) {
    throw new Error("That carry is not currently claimed or in progress.");
  }
  if (!request.claimed_at || Date.now() - new Date(request.claimed_at).getTime() < MIN_NOSHOW_WAIT_MS) {
    const elapsed = Math.max(0, Date.now() - new Date(request.claimed_at || Date.now()).getTime());
    const left = Math.max(1, Math.ceil((MIN_NOSHOW_WAIT_MS - elapsed) / 60000));
    throw new Error(`Give the other person a reasonable chance to respond first. You can file this no-show in about ${left} minute(s).`);
  }

  let offenderDiscordId;
  let side;
  if (profile.id === request.requester_id) {
    offenderDiscordId = request.carrier?.discord_id;
    side = "carrier";
  } else if (profile.id === request.carrier_id) {
    offenderDiscordId = request.requester?.discord_id;
    side = "requester";
  } else if (await hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES)) {
    offenderDiscordId = request.requester?.discord_id;
    side = "requester";
  } else {
    throw new Error("Only the requester, assigned Carrier, or staff can file a no-show for this request.");
  }

  if (!offenderDiscordId) throw new Error("I could not resolve the other participant's Discord account.");

  const reason = `No-show reported from carry ticket ${interaction.channelId}.`;
  recordNoShow({
    guildId: interaction.guildId,
    requestId: request.id,
    offenderId: offenderDiscordId,
    reporterId: interaction.user.id,
    offenderSide: side,
    reason,
  });
  await maybeSendAbuseAlert(
    interaction.client,
    interaction.guildId,
    offenderDiscordId,
    `carry no-show ${request.id}`,
  ).catch(() => {});

  if (process.env.MOD_LOG_CHANNEL_ID) {
    const channel = await interaction.client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
    if (channel?.isTextBased?.()) {
      await channel.send([
        "🚫 **Carry No-Show Recorded**",
        `Request: \`${request.id}\``,
        `Ticket: <#${interaction.channelId}>`,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Reporter: <@${interaction.user.id}>`,
        `No-show: <@${offenderDiscordId}> (${side})`,
      ].join("\n")).catch(() => {});
    }
  }

  return { offenderDiscordId, side };
}

async function handleNoShowButton(interaction, requestId) {
  await interaction.deferReply({ ephemeral: true });
  const request = await loadRequestById(requestId);
  if (!request || request.ticket_channel_id !== interaction.channelId) {
    await interaction.editReply("❌ That request is not active in this carry ticket.");
    return true;
  }

  try {
    const result = await recordTicketNoShow(interaction, request);
    await interaction.editReply(`✅ No-show recorded for <@${result.offenderDiscordId}>. Staff history has been updated.`);
  } catch (error) {
    await interaction.editReply(`❌ ${error.message}`);
  }
  return true;
}

async function handleRatingButton(interaction) {
  const match = /^carry_rate_([0-9a-f-]{36})_([1-5])$/i.exec(interaction.customId || "");
  if (!match) return false;

  const [, requestId, scoreText] = match;
  const score = Number(scoreText);
  const supabase = getSupabase();
  const { data: request, error } = await supabase.from("carry_requests")
    .select("id,status,requester_id,carrier_id,dungeon,requester:profiles!carry_requests_requester_id_fkey(discord_id),carrier:profiles!carry_requests_carrier_id_fkey(discord_id)")
    .eq("id", requestId)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!request || request.status !== "completed") {
    await interaction.reply({ content: "❌ This carry is not eligible for a rating.", ephemeral: true });
    return true;
  }
  if (request.requester?.discord_id !== interaction.user.id || !request.carrier?.discord_id) {
    await interaction.reply({ content: "❌ Only the requester for this completed carry can rate the Carrier.", ephemeral: true });
    return true;
  }

  const inserted = recordCarrierRating({
    guildId: interaction.guildId || process.env.GUILD_ID || "",
    requestId,
    carrierId: request.carrier.discord_id,
    requesterId: interaction.user.id,
    score,
  });
  if (!inserted) {
    await interaction.reply({ content: "⭐ You already rated this carry. Thank you!", ephemeral: true });
    return true;
  }

  const rep = carrierReputation(request.carrier.discord_id, interaction.guildId || process.env.GUILD_ID || "");
  const { error: qualityError } = await supabase
    .from("carrier_profiles")
    .update({ quality_score: rep.average || 0 })
    .eq("user_id", request.carrier_id);
  if (qualityError) {
    console.warn("[CARRY RATING] Could not sync quality score:", qualityError.message);
  }

  await interaction.update({
    content: `⭐ **Thanks! You rated this Carrier ${score}/5.**\nTheir current Carry Tavern rating is **${rep.average}/5** from ${rep.ratings} rating${rep.ratings === 1 ? "" : "s"}.`,
    components: [],
  });
  return true;
}

async function handleCarryTicketButton(interaction) {
  if (!interaction.isButton()) return false;

  if (interaction.customId?.startsWith("carry_rate_")) {
    return handleRatingButton(interaction);
  }
  if (interaction.customId === "carry_release_claim") {
    return handleReleaseClaim(interaction);
  }
  if (interaction.customId === "carry_carrier_complete") {
    return handleCarrierSessionCompletion(interaction);
  }
  if (interaction.customId === "carry_show_ids") {
    return handleShowIds(interaction);
  }

  let match = /^carry_cancel_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleRequestAction(interaction, match[1], "cancel");

  match = /^carry_delete_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleRequestAction(interaction, match[1], "delete");

  match = /^carry_noshow_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (match) return handleNoShowButton(interaction, match[1]);

  if (interaction.customId?.startsWith("carry_requester_complete_") || interaction.customId === "carry_requester_complete") {
    await interaction.reply({
      content: "ℹ️ Requester confirmation is no longer required. The assigned Carrier completes the session for everyone.",
      ephemeral: true,
    });
    return true;
  }

  return false;
}

async function expireTimedOutCarries(client) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_timeout_carries");
  if (error) throw new Error(`Carry timeout sweep failed: ${error.message}`);
  if (!data?.length) return 0;

  const requesterIds = [...new Set(data.map((r) => r.requester_id))];
  const { data: profiles } = await supabase
    .from("profiles")
    .select("id,discord_id")
    .in("id", requesterIds);
  const map = new Map((profiles || []).map((p) => [p.id, p.discord_id]));

  for (const request of data) {
    const discordId = map.get(request.requester_id);
    if (!discordId) continue;
    try {
      const user = await client.users.fetch(discordId);
      await user.send([
        "⌛ **Your Carry Tavern request timed out.**",
        `Dungeon: **${request.dungeon}**`,
        `Difficulty: **${request.difficulty}**`,
        "Nobody accepted it within 24 hours, so it was removed from the live queue. You can submit another request now.",
      ].join("\n"));
    } catch (dmError) {
      console.warn(`[CARRY TIMEOUT] Could not DM ${discordId}:`, dmError.message);
    }
  }

  console.log(`[CARRY TIMEOUT] Removed ${data.length} unclaimed request(s) older than 24 hours.`);
  return data.length;
}

module.exports = {
  claimCarryGroup,
  expireTimedOutCarries,
  groupWaitingRequests,
  handleCarryTicketButton,
  loadPlatformQueue,
  requireCarrierProfile,
};
