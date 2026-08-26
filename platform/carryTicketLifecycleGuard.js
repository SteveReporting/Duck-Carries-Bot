const db = require("../database/database");
const { getSupabase } = require("../marketplace/supabase");

function isCarryTicket(channel) {
  return Boolean(
    channel?.isTextBased?.() &&
    !channel.isThread?.() &&
    String(channel.name || "").toLowerCase().startsWith("carry-"),
  );
}

function hasActiveLegacyLink(channelId) {
  try {
    const row = db
      .prepare("SELECT id FROM queue WHERE ticket_channel = ? AND status = 'claimed' LIMIT 1")
      .get(String(channelId));
    return Boolean(row);
  } catch (error) {
    console.warn(`[CARRY TICKET GUARD] Legacy lookup failed for ${channelId}: ${error.message}`);
    return false;
  }
}

async function hasActivePlatformLink(channelId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("carry_requests")
    .select("id")
    .eq("ticket_channel_id", String(channelId))
    .in("status", ["claimed", "in_progress"])
    .limit(1);

  if (error) throw new Error(error.message);
  return Boolean(data?.length);
}

async function hasActiveTicketLink(channelId) {
  if (hasActiveLegacyLink(channelId)) return true;
  return hasActivePlatformLink(channelId);
}

async function removeOrphanedCarryTicket(channel, reason = "Removing orphaned/restored closed carry ticket") {
  if (!isCarryTicket(channel)) return false;

  const active = await hasActiveTicketLink(channel.id);
  if (active) return false;

  await channel.delete(reason);
  console.log(`[CARRY TICKET GUARD] Removed closed/orphaned ticket #${channel.name} (${channel.id}).`);
  return true;
}

async function cleanupOrphanedCarryTickets(client) {
  if (!process.env.GUILD_ID) return { checked: 0, removed: 0, failed: 0 };

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) return { checked: 0, removed: 0, failed: 0 };

  const channels = await guild.channels.fetch().catch(() => null);
  if (!channels) return { checked: 0, removed: 0, failed: 0 };

  let checked = 0;
  let removed = 0;
  let failed = 0;

  for (const channel of channels.values()) {
    if (!isCarryTicket(channel)) continue;
    checked += 1;

    try {
      if (await removeOrphanedCarryTicket(channel)) removed += 1;
    } catch (error) {
      failed += 1;
      console.warn(`[CARRY TICKET GUARD] Could not inspect #${channel.name}: ${error.message}`);
    }
  }

  return { checked, removed, failed };
}

module.exports = {
  isCarryTicket,
  hasActiveTicketLink,
  removeOrphanedCarryTicket,
  cleanupOrphanedCarryTickets,
};
