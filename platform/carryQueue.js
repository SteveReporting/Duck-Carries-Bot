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
  recordCarrierRating,
} = require("./communitySystems");

const CARRIER_PLATFORM_ROLES = ["carrier", "moderator", "administrator", "owner"];
const STAFF_PLATFORM_ROLES = ["moderator", "administrator", "owner"];

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
    if (new Date(row.created_at).getTime() < new Date(group.oldestAt).getTime()) group.oldestAt = row.created_at;
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

function requesterCompletionRows(requests, enabled) {
  const eligible = requests.filter((request) => {
    if (!request.requester?.discord_id) return false;
    if (enabled) {
      return request.status !== "completed"
        && Boolean(request.carrier_confirmed_at)
        && Number(request.runs_completed || 0) >= Number(request.runs_requested || 0);
    }
    return finishingThisSession(request);
  }).slice(0, 20);

  const rows = [];
  for (let index = 0; index < eligible.length; index += 5) {
    const row = new ActionRowBuilder();
    for (const request of eligible.slice(index, index + 5)) {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`carry_requester_complete_${request.id}`)
          .setLabel(`Complete: ${requesterLabel(request)}`.slice(0, 80))
          .setStyle(ButtonStyle.Success)
          .setDisabled(!enabled),
      );
    }
    rows.push(row);
  }
  return rows;
}

function initialTicketComponents(requests) {
  const controlRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("carry_carrier_complete").setLabel("Carrier Complete Session").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("carry_release_claim").setLabel("Release Claim").setStyle(ButtonStyle.Secondary),
  );
  return [controlRow, ...requesterCompletionRows(requests, false)].slice(0, 5);
}

function postCarrierComponents(requests) {
  return requesterCompletionRows(requests, true).slice(0, 5);
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
  return `${mention}${roblox} • **${remaining}** left • **${session}** this session • ${outcome}`;
}

async function createCarryTicket(interaction, requests, carrierProfile) {
  const guild = interaction.guild;
  if (!guild || !requests.length) throw new Error("No carries were selected.");

  const requesterDiscordIds = [...new Set(requests.map((r) => r.requester?.discord_id).filter(Boolean))];
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles],
    },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    ...requesterDiscordIds.map((id) => ({
      id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
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
      "The Carrier presses **Carrier Complete Session** once after the selected run batch is done.",
      "Only requesters whose full requested amount is now finished will get an active **Requester Complete** button.",
      "Anyone with runs still left is automatically updated and returned to the queue with only the remaining runs needed.",
      "If someone does not show up after the claim, use `/noshow report` with that request ID.",
    ].join("\n"))
    .setFooter({ text: "Requester completion buttons unlock only after the Carrier finishes the session." })
    .setTimestamp();

  await ticket.send({
    content: [`<@${interaction.user.id}>`, ...requesterDiscordIds.map((id) => `<@${id}>`)].join(" "),
    embeds: [embed],
    components: initialTicketComponents(requests),
  });

  for (const request of requests) {
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
        after ? `If all planned runs finish, you will have **${after}** left.` : "If all planned runs finish, your request will be ready for your completion confirmation.",
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
    `✅ **${finishing}** will finish their full request if the session completes.`,
    continuing ? `🔁 **${continuing}** will keep their progress and return to the queue with fewer runs left.` : null,
    `Private ticket: <#${ticket.id}>`,
  ].filter(Boolean).join("\n"));
  return { requests, ticket };
}

async function loadTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress", "completed"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function closeTicketSoon(channel, reason) {
  await channel.send(`🔒 ${reason}\nThis ticket will close in 60 seconds.`).catch(() => {});
  setTimeout(() => channel.delete(reason).catch(() => {}), 60_000).unref?.();
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

async function handleLegacyCompletion(interaction, kind) {
  await interaction.deferReply({ ephemeral: true });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const before = await loadTicketRequests(interaction.channelId);
  const active = before.filter((r) => r.status === "claimed" || r.status === "in_progress");
  if (!active.length) {
    await interaction.editReply("🍺 Every carry in this ticket is already completed.");
    return true;
  }

  let targets;
  if (kind === "carrier") {
    targets = active.filter((r) => r.carrier_id === profile.id);
    if (!targets.length && await hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES)) targets = active;
    if (!targets.length) {
      await interaction.editReply("❌ Only the assigned Carrier can press Carrier Complete.");
      return true;
    }
  } else {
    targets = active.filter((r) => r.requester_id === profile.id);
    if (!targets.length) {
      await interaction.editReply("❌ You do not have a request in this ticket.");
      return true;
    }
  }

  const supabase = getSupabase();
  for (const request of targets) {
    const { error } = await supabase.rpc("bot_confirm_carry", {
      _request_id: request.id,
      _actor_id: profile.id,
      _service_minutes: 0,
    });
    if (error) throw new Error(error.message);
  }

  const after = await loadTicketRequests(interaction.channelId);
  const beforeCompleted = new Set(before.filter((r) => r.status === "completed").map((r) => r.id));
  const newlyCompleted = after.filter((r) => r.status === "completed" && !beforeCompleted.has(r.id));
  for (const request of newlyCompleted) await sendRatingPrompt(interaction.client, request);

  const completed = after.filter((r) => r.status === "completed").length;
  const remaining = after.filter((r) => r.status !== "completed");
  const waitingOn = remaining.map((r) => {
    const parts = [];
    if (!r.carrier_confirmed_at) parts.push("Carrier");
    if (!r.requester_confirmed_at) parts.push(r.requester?.discord_id ? `<@${r.requester.discord_id}>` : "Requester");
    return `• ${r.dungeon} (${remainingRuns(r)} runs left): ${parts.join(" + ")}`;
  });

  await interaction.editReply(remaining.length
    ? `✅ Confirmation recorded. **${completed}/${after.length}** request(s) fully completed.\nWaiting on:\n${waitingOn.join("\n")}`
    : `✅ Both sides confirmed every request. **${completed}/${after.length}** carry request(s) registered as complete. Requesters have been sent Carrier rating buttons.`);

  if (!remaining.length) await closeTicketSoon(interaction.channel, "Both sides confirmed the carry as complete.");
  return true;
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
    if (completed >= total && result.carrier_confirmed_at) {
      return `${mention}${roblox} • **${completed}/${total} done** • ✅ all runs finished • waiting for this requester to confirm`;
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
      "Only requesters marked as fully finished should press their own **Requester Complete** button below.",
      "Anyone with runs left has already been returned to the queue with the remaining amount updated.",
    ].join("\n"))
    .setTimestamp();
}

async function handleCarrierSessionCompletion(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const before = await loadTicketRequests(interaction.channelId);
  const sessionRequests = before.filter((r) => ["claimed", "in_progress"].includes(r.status) && r.session_runs);
  if (!sessionRequests.length) {
    return handleLegacyCompletionAfterDeferred(interaction, profile, "carrier", before);
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

  const full = data.filter((r) => r.status === "in_progress" && Number(r.runs_completed) >= Number(r.runs_requested));
  const partial = data.filter((r) => r.status === "queued");
  const fullIds = new Set(full.map((r) => r.id));
  const fullWithProfiles = before
    .filter((r) => fullIds.has(r.id))
    .map((r) => ({ ...r, ...(full.find((x) => x.id === r.id) || {}) }));

  const mentions = [...new Set(before.map((r) => r.requester?.discord_id).filter(Boolean))];
  const progressLines = before.map((request) => {
    const result = data.find((row) => row.id === request.id);
    if (!result) return null;
    const left = Math.max(0, Number(result.runs_requested) - Number(result.runs_completed));
    const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
    if (left === 0) return `${mention} all requested runs are finished. Press **your own Requester Complete button** below.`;
    return `${mention} progress saved. **${left} run${left === 1 ? "" : "s"} remain** and your request is back in the queue. Do not press complete yet.`;
  }).filter(Boolean);

  await interaction.channel.send({
    content: [mentions.map((id) => `<@${id}>`).join(" "), "", ...progressLines].join("\n").slice(0, 2000),
  }).catch(() => {});

  if (interaction.message?.editable) {
    await interaction.message.edit({
      embeds: [carrierSessionSummaryEmbed(before, data, interaction.user.id)],
      components: postCarrierComponents(fullWithProfiles),
    }).catch((editError) => console.warn("[CARRY SESSION] Could not update ticket message:", editError.message));
  }

  await interaction.editReply([
    `✅ Session recorded for **${data.length}** requester${data.length === 1 ? "" : "s"}.`,
    full.length ? `✅ **${full.length}** request${full.length === 1 ? "" : "s"} now need the specific requester to confirm.` : null,
    partial.length ? `🔁 **${partial.length}** request${partial.length === 1 ? "" : "s"} had progress saved and were requeued with fewer runs remaining.` : null,
  ].filter(Boolean).join("\n"));

  if (!full.length) await closeTicketSoon(interaction.channel, "Session progress was saved and every requester still has runs remaining.");
  return true;
}

async function handleLegacyCompletionAfterDeferred(interaction, profile, kind, before) {
  const active = before.filter((r) => r.status === "claimed" || r.status === "in_progress");
  if (!active.length) {
    await interaction.editReply("🍺 Every carry in this ticket is already completed.");
    return true;
  }

  let targets;
  if (kind === "carrier") {
    targets = active.filter((r) => r.carrier_id === profile.id);
    if (!targets.length && await hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES)) targets = active;
  } else {
    targets = active.filter((r) => r.requester_id === profile.id);
  }
  if (!targets.length) {
    await interaction.editReply(kind === "carrier" ? "❌ Only the assigned Carrier can confirm this carry." : "❌ You do not have a request in this ticket.");
    return true;
  }

  const supabase = getSupabase();
  for (const request of targets) {
    const { error } = await supabase.rpc("bot_confirm_carry", {
      _request_id: request.id,
      _actor_id: profile.id,
      _service_minutes: 0,
    });
    if (error) throw new Error(error.message);
  }
  const after = await loadTicketRequests(interaction.channelId);
  const remaining = after.filter((r) => r.status !== "completed");
  await interaction.editReply(remaining.length ? "✅ Confirmation recorded. Waiting for the other side." : "✅ Carry completed and confirmed by both sides.");
  if (!remaining.length) await closeTicketSoon(interaction.channel, "Both sides confirmed the carry as complete.");
  return true;
}

async function handleSpecificRequesterCompletion(interaction, requestId) {
  await interaction.deferReply({ ephemeral: true });
  const profile = await getLinkedProfile(interaction.user.id);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const supabase = getSupabase();
  const { data: request, error: fetchError } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,status,carrier_confirmed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id)")
    .eq("id", requestId)
    .maybeSingle();
  if (fetchError) throw new Error(fetchError.message);
  if (!request) {
    await interaction.editReply("❌ That carry request no longer exists.");
    return true;
  }
  if (request.requester_id !== profile.id || request.requester?.discord_id !== interaction.user.id) {
    await interaction.editReply("❌ That Requester Complete button belongs to a different requester.");
    return true;
  }
  if (!request.carrier_confirmed_at) {
    await interaction.editReply("❌ Wait for the Carrier to finish the run session first.");
    return true;
  }
  if (Number(request.runs_completed) < Number(request.runs_requested)) {
    await interaction.editReply(`❌ You still have **${remainingRuns(request)}** run(s) remaining, so this request is not ready to complete.`);
    return true;
  }

  const { data, error } = await supabase.rpc("bot_requester_complete_session", {
    _request_id: requestId,
    _actor_id: profile.id,
  });
  if (error) throw new Error(error.message);

  const after = await loadTicketRequests(interaction.channelId);
  const completedRequest = after.find((r) => r.id === requestId) || { ...request, ...data };
  await sendRatingPrompt(interaction.client, completedRequest);

  if (interaction.message?.editable) {
    await interaction.message.edit({ components: postCarrierComponents(after) }).catch(() => {});
  }

  await interaction.editReply(`✅ Your **${request.dungeon}** request is fully complete. Thanks for confirming.`);

  const waiting = after.filter((r) => r.status !== "completed" && r.carrier_confirmed_at);
  if (!waiting.length) await closeTicketSoon(interaction.channel, "Every fully finished requester confirmed completion.");
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
  if (qualityError) console.warn("[CARRY RATING] Could not sync quality score:", qualityError.message);

  await interaction.update({
    content: `⭐ **Thanks! You rated this Carrier ${score}/5.**\nTheir current Carry Tavern rating is **${rep.average}/5** from ${rep.ratings} rating${rep.ratings === 1 ? "" : "s"}.`,
    components: [],
  });
  return true;
}

async function handleCarryTicketButton(interaction) {
  if (interaction.customId?.startsWith("carry_rate_")) return handleRatingButton(interaction);
  if (interaction.customId?.startsWith("carry_requester_complete_")) {
    const requestId = interaction.customId.slice("carry_requester_complete_".length);
    if (!/^[0-9a-f-]{36}$/i.test(requestId)) return false;
    return handleSpecificRequesterCompletion(interaction, requestId);
  }
  if (interaction.customId === "carry_release_claim") return handleReleaseClaim(interaction);
  if (interaction.customId === "carry_carrier_complete") return handleCarrierSessionCompletion(interaction);
  if (interaction.customId === "carry_requester_complete") return handleLegacyCompletion(interaction, "requester");
  return false;
}

async function expireTimedOutCarries(client) {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_timeout_carries");
  if (error) throw new Error(`Carry timeout sweep failed: ${error.message}`);
  if (!data?.length) return 0;

  const requesterIds = [...new Set(data.map((r) => r.requester_id))];
  const { data: profiles } = await supabase.from("profiles").select("id,discord_id").in("id", requesterIds);
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
