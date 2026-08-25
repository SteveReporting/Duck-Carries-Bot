const { EmbedBuilder, MessageFlags } = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, hasAnyPlatformRole } = require("./helpers");
const { maybeSendAbuseAlert, recordNoShow } = require("./communitySystems");

const STAFF_PLATFORM_ROLES = ["moderator", "administrator", "owner"];
const ACTIVE_STATUSES = ["claimed", "in_progress"];
const closingTickets = new Set();

function checkRow(requestId) {
  try {
    return db.prepare("SELECT * FROM carry_ready_checks WHERE request_id = ?")
      .get(String(requestId)) || null;
  } catch {
    return null;
  }
}

async function loadRequest(requestId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,status,ticket_channel_id,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)")
    .eq("id", String(requestId))
    .maybeSingle();
  if (error) throw new Error(`Could not load ready-check request: ${error.message}`);
  return data || null;
}

async function actorCanManage(interaction, request) {
  if (request?.carrier?.discord_id === interaction.user.id) return true;
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  if (!profile) return false;
  return hasAnyPlatformRole(profile.id, STAFF_PLATFORM_ROLES);
}

async function refreshControlCenter(channel) {
  if (!channel?.isTextBased?.()) return;
  try {
    const { ensureCarryControlCenter } = require("./carryControlCenter");
    await ensureCarryControlCenter(channel, { replace: true, ping: false });
  } catch (error) {
    console.warn("[READY REQUEUE] Could not refresh Control Center:", error.message);
  }
}

async function removeRequesterFromTicketIfDetached(channel, request) {
  const requesterDiscordId = request.requester?.discord_id;
  if (!channel?.isTextBased?.() || !requesterDiscordId) return;

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id")
    .eq("ticket_channel_id", String(channel.id))
    .eq("requester_id", request.requester_id)
    .in("status", ACTIVE_STATUSES)
    .limit(1);
  if (error) {
    console.warn("[READY REQUEUE] Could not check remaining requester tickets:", error.message);
    return;
  }
  if ((data || []).length) return;

  await channel.permissionOverwrites.delete(
    String(requesterDiscordId),
    "Requester did not pass carry ready check",
  ).catch((error) => {
    console.warn(`[READY REQUEUE] Could not remove ticket access for ${requesterDiscordId}:`, error.message);
  });
}

async function closeTicketIfEmpty(channel) {
  if (!channel?.isTextBased?.() || closingTickets.has(String(channel.id))) return false;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id")
    .eq("ticket_channel_id", String(channel.id))
    .in("status", ACTIVE_STATUSES)
    .limit(1);
  if (error || (data || []).length) return false;

  closingTickets.add(String(channel.id));
  await channel.send("🔒 No ready requesters remain in this carry. This ticket will close in 60 seconds; their requests are back in the queue.").catch(() => {});
  setTimeout(() => {
    channel.delete("No ready requesters remained after ready check").catch(() => {});
    closingTickets.delete(String(channel.id));
  }, 60_000).unref?.();
  return true;
}

function resultEmbed(request, check, noShow) {
  return new EmbedBuilder()
    .setColor(noShow ? 0xdc2626 : 0x64748b)
    .setTitle(noShow ? "🚫 Ready Check Missed • Requeued" : "↩️ Requester Unavailable • Requeued")
    .setDescription([
      `**Requester:** <@${check.requester}>`,
      `**Carrier:** <@${check.carrier}>`,
      `**Dungeon:** **${request.dungeon} • ${request.difficulty}**`,
      "",
      noShow
        ? "The requester did not confirm before the ready-check deadline."
        : "The requester said they cannot join this carry right now.",
      "They were removed from this ticket and their remaining carry request was returned to the live queue.",
      noShow ? "A no-show was also recorded in staff history." : null,
    ].filter(Boolean).join("\n"))
    .setFooter({ text: `Request ${request.id}` })
    .setTimestamp();
}

async function requeueReadyCheck(client, check, request, { noShow, reporterId }) {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { data: updated, error } = await supabase
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
      cancel_reason: null,
      updated_at: now,
    })
    .eq("id", request.id)
    .eq("ticket_channel_id", String(check.ticket_channel))
    .in("status", ACTIVE_STATUSES)
    .select("id")
    .maybeSingle();
  if (error) throw new Error(`Could not return request to queue: ${error.message}`);
  if (!updated?.id) {
    db.prepare("UPDATE carry_ready_checks SET status='stale', responded_at=? WHERE request_id=?")
      .run(Date.now(), String(request.id));
    return false;
  }

  db.prepare("UPDATE carry_ready_checks SET status=?, responded_at=? WHERE request_id=?")
    .run(noShow ? "no_show" : "unavailable", Date.now(), String(request.id));

  if (noShow) {
    try {
      recordNoShow({
        guildId: check.guild,
        requestId: request.id,
        offenderId: check.requester,
        reporterId: reporterId || check.carrier || "system",
        offenderSide: "requester",
        reason: `No response to ready check in ticket ${check.ticket_channel}; request automatically requeued.`,
      });
    } catch (error) {
      console.warn("[READY REQUEUE] Could not record no-show:", error.message);
    }
    await maybeSendAbuseAlert(
      client,
      check.guild,
      check.requester,
      `missed carry ready check ${request.id}`,
    ).catch(() => {});
  }

  const channel = await client.channels.fetch(String(check.ticket_channel)).catch(() => null);
  if (channel?.isTextBased?.()) {
    const message = check.message_id
      ? await channel.messages.fetch(String(check.message_id)).catch(() => null)
      : null;
    if (message?.editable) {
      await message.edit({
        content: `<@${check.requester}>`,
        embeds: [resultEmbed(request, check, noShow)],
        components: [],
        allowedMentions: { users: [String(check.requester)] },
      }).catch(() => {});
    }

    await channel.send({
      content: noShow
        ? `🚫 <@${check.requester}> did not ready up in time and was removed from this carry. Their request is back in the queue.`
        : `↩️ <@${check.requester}> cannot join right now and was removed from this carry. Their request is back in the queue.`,
      allowedMentions: { users: [String(check.requester)] },
    }).catch(() => {});

    await removeRequesterFromTicketIfDetached(channel, request);
    await refreshControlCenter(channel);
    await closeTicketIfEmpty(channel);
  }

  try {
    const requester = await client.users.fetch(String(check.requester));
    await requester.send([
      noShow ? "🚫 **You missed a Carry Tavern ready check.**" : "↩️ **Your carry was returned to the queue.**",
      `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
      `Request ID: \`${request.id}\``,
      "Your remaining request is still active in the queue and can be claimed again later.",
    ].join("\n"));
  } catch {}

  if (noShow && process.env.MOD_LOG_CHANNEL_ID) {
    const logChannel = await client.channels.fetch(process.env.MOD_LOG_CHANNEL_ID).catch(() => null);
    if (logChannel?.isTextBased?.()) {
      await logChannel.send([
        "🚫 **Carry Ready Check Missed • Auto Requeued**",
        `Request: \`${request.id}\``,
        `Ticket: <#${check.ticket_channel}>`,
        `Dungeon: **${request.dungeon} • ${request.difficulty}**`,
        `Carrier: <@${check.carrier}>`,
        `No-show: <@${check.requester}>`,
        "Action: requester removed from the ticket and the carry request returned to the live queue.",
      ].join("\n")).catch(() => {});
    }
  }

  return true;
}

async function expireReadyChecks(client) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT * FROM carry_ready_checks
      WHERE status='pending' AND deadline <= ?
      ORDER BY deadline ASC
    `).all(Date.now());
  } catch {
    return 0;
  }

  let requeued = 0;
  for (const check of rows) {
    const lock = db.prepare(`
      UPDATE carry_ready_checks
      SET status='processing'
      WHERE request_id=? AND status='pending' AND deadline <= ?
    `).run(String(check.request_id), Date.now());
    if (!lock.changes) continue;

    try {
      const request = await loadRequest(check.request_id);
      if (
        !request ||
        String(request.ticket_channel_id || "") !== String(check.ticket_channel) ||
        !ACTIVE_STATUSES.includes(String(request.status))
      ) {
        db.prepare("UPDATE carry_ready_checks SET status='stale', responded_at=? WHERE request_id=?")
          .run(Date.now(), String(check.request_id));
        continue;
      }

      if (await requeueReadyCheck(client, check, request, { noShow: true, reporterId: check.carrier })) {
        requeued += 1;
      }
    } catch (error) {
      console.error(`[READY REQUEUE] Failed to expire ready check ${check.request_id}:`, error);
      db.prepare("UPDATE carry_ready_checks SET status='pending' WHERE request_id=? AND status='processing'")
        .run(String(check.request_id));
    }
  }

  if (requeued) console.log(`[READY REQUEUE] Auto-requeued ${requeued} missed ready check(s).`);
  return requeued;
}

async function handleReadyCheckRequeueInteraction(interaction) {
  if (!interaction?.isButton?.()) return false;

  let match = /^carry_ready_no_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  const unavailable = Boolean(match);
  if (!match) match = /^carry_ready_missed_([0-9a-f-]{36})$/i.exec(interaction.customId || "");
  if (!match) return false;

  const requestId = match[1];
  const check = checkRow(requestId);
  if (!check || String(check.ticket_channel) !== String(interaction.channelId)) {
    await interaction.reply({ content: "❌ This ready check is no longer active in this ticket.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (check.status !== "pending") {
    await interaction.reply({ content: "ℹ️ This ready check has already been resolved.", flags: MessageFlags.Ephemeral });
    return true;
  }

  if (unavailable && String(check.requester) !== String(interaction.user.id)) {
    await interaction.reply({ content: "❌ Only the requester for this carry can use **Can't Join**.", flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!unavailable && Date.now() < Number(check.deadline)) {
    await interaction.reply({
      content: `⏳ Give the requester until <t:${Math.floor(Number(check.deadline) / 1000)}:t> (<t:${Math.floor(Number(check.deadline) / 1000)}:R>) to respond.`,
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const request = await loadRequest(requestId);
  if (
    !request ||
    String(request.ticket_channel_id || "") !== String(interaction.channelId) ||
    !ACTIVE_STATUSES.includes(String(request.status))
  ) {
    db.prepare("UPDATE carry_ready_checks SET status='stale', responded_at=? WHERE request_id=?")
      .run(Date.now(), String(requestId));
    await interaction.editReply("❌ This carry request is no longer active in this ticket.");
    return true;
  }

  if (!unavailable && !(await actorCanManage(interaction, request))) {
    await interaction.editReply("❌ Only the assigned Carrier or staff can record a missed ready check.");
    return true;
  }

  const lock = db.prepare("UPDATE carry_ready_checks SET status='processing' WHERE request_id=? AND status='pending'")
    .run(String(requestId));
  if (!lock.changes) {
    await interaction.editReply("ℹ️ This ready check was already resolved.");
    return true;
  }

  try {
    const changed = await requeueReadyCheck(interaction.client, check, request, {
      noShow: !unavailable,
      reporterId: interaction.user.id,
    });
    await interaction.editReply(changed
      ? unavailable
        ? "✅ You were removed from this ticket and your carry request was returned to the queue."
        : `✅ No-show recorded for <@${check.requester}>. They were removed from the ticket and their carry request was returned to the queue.`
      : "ℹ️ This carry request had already changed, so nothing else was modified.");
  } catch (error) {
    db.prepare("UPDATE carry_ready_checks SET status='pending' WHERE request_id=? AND status='processing'")
      .run(String(requestId));
    throw error;
  }
  return true;
}

module.exports = {
  expireReadyChecks,
  handleReadyCheckRequeueInteraction,
};
