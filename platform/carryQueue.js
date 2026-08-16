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

async function loadPlatformQueue({ statuses = ["queued", "claimed", "in_progress"], limit = 150 } = {}) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,availability,notes,status,claimed_at,started_at,completed_at,created_at,updated_at,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .in("status", statuses)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`Could not load the shared queue: ${error.message}`);
  return data || [];
}

function groupWaitingRequests(rows) {
  const groups = new Map();
  for (const row of rows.filter((r) => r.status === "queued")) {
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
    group.runTiers.add(Number(row.runs_requested));
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

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("carry_carrier_complete").setLabel("Carrier Complete").setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId("carry_requester_complete").setLabel("Requester Complete").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("carry_release_claim").setLabel("Release Claim").setStyle(ButtonStyle.Secondary),
  );
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
    }).in("id", requestIds).eq("carrier_id", carrierProfile.id);
    await ticket.delete("Ticket setup failed").catch(() => {});
    throw new Error(`Could not attach the private ticket: ${attachError.message}`);
  }

  const requesterLines = requests.map((request) => {
    const mention = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
    const roblox = request.requester?.roblox_username ? ` (@${request.requester.roblox_username})` : "";
    return `${mention}${roblox} • **${request.runs_requested}** run${request.runs_requested === 1 ? "" : "s"}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`🍺 ${requests[0].dungeon} • ${requests[0].difficulty}`)
    .setDescription([
      `**Carrier:** <@${interaction.user.id}>`,
      `**Requests included:** ${requests.length}`,
      "",
      ...requesterLines,
      "",
      "When the carry is finished, the Carrier presses **Carrier Complete** and each requester presses **Requester Complete**. A carry only registers after both sides confirm it.",
      "If someone does not show up after the claim, use `/noshow report` with that request ID.",
    ].join("\n"))
    .setFooter({ text: "Use Release Claim if this carry was accepted by mistake." })
    .setTimestamp();

  await ticket.send({
    content: [`<@${interaction.user.id}>`, ...requesterDiscordIds.map((id) => `<@${id}>`)].join(" "),
    embeds: [embed],
    components: [ticketButtons()],
  });

  for (const request of requests) {
    const discordId = request.requester?.discord_id;
    if (!discordId) continue;
    try {
      const user = await interaction.client.users.fetch(discordId);
      await user.send([
        `🍺 **Your ${request.dungeon} carry was accepted.**`,
        `Difficulty: **${request.difficulty}**`,
        `Runs: **${request.runs_requested}**`,
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
    await supabase.from("carry_requests").update({ carrier_id: null, status: "queued", claimed_at: null, ticket_channel_id: null })
      .in("id", requests.map((r) => r.id)).eq("carrier_id", carrierProfile.id);
    throw error;
  }

  await interaction.editReply(`✅ Claimed **${requests.length}** ${requests[0].dungeon} request(s) up to **${maxRuns} runs**. Private ticket: <#${ticket.id}>`);
  return { requests, ticket };
}

async function loadTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,status,carrier_confirmed_at,requester_confirmed_at,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id)")
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
        `Runs: **${request.runs_requested}**`,
        "Your rating helps build the Carrier reputation and leaderboard.",
      ].join("\n"),
      components: [ratingButtons(request.id)],
    });
  } catch (error) {
    console.warn(`[CARRY RATING] Could not DM ${requesterDiscordId}:`, error.message);
  }
}

async function handleCompletion(interaction, kind) {
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
    if (!targets.length && await hasAnyPlatformRole(profile.id, ["moderator", "administrator", "owner"])) targets = active;
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
    return `• ${r.dungeon} (${r.runs_requested} runs): ${parts.join(" + ")}`;
  });

  await interaction.editReply(remaining.length
    ? `✅ Confirmation recorded. **${completed}/${after.length}** request(s) fully completed.\nWaiting on:\n${waitingOn.join("\n")}`
    : `✅ Both sides confirmed every request. **${completed}/${after.length}** carry request(s) registered as complete. Requesters have been sent Carrier rating buttons.`);

  if (!remaining.length) await closeTicketSoon(interaction.channel, "Both sides confirmed the carry as complete.");
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
  if (interaction.customId === "carry_release_claim") return handleReleaseClaim(interaction);
  if (interaction.customId === "carry_carrier_complete") return handleCompletion(interaction, "carrier");
  if (interaction.customId === "carry_requester_complete") return handleCompletion(interaction, "requester");
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
