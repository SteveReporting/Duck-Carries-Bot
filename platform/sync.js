const { EmbedBuilder } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");
const { marketplaceBaseUrl } = require("./helpers");
const { loadLiveLegacyQueue } = require("./legacyQueue");

const seenListings = new Set();
const seenCarries = new Set();
let initialized = false;
let timer = null;
let ticks = 0;

function carrierRoleMap() {
  return {
    "Barback": process.env.CARRIER_ROLE_BARBACK || process.env.CARRIER_ROLE,
    "Bartender": process.env.CARRIER_ROLE_BARTENDER,
    "Caskkeeper": process.env.CARRIER_ROLE_CASKKEEPER,
    "Tapmaster": process.env.CARRIER_ROLE_TAPMASTER,
    "Brewmaster": process.env.CARRIER_ROLE_BREWMASTER,
    "Master of the Tap": process.env.CARRIER_ROLE_MASTER_OF_TAP,
  };
}

function eventFeedChannelId() {
  return process.env.EVENT_FEED_CHANNEL_ID || process.env.EVENT_ANNOUNCEMENT_CHANNEL_ID || null;
}

async function safeChannel(client, id) {
  if (!id) return null;
  try {
    const channel = await client.channels.fetch(id);
    return channel?.isTextBased?.() ? channel : null;
  } catch (error) {
    console.warn(`[PLATFORM] Could not fetch channel ${id}:`, error.message);
    return null;
  }
}

async function heartbeat() {
  const supabase = getSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from("system_status").upsert({
    service: "discord_bot",
    status: "operational",
    message: "Carry Tavern Discord bot is online",
    last_heartbeat_at: now,
    updated_at: now,
  }, { onConflict: "service" });
  if (error) throw new Error(`Heartbeat failed: ${error.message}`);
}

async function syncLegacyDiscordQueue(client) {
  const guildId = process.env.GUILD_ID;
  if (!guildId) return;

  const rows = await loadLiveLegacyQueue(client, guildId, { maxMessages: 500 });
  const supabase = getSupabase();
  const now = new Date().toISOString();

  const { error: deactivateError } = await supabase
    .from("discord_carry_queue")
    .update({ active: false, synced_at: now })
    .eq("guild_id", guildId)
    .eq("active", true);
  if (deactivateError) throw new Error(`Discord queue bridge deactivate failed: ${deactivateError.message}`);

  if (!rows.length) {
    console.log("[QUEUE BRIDGE] No live Discord carry messages found.");
    return;
  }

  const payload = rows.map((row) => ({
    guild_id: String(row.guild),
    legacy_id: Number(row.id),
    discord_user_id: row.user ? String(row.user) : null,
    roblox_username: row.roblox || null,
    dungeon: row.dungeon || "Unknown dungeon",
    difficulty: row.difficulty || null,
    runs: row.runs == null ? null : String(row.runs),
    availability: row.availability || null,
    discord_carrier_id: row.carrier ? String(row.carrier) : null,
    status: row.status || "waiting",
    active: true,
    synced_at: now,
  }));

  const { error: upsertError } = await supabase
    .from("discord_carry_queue")
    .upsert(payload, { onConflict: "guild_id,legacy_id" });
  if (upsertError) throw new Error(`Discord queue bridge sync failed: ${upsertError.message}`);

  console.log(`[QUEUE BRIDGE] Mirrored ${rows.length} live Discord carry request(s).`);
}

async function syncDiscordContentFeed(client, feedType, channelId) {
  if (!channelId) return;
  const channel = await safeChannel(client, channelId);
  if (!channel?.messages?.fetch) {
    console.warn(`[DISCORD FEED] ${feedType}: configured channel ${channelId} is not readable.`);
    return;
  }

  const fetched = await channel.messages.fetch({ limit: 100 });
  const messages = [...fetched.values()]
    .filter((message) => !message.author?.bot && String(message.content || "").trim())
    .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  if (!messages.length) return;

  const now = new Date().toISOString();
  const payload = messages.map((message) => ({
    message_id: String(message.id),
    feed_type: feedType,
    guild_id: String(message.guildId || process.env.GUILD_ID || ""),
    channel_id: String(channel.id),
    author_discord_id: String(message.author.id),
    author_username: message.author.username,
    author_display_name: message.member?.displayName || message.author.globalName || message.author.username,
    author_avatar_url: message.author.displayAvatarURL({ extension: "png", size: 128 }),
    content: String(message.content).slice(0, 8000),
    message_url: message.url,
    posted_at: message.createdAt.toISOString(),
    edited_at: message.editedAt ? message.editedAt.toISOString() : null,
    synced_at: now,
  }));

  const supabase = getSupabase();
  const { error } = await supabase
    .from("discord_content_feed")
    .upsert(payload, { onConflict: "message_id" });
  if (error) throw new Error(`${feedType} Discord feed sync failed: ${error.message}`);
}

async function syncDiscordFeeds(client) {
  await Promise.all([
    syncDiscordContentFeed(client, "event", eventFeedChannelId()),
    syncDiscordContentFeed(client, "announcement", process.env.ANNOUNCEMENT_CHANNEL_ID || null),
  ]);
}

async function pollListings(client, announce) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("listings")
    .select("id,item_name,price_gold,quantity,potential,created_at,expires_at")
    .eq("status", "available")
    .gt("quantity", 0)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  for (const listing of data || []) {
    const isNew = !seenListings.has(listing.id);
    seenListings.add(listing.id);
    if (!announce || !isNew) continue;
    const channel = await safeChannel(client, process.env.MARKETPLACE_CHANNEL_ID);
    if (!channel) continue;
    const base = marketplaceBaseUrl();
    const embed = new EmbedBuilder()
      .setTitle(`💰 New Tavern Listing: ${listing.item_name}`)
      .addFields(
        { name: "Price", value: `${Number(listing.price_gold).toLocaleString("en-US")} gold`, inline: true },
        { name: "Quantity", value: String(listing.quantity), inline: true },
        { name: "Potential", value: listing.potential == null ? "Not set" : Number(listing.potential).toLocaleString("en-US"), inline: true },
      );
    if (base) embed.setURL(`${base}/market/${listing.id}`);
    await channel.send({ embeds: [embed] });
  }
}

async function pollCarries(client, announce) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("carry_requests")
    .select("id,dungeon,difficulty,runs_requested,created_at")
    .eq("status", "queued")
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  for (const carry of data || []) {
    const isNew = !seenCarries.has(carry.id);
    seenCarries.add(carry.id);
    if (!announce || !isNew) continue;
    const channel = await safeChannel(client, process.env.CARRY_QUEUE_CHANNEL_ID);
    if (!channel) continue;
    const base = marketplaceBaseUrl();
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ New Carry Request: ${carry.dungeon}`)
      .setDescription(`${carry.difficulty} · ${carry.runs_requested} run${carry.runs_requested === 1 ? "" : "s"}\nUse \`/queue view\` to see and claim the live queue.`);
    if (base) embed.setURL(`${base}/carry-queue`);
    await channel.send({ embeds: [embed] });
  }
}

async function pollDiscordNotifications(client) {
  if (String(process.env.DM_NOTIFICATIONS_ENABLED).toLowerCase() !== "true") return;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("notifications")
    .select("id,title,body,link,user:profiles!notifications_user_id_fkey(discord_id)")
    .is("discord_delivered_at", null)
    .order("created_at", { ascending: true })
    .limit(25);
  if (error) throw error;
  for (const notification of data || []) {
    const discordId = notification.user?.discord_id;
    if (!discordId) continue;
    try {
      const discordUser = await client.users.fetch(discordId);
      const base = marketplaceBaseUrl();
      const target = base && notification.link ? `${base}${notification.link}` : null;
      await discordUser.send(`🍺 **${notification.title}**\n${notification.body || ""}${target ? `\n${target}` : ""}`.slice(0, 1900));
      await supabase.from("notifications").update({ discord_delivered_at: new Date().toISOString() }).eq("id", notification.id);
    } catch (error) {
      console.warn(`[DM] Could not deliver notification ${notification.id}:`, error.message);
    }
  }
}

function rankForMember(member, roleMap) {
  const ranks = ["Master of the Tap", "Brewmaster", "Tapmaster", "Caskkeeper", "Bartender", "Barback"];
  return ranks.find((rank) => roleMap[rank] && member.roles.cache.has(roleMap[rank])) || null;
}

async function syncDiscordCarrierProfiles(client) {
  const roleMap = carrierRoleMap();
  const configuredRoleIds = [...new Set(Object.values(roleMap).filter(Boolean))];
  if (!configuredRoleIds.length || !process.env.GUILD_ID) return;

  const supabase = getSupabase();
  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id,discord_id")
    .not("discord_id", "is", null)
    .limit(5000);
  if (error) throw error;

  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  let synced = 0;

  for (const profile of profiles || []) {
    let member;
    try {
      member = await guild.members.fetch(profile.discord_id);
    } catch {
      continue;
    }

    const rank = rankForMember(member, roleMap);
    if (!rank) continue;

    const now = new Date().toISOString();
    const { error: carrierError } = await supabase.from("carrier_profiles").upsert({
      user_id: profile.id,
      carrier_rank: rank,
      active: true,
      updated_at: now,
    }, { onConflict: "user_id" });
    if (carrierError) throw carrierError;

    const { error: roleError } = await supabase.from("user_roles").upsert({
      user_id: profile.id,
      role: "carrier",
      granted_by: null,
    }, { onConflict: "user_id,role" });
    if (roleError) throw roleError;
    synced += 1;
  }

  if (synced) console.log(`[CARRIER PROFILE SYNC] Matched ${synced} Discord Carrier role member(s) to website Carrier profiles.`);
}

async function syncCarrierRoles(client) {
  const roleMap = carrierRoleMap();
  const configuredRoleIds = [...new Set(Object.values(roleMap).filter(Boolean))];
  if (!configuredRoleIds.length || !process.env.GUILD_ID) return;
  const supabase = getSupabase();
  const { data, error } = await supabase.from("carrier_profiles")
    .select("user_id,carrier_rank,active,profile:profiles!carrier_profiles_user_id_fkey(discord_id)")
    .eq("active", true);
  if (error) throw error;
  const guild = await client.guilds.fetch(process.env.GUILD_ID);
  for (const carrier of data || []) {
    const discordId = carrier.profile?.discord_id;
    const desiredRole = roleMap[carrier.carrier_rank];
    if (!discordId || !desiredRole) continue;
    try {
      const member = await guild.members.fetch(discordId);
      const remove = configuredRoleIds.filter((id) => id !== desiredRole && member.roles.cache.has(id));
      if (remove.length) await member.roles.remove(remove, "Carry Tavern automatic Carrier rank sync");
      if (!member.roles.cache.has(desiredRole)) await member.roles.add(desiredRole, "Carry Tavern automatic Carrier rank sync");
    } catch (error) {
      console.warn(`[CARRIER ROLE SYNC] ${discordId}:`, error.message);
    }
  }
}

async function tick(client) {
  try {
    ticks += 1;
    await heartbeat();
    await Promise.all([
      syncLegacyDiscordQueue(client),
      syncDiscordFeeds(client),
      pollListings(client, initialized),
      pollCarries(client, initialized),
      pollDiscordNotifications(client),
    ]);
    if (ticks === 1 || ticks % 5 === 0) {
      await syncDiscordCarrierProfiles(client);
      await syncCarrierRoles(client);
    }
    initialized = true;
  } catch (error) {
    console.error("[PLATFORM SYNC]", error);
  }
}

function startPlatformSync(client) {
  if (timer) return;
  void tick(client);
  timer = setInterval(() => void tick(client), 60_000);
  timer.unref?.();
}

module.exports = { startPlatformSync, syncLegacyDiscordQueue, syncDiscordFeeds, syncDiscordCarrierProfiles };
