const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");
const {
  finishServiceSession,
  formatMinutes,
  getServiceSnapshot,
} = require("./carryServiceTime");

const COMPLETE_ID = "carry_service_complete";
const STAFF_ROLES = ["moderator", "administrator", "owner"];

function remainingRuns(request) {
  return Math.max(0, Number(request.runs_requested || 0) - Number(request.runs_completed || 0));
}

function plannedRuns(request) {
  const remaining = remainingRuns(request);
  const planned = Number(request.session_runs || remaining || 1);
  return Math.max(0, Math.min(remaining, planned));
}

async function loadTicketRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,claimed_at,started_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Could not load carry session: ${error.message}`);
  return data || [];
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

async function sendRatingPrompt(client, request) {
  const requesterDiscordId = request.requester?.discord_id;
  const carrierDiscordId = request.carrier?.discord_id;
  if (!requesterDiscordId || !carrierDiscordId) return;
  try {
    const user = await client.users.fetch(String(requesterDiscordId));
    await user.send({
      content: [
        `⭐ **Rate your ${request.dungeon} Carrier**`,
        `Carrier: <@${carrierDiscordId}>`,
        "Your rating helps build the Carrier reputation and leaderboard.",
      ].join("\n"),
      components: [ratingButtons(request.id)],
    });
  } catch (error) {
    console.warn(`[CARRY SERVICE] Could not send rating prompt to ${requesterDiscordId}:`, error.message);
  }
}

async function finalizeCompletedRequests(supabase, rows) {
  const full = rows.filter((row) => Number(row.runs_completed || 0) >= Number(row.runs_requested || 0));
  if (!full.length) return [];
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("carry_requests")
    .update({ status: "completed", completed_at: now, session_runs: null, updated_at: now })
    .in("id", full.map((row) => row.id))
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,status,completed_at,ticket_channel_id");
  if (error) throw new Error(`Could not finalize completed requests: ${error.message}`);
  return data || [];
}

async function addVerifiedTimeToCarrierTotals(supabase, carrierProfileId, minutes) {
  const amount = Math.max(0, Math.floor(Number(minutes || 0)));
  if (!carrierProfileId || amount <= 0) return;

  const { data: carrier } = await supabase
    .from("carrier_profiles")
    .select("user_id,service_minutes")
    .eq("user_id", carrierProfileId)
    .maybeSingle();
  if (carrier) {
    await supabase
      .from("carrier_profiles")
      .update({ service_minutes: Number(carrier.service_minutes || 0) + amount, updated_at: new Date().toISOString() })
      .eq("user_id", carrierProfileId);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("id,total_service_minutes")
    .eq("id", carrierProfileId)
    .maybeSingle();
  if (profile) {
    await supabase
      .from("profiles")
      .update({ total_service_minutes: Number(profile.total_service_minutes || 0) + amount })
      .eq("id", carrierProfileId);
  }
}

async function syncVerifiedTimeToCarryActivity(supabase, requestIds, minutes) {
  const amount = Math.max(0, Math.floor(Number(minutes || 0)));
  const ids = [...new Set((requestIds || []).filter(Boolean).map(String))];
  if (!ids.length || amount <= 0) return { rows: 0, minutes: amount };

  const { data: activityRows, error: loadError } = await supabase
    .from("carry_activity")
    .select("id,carry_request_id,service_minutes")
    .in("carry_request_id", ids);
  if (loadError) throw new Error(`Could not load carry activity for verified time: ${loadError.message}`);
  if (!activityRows?.length) throw new Error("No carry_activity rows were created for this completed session.");

  // A grouped carry can contain several requesters, but verified service time is
  // real wall-clock Carrier time. Store it once for the whole session instead
  // of once per requester, otherwise the website leaderboard would multiply it.
  const byRequest = new Map(activityRows.map((row) => [String(row.carry_request_id || ""), row]));
  const primary = ids.map((id) => byRequest.get(id)).find(Boolean) || activityRows[0];
  const zeroIds = activityRows.filter((row) => row.id !== primary.id).map((row) => row.id);

  if (zeroIds.length) {
    const { error: zeroError } = await supabase
      .from("carry_activity")
      .update({ service_minutes: 0 })
      .in("id", zeroIds);
    if (zeroError) throw new Error(`Could not clear duplicate grouped service time: ${zeroError.message}`);
  }

  const { error: timeError } = await supabase
    .from("carry_activity")
    .update({ service_minutes: amount })
    .eq("id", primary.id);
  if (timeError) throw new Error(`Could not save verified service time to carry_activity: ${timeError.message}`);

  console.log(`[CARRY SERVICE] Synced ${amount} verified minute(s) to carry_activity for ${activityRows.length} request row(s).`);
  return { rows: activityRows.length, minutes: amount };
}

function completionEmbed(before, resultRows, carrierDiscordId, serviceMinutes, actualRuns) {
  const byId = new Map((resultRows || []).map((row) => [String(row.id), row]));
  const lines = before.map((request) => {
    const result = byId.get(String(request.id)) || request;
    const completed = Number(result.runs_completed || 0);
    const total = Number(result.runs_requested || 0);
    const left = Math.max(0, total - completed);
    const who = request.requester?.discord_id ? `<@${request.requester.discord_id}>` : "Requester";
    if (left <= 0 || result.status === "completed") return `${who} • ✅ **${completed}/${total}** runs complete`;
    return `${who} • 🔁 **${completed}/${total}** done • **${left}** left and requeued`;
  });

  return new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(`✅ ${before[0]?.dungeon || "Carry"} • Session Complete`)
    .setDescription([
      `**Carrier:** <@${carrierDiscordId}>`,
      `**Verified service time:** ⏱️ **${formatMinutes(serviceMinutes)}**`,
      `**Dungeon runs completed this session:** **${actualRuns}**`,
      `**Requesters served:** **${before.length}**`,
      "",
      ...lines,
      "",
      "Service time is credited once for the real wall-clock session, not once per requester.",
    ].join("\n"))
    .setFooter({ text: "The Carry Tavern • Verified Service Time" })
    .setTimestamp();
}

async function handleVerifiedCompletion(interaction) {
  if (!interaction.isButton() || interaction.customId !== COMPLETE_ID) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const before = await loadTicketRequests(interaction.channelId);
  if (!before.length) {
    await interaction.editReply("🍺 There are no active carry requests left in this ticket.");
    return true;
  }

  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) {
    await interaction.editReply("❌ Your Discord account is not linked to a Tavern profile.");
    return true;
  }

  const owns = before.some((request) => request.carrier_id === profile.id);
  const staff = await hasAnyPlatformRole(profile.id, STAFF_ROLES);
  if (!owns && !staff) {
    await interaction.editReply("❌ Only the assigned Carrier or staff can complete this session.");
    return true;
  }

  const snapshot = getServiceSnapshot(interaction.channelId);
  if (!snapshot.exists || snapshot.status === "not_started") {
    await interaction.editReply("❌ Press **Start Carry** first. Service time must be tracked before a session can be completed.");
    return true;
  }
  if (snapshot.status === "completed") {
    await interaction.editReply("ℹ️ This timed carry session was already completed.");
    return true;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.rpc("bot_complete_carry_session", {
    _channel_id: interaction.channelId,
    _actor_id: profile.id,
    // Keep the RPC at zero because grouped sessions can create more than one
    // activity row. The verified wall-clock value is written exactly once below.
    _service_minutes: 0,
  });
  if (error) throw new Error(error.message);
  if (!data?.length) {
    await interaction.editReply("🍺 This run session was already recorded or no active run batch remains.");
    return true;
  }

  const finalized = await finalizeCompletedRequests(supabase, data);
  const finalMap = new Map(finalized.map((row) => [String(row.id), row]));
  const results = data.map((row) => finalMap.get(String(row.id)) || row);

  const actualRuns = Math.max(0, ...before.map((request) => plannedRuns(request)));
  const history = finishServiceSession(interaction.channelId, {
    guildId: interaction.guildId,
    carrierId: before[0].carrier?.discord_id || interaction.user.id,
    runsCompleted: actualRuns,
    requestCount: before.length,
  });

  await syncVerifiedTimeToCarryActivity(
    supabase,
    before.map((request) => request.id),
    history.service_minutes,
  ).catch((timeError) => console.warn("[CARRY SERVICE] Could not sync verified time to carry_activity:", timeError.message));

  await addVerifiedTimeToCarrierTotals(supabase, before[0].carrier_id || profile.id, history.service_minutes)
    .catch((timeError) => console.warn("[CARRY SERVICE] Could not sync Carrier total service time:", timeError.message));

  const fullIds = new Set(finalized.map((row) => String(row.id)));
  for (const request of before) {
    const result = results.find((row) => String(row.id) === String(request.id));
    const requesterId = request.requester?.discord_id;
    const left = result ? Math.max(0, Number(result.runs_requested || 0) - Number(result.runs_completed || 0)) : remainingRuns(request);

    if (fullIds.has(String(request.id))) await sendRatingPrompt(interaction.client, request);
    if (requesterId) {
      try {
        const user = await interaction.client.users.fetch(String(requesterId));
        await user.send(left <= 0
          ? `✅ **Your ${request.dungeon} carry is complete.**\nVerified Carrier service time this session: **${formatMinutes(history.service_minutes)}**.`
          : `🔁 **Your ${request.dungeon} carry progress was saved.**\nYou have **${left} run${left === 1 ? "" : "s"} left and are back in the queue.`);
      } catch {}
    }
  }

  if (interaction.message?.editable) {
    await interaction.message.edit({
      embeds: [completionEmbed(before, results, interaction.user.id, history.service_minutes, actualRuns)],
      components: [],
    }).catch(() => {});
  }

  await interaction.editReply([
    "✅ **Carry session completed.**",
    `⏱️ Verified service time: **${formatMinutes(history.service_minutes)}**`,
    `🏃 Dungeon runs this session: **${actualRuns}**`,
    `👥 Requesters served: **${before.length}**`,
    "The verified time has been added to the Carrier's service-time history.",
  ].join("\n"));

  const channel = interaction.channel;
  await channel.send(`🔒 Session complete. **${formatMinutes(history.service_minutes)}** of verified Carrier time was recorded. This ticket will close in 60 seconds.`).catch(() => {});
  setTimeout(() => channel?.delete?.("Verified carry session completed").catch(() => {}), 60_000).unref?.();
  return true;
}

module.exports = {
  COMPLETE_ID,
  handleVerifiedCompletion,
  syncVerifiedTimeToCarryActivity,
};
