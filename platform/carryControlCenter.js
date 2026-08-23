const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  StringSelectMenuBuilder,
} = require("discord.js");

const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");

const SELECT_ID = "carry_control_select";
const CENTER_FOOTER = "The Carry Tavern • Carry Control Center";

function isCarryTicket(channel) {
  return Boolean(
    channel &&
      channel.type === ChannelType.GuildText &&
      String(channel.name || "").toLowerCase().startsWith("carry-"),
  );
}

function remainingRuns(request) {
  return Math.max(
    0,
    Number(request.runs_requested || request.runs || 0) -
      Number(request.runs_completed || 0),
  );
}

function plannedRuns(request) {
  const remaining = remainingRuns(request);
  const planned = Number(request.session_runs || remaining || 1);
  return Math.max(0, Math.min(remaining || planned, planned));
}

function requesterLabel(request) {
  return String(
    request.requester?.roblox_username ||
      request.requester?.discord_display_name ||
      request.requester?.discord_username ||
      request.roblox ||
      request.user ||
      "Requester",
  ).slice(0, 60);
}

function requesterMention(request) {
  const id = request.requester?.discord_id || request.user;
  return id ? `<@${id}>` : requesterLabel(request);
}

function carrierMention(request) {
  const id = request.carrier?.discord_id || request.carrier;
  return id ? `<@${id}>` : "Carrier";
}

function statusText(requests) {
  return requests.some((request) => request.status === "in_progress")
    ? "🟢 In Progress"
    : "🟡 Claimed";
}

function shortId(id) {
  return String(id || "").slice(0, 8);
}

function cleanOptional(value, max = 300) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function loadPlatformRequests(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select(
      "id,requester_id,carrier_id,dungeon,difficulty,runs_requested,runs_completed,session_runs,availability,notes,status,claimed_at,started_at,ticket_channel_id,created_at,requester:profiles!carry_requests_requester_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username),carrier:profiles!carry_requests_carrier_id_fkey(id,discord_id,discord_username,discord_display_name,roblox_username)",
    )
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return (data || []).map((row) => ({ ...row, source: "platform" }));
}

function loadLegacyRequests(channelId) {
  try {
    return db
      .prepare(
        `
        SELECT *
        FROM queue
        WHERE ticket_channel = ? AND status = 'claimed'
        ORDER BY id ASC
      `,
      )
      .all(String(channelId))
      .map((row) => ({
        ...row,
        source: "legacy",
        runs_requested: Number(row.runs || 1),
        runs_completed: 0,
        session_runs: Number(row.runs || 1),
        requester: {
          discord_id: row.user,
          roblox_username: row.roblox || null,
        },
        carrier: { discord_id: row.carrier || null },
      }));
  } catch (error) {
    if (String(error.message || "").includes("no such column")) return [];
    throw error;
  }
}

async function loadActiveRequests(channelId) {
  const [platform, legacy] = await Promise.all([
    loadPlatformRequests(channelId),
    Promise.resolve(loadLegacyRequests(channelId)),
  ]);
  return [...platform, ...legacy];
}

function requestField(request, index) {
  const remaining = remainingRuns(request);
  const session = plannedRuns(request);
  const after = Math.max(0, remaining - session);
  const roblox = request.requester?.roblox_username || request.roblox || null;
  const availability = cleanOptional(request.availability, 180);
  const notes = cleanOptional(request.notes, 220);
  const lines = [
    `**Discord:** ${requesterMention(request)}`,
    roblox ? `**Roblox:** @${roblox}` : null,
    request.source === "platform"
      ? `**Runs:** ${remaining} remaining • ${session} this session • ${after === 0 ? "✅ finishes" : `🔁 ${after} left after`}`
      : `**Runs:** ${remaining}`,
    availability ? `**Availability:** ${availability}` : null,
    notes ? `**Notes:** ${notes}` : null,
    `**Request:** \`${shortId(request.id)}…\``,
  ].filter(Boolean);

  return {
    name: `${index + 1}. ${requesterLabel(request)}`.slice(0, 256),
    value: lines.join("\n").slice(0, 1024),
    inline: false,
  };
}

function controlCenterEmbed(requests) {
  const first = requests[0];
  const totalSessionRuns = Math.max(...requests.map((request) => plannedRuns(request)), 0);
  const fields = requests.slice(0, 20).map(requestField);

  return new EmbedBuilder()
    .setColor(0xc89532)
    .setTitle(
      `🍺 ${first?.dungeon || "Carry"} • ${first?.difficulty || ""}`.trim(),
    )
    .setDescription([
      "### Carry Control Center",
      "Everything for this carry is managed from this one panel.",
      "",
      `**Carrier:** ${carrierMention(first)}`,
      `**Status:** ${statusText(requests)}`,
      `**Requesters:** ${requests.length}`,
      first?.source === "platform" ? `**Session:** ${totalSessionRuns} run${totalSessionRuns === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join("\n"))
    .addFields(fields)
    .addFields({
      name: "How to use this ticket",
      value: [
        "📣 **Ready Check** when you are ready to start.",
        "✅ **Complete Session** after the planned runs are finished.",
        requests.length > 1
          ? "Use the requester dropdown for cancel, delete or no-show actions."
          : "Use the request controls below for cancel, delete or no-show actions.",
      ].join("\n"),
      inline: false,
    })
    .setFooter({ text: CENTER_FOOTER })
    .setTimestamp();
}

function globalPlatformRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("carry_readycheck_start")
      .setLabel("Ready Check")
      .setEmoji("📣")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("carry_carrier_complete")
      .setLabel("Complete Session")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId("carry_release_claim")
      .setLabel("Release Claim")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("carry_show_ids")
      .setLabel("Show IDs")
      .setEmoji("📋")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("carry_close_ticket")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );
}

function legacyGlobalRow(request) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`complete_${request.id}`)
      .setLabel("Carrier Complete")
      .setEmoji("✅")
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`legacy_release_${request.id}`)
      .setLabel("Release Claim")
      .setEmoji("🔁")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("carry_close_ticket")
      .setLabel("Close Ticket")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger),
  );
}

function requestSelectRow(requests, selectedId) {
  if (requests.length <= 1) return null;

  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(SELECT_ID)
      .setPlaceholder("Choose a requester to manage")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        requests.slice(0, 25).map((request, index) => ({
          label: `${index + 1}. ${requesterLabel(request)}`.slice(0, 100),
          value: String(request.id),
          description: `${remainingRuns(request)} run${remainingRuns(request) === 1 ? "" : "s"} left • ${request.status}`.slice(0, 100),
          default: String(request.id) === String(selectedId),
        })),
      ),
  );
}

function requestActionRow(requestId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`carry_cancel_${requestId}`)
      .setLabel("Cancel Request")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`carry_delete_${requestId}`)
      .setLabel("Delete Request")
      .setEmoji("🗑️")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`carry_noshow_${requestId}`)
      .setLabel("Report No-Show")
      .setEmoji("🚫")
      .setStyle(ButtonStyle.Danger),
  );
}

function buildComponents(requests, selectedId = null) {
  if (!requests.length) return [];
  const first = requests[0];

  if (first.source === "legacy") {
    return [legacyGlobalRow(first)];
  }

  const selected =
    requests.find((request) => String(request.id) === String(selectedId)) ||
    requests[0];

  const rows = [globalPlatformRow()];
  const select = requestSelectRow(requests, selected.id);
  if (select) rows.push(select);
  rows.push(requestActionRow(selected.id));
  return rows;
}

function messageIsUnified(message) {
  return Boolean(
    message?.author?.bot &&
      ((message.embeds || []).some((embed) =>
        String(embed.footer?.text || "").includes(CENTER_FOOTER),
      ) ||
        (message.components || []).some((row) =>
          (row.components || []).some(
            (component) => component.customId === SELECT_ID,
          ),
        )),
  );
}

function hasPersistentOldControls(message) {
  if (!message?.author?.bot || messageIsUnified(message)) return false;

  const ids = (message.components || [])
    .flatMap((row) => row.components || [])
    .map((component) => String(component.customId || ""));

  return ids.some(
    (id) =>
      id === "carry_carrier_complete" ||
      id === "carry_release_claim" ||
      id === "carry_show_ids" ||
      id === "carry_readycheck_start" ||
      id === "carry_close_ticket" ||
      id.startsWith("carry_cancel_") ||
      id.startsWith("carry_delete_") ||
      id.startsWith("carry_noshow_") ||
      id.startsWith("complete_") ||
      id.startsWith("requester_complete_") ||
      id.startsWith("legacy_release_"),
  );
}

async function findRecentMessages(channel) {
  return channel.messages.fetch({ limit: 100 }).catch(() => null);
}

async function existingControlCenter(channel) {
  const messages = await findRecentMessages(channel);
  if (!messages) return null;
  return (
    messages.find(
      (message) =>
        message.author?.id === channel.client.user.id &&
        messageIsUnified(message),
    ) || null
  );
}

async function deleteOldPersistentPanels(channel, keepMessageId = null) {
  const messages = await findRecentMessages(channel);
  if (!messages) return 0;

  let deleted = 0;
  for (const message of messages.values()) {
    if (keepMessageId && String(message.id) === String(keepMessageId)) continue;
    if (!hasPersistentOldControls(message)) continue;
    await message
      .delete()
      .then(() => {
        deleted += 1;
      })
      .catch(() => {});
  }
  return deleted;
}

function participantMentions(requests) {
  const ids = new Set();
  for (const request of requests) {
    const carrierId = request.carrier?.discord_id || request.carrier;
    const requesterId = request.requester?.discord_id || request.user;
    if (carrierId) ids.add(String(carrierId));
    if (requesterId) ids.add(String(requesterId));
  }
  return [...ids];
}

async function ensureCarryControlCenter(channel, { replace = true, ping = false } = {}) {
  if (!isCarryTicket(channel) || !channel.isTextBased?.()) return null;

  const requests = await loadActiveRequests(channel.id);
  if (!requests.length) return null;

  let message = await existingControlCenter(channel);
  const payload = {
    embeds: [controlCenterEmbed(requests)],
    components: buildComponents(requests),
  };

  if (message) {
    await message.edit(payload);
  } else {
    const mentions = ping ? participantMentions(requests) : [];
    message = await channel.send({
      ...payload,
      content: mentions.length ? mentions.map((id) => `<@${id}>`).join(" ") : undefined,
      allowedMentions: mentions.length ? { users: mentions } : undefined,
    });
  }

  if (replace) await deleteOldPersistentPanels(channel, message.id);
  return message;
}

async function handleControlCenterSelect(interaction) {
  if (
    !interaction.isStringSelectMenu() ||
    interaction.customId !== SELECT_ID
  ) {
    return false;
  }

  const requests = await loadActiveRequests(interaction.channelId);
  if (!requests.length) {
    await interaction.reply({
      content: "❌ This carry no longer has any active requests.",
      ephemeral: true,
    });
    return true;
  }

  const selectedId = interaction.values[0];
  if (
    !requests.some((request) => String(request.id) === String(selectedId))
  ) {
    await interaction.reply({
      content: "❌ That request is no longer active in this ticket.",
      ephemeral: true,
    });
    return true;
  }

  await interaction.update({
    embeds: [controlCenterEmbed(requests)],
    components: buildComponents(requests, selectedId),
  });
  return true;
}

async function retrofitCarryControlCenters(client) {
  if (!process.env.GUILD_ID) return { updated: 0, deleted: 0 };

  const guild = await client.guilds
    .fetch(process.env.GUILD_ID)
    .catch(() => null);
  if (!guild) return { updated: 0, deleted: 0 };

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return { updated: 0, deleted: 0 };

  let updated = 0;
  let deleted = 0;

  for (const channel of channels.values()) {
    if (!isCarryTicket(channel)) continue;

    try {
      const requests = await loadActiveRequests(channel.id);
      if (!requests.length) continue;

      let message = await existingControlCenter(channel);
      const payload = {
        embeds: [controlCenterEmbed(requests)],
        components: buildComponents(requests),
      };

      if (message) await message.edit(payload);
      else message = await channel.send(payload);

      updated += 1;
      deleted += await deleteOldPersistentPanels(channel, message.id);
    } catch (error) {
      console.warn(
        `[CARRY CONTROL CENTER] Could not update #${
          channel?.name || channel?.id
        }:`,
        error.message,
      );
    }
  }

  return { updated, deleted };
}

module.exports = {
  SELECT_ID,
  ensureCarryControlCenter,
  handleControlCenterSelect,
  retrofitCarryControlCenters,
};
