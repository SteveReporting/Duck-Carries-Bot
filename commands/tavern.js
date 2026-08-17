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
const {
  checkRobloxDescriptionVerification,
  getCommunityMembership,
  getRobloxAvatar,
  resolveRobloxUsername,
  syncVerifiedMember,
} = require("../platform/robloxAccounts");

function eventFeedChannelId() {
  return process.env.EVENT_FEED_CHANNEL_ID || process.env.EVENT_ANNOUNCEMENT_CHANNEL_ID || null;
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
    return `${icon} **${row.service.replaceAll("_", " ")}** - ${status}`;
  });
  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder().setTitle("🍺 Carry Tavern Status").setDescription(lines.join("\n"));
  if (base) embed.setURL(`${base}/status`);
  return interaction.reply({ embeds: [embed] });
}

async function loadDiscordFeed(interaction, channelId, label) {
  if (!channelId) return { configured: false, messages: [] };

  try {
    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel?.isTextBased?.() || !channel.messages?.fetch) {
      return { configured: true, messages: [], error: `Configured ${label} channel is not a readable text channel.` };
    }

    const fetched = await channel.messages.fetch({ limit: 50 });
    const messages = [...fetched.values()]
      .filter((message) => !message.author?.bot && String(message.content || "").trim())
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)
      .slice(0, 10);

    return { configured: true, channel, messages };
  } catch (error) {
    console.warn(`[${label.toUpperCase()} FEED] Could not read Discord channel:`, error.message);
    return { configured: true, messages: [], error: error.message };
  }
}

function discordMessageLines(messages) {
  return messages.map((message) => {
    const content = String(message.content).trim().slice(0, 850);
    const stamp = Math.floor(message.createdTimestamp / 1000);
    const author = message.member?.displayName || message.author.globalName || message.author.username;
    return `**<t:${stamp}:R> · ${author}**\n${content}\n[Open in Discord](${message.url})`;
  });
}

async function eventsCommand(interaction) {
  await interaction.deferReply();
  const supabase = getSupabase();
  const [{ data, error }, discordFeed] = await Promise.all([
    supabase.from("events")
      .select("id,title,event_type,starts_at,location_text")
      .eq("status", "published")
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(10),
    loadDiscordFeed(interaction, eventFeedChannelId(), "event"),
  ]);

  if (error) throw new Error(error.message);

  const sections = [];

  if (discordFeed.messages.length) {
    sections.push(`**📣 Live Discord Event Feed**\n${discordMessageLines(discordFeed.messages).join("\n\n")}`);
  }

  if (data?.length) {
    const published = data.map((event) => `**${event.title}**\n${event.event_type.replaceAll("_", " ")} · <t:${Math.floor(new Date(event.starts_at).getTime() / 1000)}:F>${event.location_text ? `\n📍 ${event.location_text}` : ""}`);
    sections.push(`**🌐 Scheduled Website Events**\n${published.join("\n\n")}`);
  }

  if (!sections.length) {
    if (!discordFeed.configured) {
      return interaction.editReply("🍺 No scheduled website events are published, and `EVENT_FEED_CHANNEL_ID` is not configured.");
    }
    if (discordFeed.error) {
      return interaction.editReply(`🍺 No scheduled website events are published, and I could not read the Event channel: ${discordFeed.error}`);
    }
    return interaction.editReply("🍺 No scheduled events or recent Event channel posts were found.");
  }

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle("🏆 Tavern Events")
    .setDescription(sections.join("\n\n━━━━━━━━━━━━━━━━━━━━\n\n").slice(0, 4000))
    .setFooter({ text: "Event channel posts and scheduled website events are kept separate but shown together." });
  if (base) embed.setURL(`${base}/events`);
  return interaction.editReply({ embeds: [embed] });
}

async function announcementsCommand(interaction) {
  await interaction.deferReply();
  const feed = await loadDiscordFeed(interaction, process.env.ANNOUNCEMENT_CHANNEL_ID || null, "announcement");

  if (!feed.configured) {
    return interaction.editReply("🍺 `ANNOUNCEMENT_CHANNEL_ID` is not configured yet.");
  }
  if (feed.error) {
    return interaction.editReply(`❌ I could not read the important announcements channel: ${feed.error}`);
  }
  if (!feed.messages.length) {
    return interaction.editReply("🍺 No recent important announcements were found.");
  }

  const base = marketplaceBaseUrl();
  const embed = new EmbedBuilder()
    .setTitle("📢 Tavern Announcements")
    .setDescription(discordMessageLines(feed.messages).join("\n\n").slice(0, 4000))
    .setFooter({ text: "Copied from the configured important announcements channel." });
  if (base) embed.setURL(`${base}/announcements`);
  return interaction.editReply({ embeds: [embed] });
}

async function verifyRobloxCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const supabase = getSupabase();
  const { data: pending, error } = await supabase.from("roblox_link_requests")
    .select("id,roblox_username,roblox_user_id,verification_code,status")
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);

  if (!pending) {
    const { data: alreadyVerified, error: verifiedError } = await supabase.from("profiles")
      .select("roblox_username,roblox_verified_at")
      .eq("id", profile.id)
      .maybeSingle();
    if (verifiedError) throw new Error(verifiedError.message);
    if (alreadyVerified?.roblox_verified_at && alreadyVerified.roblox_username) {
      const nicknameChanged = interaction.member
        ? await syncVerifiedMember(interaction.member, alreadyVerified)
        : false;
      return interaction.editReply([
        `✅ **Roblox is already verified as @${alreadyVerified.roblox_username}.**`,
        nicknameChanged
          ? "✅ Your server nickname and verification roles are synced."
          : "✅ Your verification is saved. If your nickname did not change, make sure the bot has Manage Nicknames and is above your highest role.",
      ].join("\n"));
    }

    const base = marketplaceBaseUrl();
    return interaction.editReply(`❌ You do not have a pending Roblox link request.${base ? `\nCreate one first: ${base}/roblox-link` : ""}`);
  }

  let account;
  if (pending.roblox_user_id) {
    account = { id: pending.roblox_user_id, name: pending.roblox_username };
  } else {
    account = await resolveRobloxUsername(pending.roblox_username);
    if (account?.id) {
      await supabase.from("roblox_link_requests")
        .update({ roblox_user_id: String(account.id), roblox_username: account.name || pending.roblox_username })
        .eq("id", pending.id)
        .eq("status", "pending");
    }
  }
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${pending.roblox_username}**.`);

  const check = await checkRobloxDescriptionVerification(account.id, pending.verification_code);
  const details = check.details;
  if (!check.found) {
    const reason = check.descriptionEmpty
      ? "Roblox returned an empty About/description to the verifier. The profile update may still be propagating or Roblox may be hiding it from the public API."
      : "Roblox still has not exposed that code to the verifier after several checks. The visible profile can update before Roblox's public API does.";

    return interaction.editReply([
      `❌ I still couldn't confirm the code on **@${details?.name || pending.roblox_username}** after ${check.attempts} checks.`,
      "",
      reason,
      "",
      "Make sure this exact code is somewhere in the Roblox profile About/description and saved:",
      `\`${pending.verification_code}\``,
      "",
      "Wait a short moment and run `/tavern verify-roblox` or `/roblox verify` again.",
      marketplaceBaseUrl() ? `🌐 OAuth fallback: ${marketplaceBaseUrl()}/roblox-link` : "",
    ].filter(Boolean).join("\n"));
  }

  const [avatarUrl, membership] = await Promise.all([
    getRobloxAvatar(account.id),
    getCommunityMembership(account.id),
  ]);
  const verifiedAt = new Date().toISOString();
  const username = details?.name || account.name || pending.roblox_username;

  const { error: requestUpdateError } = await supabase.from("roblox_link_requests").update({
    status: "verified",
    roblox_user_id: String(account.id),
    roblox_username: username,
    verified_at: verifiedAt,
  }).eq("id", pending.id).eq("user_id", profile.id).eq("status", "pending");
  if (requestUpdateError) throw new Error(requestUpdateError.message);

  const { error: profileUpdateError } = await supabase.from("profiles").update({
    roblox_username: username,
    roblox_user_id: String(account.id),
    roblox_display_name: details?.displayName || username,
    roblox_avatar_url: avatarUrl,
    roblox_verified_at: verifiedAt,
    roblox_account_created_at: details?.created || null,
    roblox_community_member: membership.communityMember,
    roblox_community_role: membership.communityRole,
  }).eq("id", profile.id);
  if (profileUpdateError) throw new Error(profileUpdateError.message);

  const nicknameChanged = interaction.member
    ? await syncVerifiedMember(interaction.member, { roblox_username: username, roblox_verified_at: verifiedAt })
    : false;

  await supabase.from("notifications").insert({
    user_id: profile.id,
    kind: "roblox_link",
    title: "Roblox account verified",
    body: `${username} was verified through your Roblox profile description.`,
    link: "/hub",
  });
  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "roblox.self_verify",
    target_type: "profile",
    target_id: profile.id,
    new_value: {
      roblox_user_id: String(account.id),
      roblox_username: username,
      community_member: membership.communityMember,
    },
    source: "discord",
  });

  return interaction.editReply([
    `✅ **Roblox verified: @${username}**`,
    check.attempts > 1 ? `✅ Roblox picked up your profile update on check ${check.attempts}.` : "",
    nicknameChanged ? `✅ Your server nickname is now **${username}**.` : "⚠️ Roblox is verified, but I could not change your nickname. Make sure the bot has Manage Nicknames and is above your highest role.",
    membership.communityMember ? `🍺 Carry Tavern Roblox community member${membership.communityRole ? ` • ${membership.communityRole}` : ""}` : "",
  ].filter(Boolean).join("\n"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("tavern")
    .setDescription("Carry Tavern account and platform")
    .addSubcommand((s) => s.setName("profile").setDescription("View your linked Tavern profile"))
    .addSubcommand((s) => s.setName("verify-roblox").setDescription("Verify your pending Roblox link using your profile description code"))
    .addSubcommand((s) => s.setName("status").setDescription("View platform status"))
    .addSubcommand((s) => s.setName("events").setDescription("Read the Event channel and scheduled Tavern events"))
    .addSubcommand((s) => s.setName("announcements").setDescription("Read important Tavern announcements")),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "profile") return await profileCommand(interaction);
      if (sub === "verify-roblox") return await verifyRobloxCommand(interaction);
      if (sub === "status") return await statusCommand(interaction);
      if (sub === "announcements") return await announcementsCommand(interaction);
      return await eventsCommand(interaction);
    } catch (error) {
      console.error("[TAVERN]", error);
      if (interaction.deferred || interaction.replied) return interaction.editReply(`❌ ${error.message || "Tavern request failed."}`);
      return interaction.reply({ content: "❌ Tavern request failed.", flags: MessageFlags.Ephemeral });
    }
  },
};