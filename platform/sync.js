const { EmbedBuilder } = require("discord.js");
const { getSupabase } = require("../marketplace/supabase");
const { marketplaceBaseUrl } = require("./helpers");

const seenEvents = new Set();
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

async function pollEvents(client, announce) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("events")
    .select("id,title,description,event_type,starts_at,location_text")
    .eq("status", "published")
    .gte("starts_at", new Date(Date.now() - 60_000).toISOString())
    .order("created_at", { ascending: false }).limit(100);
  if (error) throw error;
  for (const event of data || []) {
    const isNew = !seenEvents.has(event.id);
    seenEvents.add(event.id);
    if (!announce || !isNew) continue;
    const channel = await safeChannel(client, process.env.EVENT_ANNOUNCEMENT_CHANNEL_ID);
    if (!channel) continue;
    const base = marketplaceBaseUrl();
    const embed = new EmbedBuilder()
      .setTitle(`🏆 ${event.title}`)
      .setDescription((event.description || "Tavern event").slice(0, 3500))
      .addFields({ name: "Starts", value: `<t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:F>` }, { name: "Type", value: event.event_type.replaceAll("_", " "), inline: true });
    if (event.location_text) embed.addFields({ name: "Location", value: event.location_text, inline: true });
    if (base) embed.setURL(`${base}/events`);
    await channel.send({ embeds: [embed] });
  }
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
      pollEvents(client, initialized),
      pollListings(client, initialized),
      pollCarries(client, initialized),
      pollDiscordNotifications(client),
    ]);
    if (ticks === 1 || ticks % 5 === 0) await syncCarrierRoles(client);
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

module.exports = { startPlatformSync };
