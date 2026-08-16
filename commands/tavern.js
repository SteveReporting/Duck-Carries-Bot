const {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const {
  displayName,
  formatServiceMinutes,
  marketplaceBaseUrl,
  requireLinkedProfile,
} = require("../platform/helpers");

const CARRY_TAVERN_ROBLOX_GROUP_ID = 738161741;

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`Roblox API returned ${response.status}. Try again shortly.`);
  return response.json();
}

async function profileCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const supabase = getSupabase();
  const [{ data: fullProfile }, { data: roles }, { data: carrier }, { data: achievements }] = await Promise.all([
    supabase.from("profiles").select("roblox_username,roblox_display_name,roblox_verified_at,roblox_community_member,roblox_community_role,roblox_account_created_at").eq("id", profile.id).maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", profile.id),
    supabase.from("carrier_profiles").select("carrier_rank,completed_carries,service_minutes").eq("user_id", profile.id).maybeSingle(),
    supabase.from("user_achievements").select("achievement:achievements(name,icon)").eq("user_id", profile.id).limit(8),
  ]);
  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle(`🍺 ${displayName(profile)}'s Tavern Profile`)
    .addFields(
      { name: "⚔️ Carries", value: String(profile.total_carries ?? 0), inline: true },
      { name: "⏱️ Service", value: formatServiceMinutes(profile.total_service_minutes ?? 0), inline: true },
      { name: "💰 Trades", value: String(profile.completed_trades ?? 0), inline: true },
      { name: "⭐ Trust", value: String(profile.trust_score ?? 100), inline: true },
      { name: "🎮 DQ Level", value: profile.dq_level == null ? "Not set" : String(profile.dq_level), inline: true },
      { name: "🛡️ Trader", value: profile.verified_trader ? "Verified" : "Standard", inline: true },
      { name: "Roles", value: roles?.length ? roles.map((r) => `\`${r.role}\``).join(" ") : "`member`" },
    );
  if (fullProfile?.roblox_verified_at) {
    embed.addFields({ name: "🟥 Roblox", value: `${fullProfile.roblox_display_name || fullProfile.roblox_username}${fullProfile.roblox_community_member ? ` · Tavern community${fullProfile.roblox_community_role ? ` (${fullProfile.roblox_community_role})` : ""}` : ""}` });
  }
  if (carrier) embed.addFields({ name: "🍻 Carrier", value: `${carrier.carrier_rank} · ${carrier.completed_carries} carries · ${formatServiceMinutes(carrier.service_minutes)}` });
  if (achievements?.length) embed.addFields({ name: "🏅 Achievements", value: achievements.map((a) => `${a.achievement?.icon ?? "🏅"} ${a.achievement?.name ?? "Achievement"}`).join("\n") });
  if (base) embed.setURL(`${base}/profile/${profile.id}`);
  return interaction.editReply({ embeds: [embed] });
}

async function statusCommand(interaction) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("system_status").select("service,status,message,last_heartbeat_at").order("service");
  if (error) throw new Error(error.message);
  const now = Date.now();
  const lines = (data || []).map((row) => {
    let status = row.status;
    if (row.service === "discord_bot" && (!row.last_heartbeat_at || now - new Date(row.last_heartbeat_at).getTime() > 180_000)) status = "outage";
    const icon = status === "operational" ? "🟢" : status === "maintenance" ? "🟡" : status === "degraded" ? "🟠" : status === "outage" ? "🔴" : "⚪";
    return `${icon} **${row.service.replaceAll("_", " ")}** — ${status}`;
  });
  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder().setTitle("🍺 Carry Tavern Status").setDescription(lines.join("\n"));
  if (base) embed.setURL(`${base}/status`);
  return interaction.reply({ embeds: [embed] });
}

async function eventsCommand(interaction) {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("events").select("id,title,event_type,starts_at,location_text").eq("status", "published").gte("starts_at", new Date().toISOString()).order("starts_at").limit(10);
  if (error) throw new Error(error.message);
  if (!data?.length) return interaction.reply("🍺 No upcoming Tavern events are published right now.");
  const base = marketplaceBaseUrl();
  const lines = data.map((event) => `**${event.title}**\n${event.event_type.replaceAll("_", " ")} · <t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:F>${event.location_text ? `\n📍 ${event.location_text}` : ""}`);
  const embed = new EmbedBuilder().setTitle("🏆 Upcoming Tavern Events").setDescription(lines.join("\n\n"));
  if (base) embed.setURL(`${base}/events`);
  return interaction.reply({ embeds: [embed] });
}

async function verifyRobloxCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;
  const supabase = getSupabase();
  const { data: pending, error } = await supabase.from("roblox_link_requests")
    .select("id,roblox_username,verification_code,status")
    .eq("user_id", profile.id).eq("status", "pending").order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(error.message);
  if (!pending) {
    const base = marketplaceBaseUrl();
    return interaction.editReply(`❌ You do not have a pending Roblox link request.${base ? `\nCreate one first: ${base}/roblox-link` : ""}`);
  }

  const resolved = await fetchJson("https://users.roblox.com/v1/usernames/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ usernames: [pending.roblox_username], excludeBannedUsers: true }),
  });
  const account = resolved?.data?.[0];
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${pending.roblox_username}**.`);

  const details = await fetchJson(`https://users.roblox.com/v1/users/${account.id}`);
  const description = String(details?.description || "");
  if (!description.includes(pending.verification_code)) {
    return interaction.editReply(`❌ Verification code not found in the Roblox profile description for **${details?.name || pending.roblox_username}**.\n\nPut this exact code anywhere in that Roblox profile's About/description, save it, then run this command again:\n\`${pending.verification_code}\``);
  }

  let avatarUrl = null;
  try {
    const thumbnails = await fetchJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${account.id}&size=150x150&format=Png&isCircular=false`);
    avatarUrl = thumbnails?.data?.[0]?.imageUrl || null;
  } catch (thumbError) {
    console.warn("[ROBLOX VERIFY] Thumbnail lookup failed:", thumbError.message);
  }

  let communityMember = false;
  let communityRole = null;
  try {
    const groups = await fetchJson(`https://groups.roblox.com/v1/users/${account.id}/groups/roles`);
    const membership = (groups?.data || []).find((entry) => Number(entry?.group?.id) === CARRY_TAVERN_ROBLOX_GROUP_ID);
    communityMember = Boolean(membership);
    communityRole = membership?.role?.name || null;
  } catch (groupError) {
    console.warn("[ROBLOX VERIFY] Community lookup failed:", groupError.message);
  }

  const verifiedAt = new Date().toISOString();
  const { error: requestUpdateError } = await supabase.from("roblox_link_requests").update({
    status: "verified",
    roblox_user_id: String(account.id),
    verified_at: verifiedAt,
  }).eq("id", pending.id).eq("user_id", profile.id).eq("status", "pending");
  if (requestUpdateError) throw new Error(requestUpdateError.message);

  const { error: profileUpdateError } = await supabase.from("profiles").update({
    roblox_username: details?.name || pending.roblox_username,
    roblox_user_id: String(account.id),
    roblox_display_name: details?.displayName || details?.name || pending.roblox_username,
    roblox_avatar_url: avatarUrl,
    roblox_verified_at: verifiedAt,
    roblox_account_created_at: details?.created || null,
    roblox_community_member: communityMember,
    roblox_community_role: communityRole,
  }).eq("id", profile.id);
  if (profileUpdateError) throw new Error(profileUpdateError.message);

  await supabase.from("notifications").insert({ user_id: profile.id, kind: "roblox_link", title: "Roblox account verified", body: `${details?.name || pending.roblox_username} was verified through your Roblox profile description.`, link: "/hub" });
  await supabase.from("audit_log").insert({ actor_id: profile.id, action: "roblox.self_verify", target_type: "profile", target_id: profile.id, new_value: { roblox_user_id: String(account.id), roblox_username: details?.name, community_member: communityMember }, source: "discord" });

  return interaction.editReply(`✅ Roblox account verified: **${details?.displayName || details?.name}** (@${details?.name})${communityMember ? `\n🍺 Carry Tavern Roblox community member${communityRole ? ` — **${communityRole}**` : ""}` : "\nℹ️ This Roblox account is not currently in the Carry Tavern Roblox community."}`);
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tavern")
    .setDescription("Carry Tavern account and platform")
    .addSubcommand((s) => s.setName("profile").setDescription("View your linked Tavern profile"))
    .addSubcommand((s) => s.setName("verify-roblox").setDescription("Verify your pending Roblox link using your profile description code"))
    .addSubcommand((s) => s.setName("status").setDescription("View platform status"))
    .addSubcommand((s) => s.setName("events").setDescription("View upcoming Tavern events")),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "profile") return await profileCommand(interaction);
      if (sub === "verify-roblox") return await verifyRobloxCommand(interaction);
      if (sub === "status") return await statusCommand(interaction);
      return await eventsCommand(interaction);
    } catch (error) {
      console.error("[TAVERN]", error);
      if (interaction.deferred || interaction.replied) return interaction.editReply(`❌ ${error.message || "Tavern request failed."}`);
      return interaction.reply({ content: "❌ Tavern request failed.", flags: MessageFlags.Ephemeral });
    }
  },
};
