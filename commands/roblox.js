const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, requireLinkedProfile } = require("../platform/helpers");
const { carrierReputation, tradeReputation } = require("../platform/communitySystems");
const {
  checkRobloxDescriptionVerification,
  getCommunityMembership,
  getRobloxAvatar,
  resolveRobloxUsername,
  syncVerifiedMember,
} = require("../platform/robloxAccounts");

function robloxWebsiteUrl() {
  const base = String(process.env.MARKETPLACE_URL || "").replace(/\/+$/, "");
  return base ? `${base}/roblox-link` : null;
}

function websiteFallbackLine() {
  const url = robloxWebsiteUrl();
  return url
    ? `🌐 **If the above doesn't work, try logging into Roblox via the website:** ${url}`
    : "🌐 **If the above doesn't work, try logging into Roblox via the Carry Tavern website.**";
}

async function linkCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const typed = interaction.options.getString("username", true).trim();
  const account = await resolveRobloxUsername(typed);
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${typed}**.`);

  const supabase = getSupabase();
  const { data: existing, error: existingError } = await supabase
    .from("roblox_link_requests")
    .select("id,verification_code")
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let request;
  if (existing) {
    const { data, error } = await supabase.from("roblox_link_requests")
      .update({
        roblox_username: account.name || typed,
        roblox_user_id: String(account.id),
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,roblox_username,verification_code")
      .single();
    if (error) throw new Error(error.message);
    request = data;
  } else {
    const { data, error } = await supabase.from("roblox_link_requests")
      .insert({
        user_id: profile.id,
        roblox_username: account.name || typed,
        roblox_user_id: String(account.id),
        status: "pending",
      })
      .select("id,roblox_username,verification_code")
      .single();
    if (error) throw new Error(error.message);
    request = data;
  }

  return interaction.editReply([
    `🟥 **Roblox verification started for @${request.roblox_username}.**`,
    "",
    "Put this exact code anywhere in that Roblox account's **About / description**:",
    `\`${request.verification_code}\``,
    "",
    "Save the Roblox profile, then come back here and run `/roblox verify`.",
    "The bot will retry Roblox for about 15 seconds in case the profile update is delayed.",
    "Once verified, your Discord server nickname will automatically become your Roblox username.",
    "",
    websiteFallbackLine(),
  ].join("\n"));
}

async function verifyCommand(interaction) {
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
  if (!pending) return interaction.editReply("❌ You do not have a pending Roblox link. Run `/roblox link` first.");

  // New link requests already store the immutable numeric Roblox ID. Old pending
  // requests are resolved once and then upgraded so future retries use the ID.
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
      ? "Roblox returned an empty About/description to the verifier. This can happen while a profile update is still propagating or if Roblox is hiding the description from its public API."
      : "Roblox still has not exposed that code to the verifier after several checks. Your visible profile can update before Roblox's public API does.";

    return interaction.editReply([
      `❌ I still couldn't confirm the code on **@${details?.name || pending.roblox_username}** after ${check.attempts} checks.`,
      "",
      reason,
      "",
      "Make sure this exact code is somewhere in the Roblox profile About/description and saved:",
      `\`${pending.verification_code}\``,
      "",
      "Wait a short moment and run `/roblox verify` again.",
      websiteFallbackLine(),
    ].join("\n"));
  }

  const [avatarUrl, membership] = await Promise.all([
    getRobloxAvatar(account.id),
    getCommunityMembership(account.id),
  ]);
  const verifiedAt = new Date().toISOString();

  const { error: requestUpdateError } = await supabase.from("roblox_link_requests").update({
    status: "verified",
    roblox_user_id: String(account.id),
    verified_at: verifiedAt,
  }).eq("id", pending.id).eq("status", "pending");
  if (requestUpdateError) throw new Error(requestUpdateError.message);

  const username = details?.name || account.name || pending.roblox_username;
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
    body: `${username} is now linked to your Carry Tavern account.`,
    link: "/hub",
  });
  await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "roblox.discord_verify",
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

async function profileCommand(interaction) {
  await interaction.deferReply();
  const target = interaction.options.getUser("user") || interaction.user;
  const linked = await getLinkedProfile(target.id).catch(() => null);
  if (!linked) return interaction.editReply(`❌ ${target} does not have a linked Carry Tavern profile.`);

  const supabase = getSupabase();
  const [{ data: profile, error }, { data: carrier }] = await Promise.all([
    supabase.from("profiles")
      .select("id,roblox_username,roblox_user_id,roblox_display_name,roblox_avatar_url,roblox_verified_at,roblox_account_created_at,roblox_community_member,roblox_community_role,dq_level,total_carries,total_service_minutes,trust_score,completed_trades,verified_trader")
      .eq("id", linked.id)
      .maybeSingle(),
    supabase.from("carrier_profiles")
      .select("carrier_rank,completed_carries,service_minutes,active")
      .eq("user_id", linked.id)
      .maybeSingle(),
  ]);
  if (error) throw new Error(error.message);
  if (!profile) return interaction.editReply("❌ Tavern profile details could not be loaded.");

  const carryRep = carrierReputation(target.id, interaction.guildId);
  const tradeRep = tradeReputation(interaction.guildId, target.id);
  const created = profile.roblox_account_created_at ? `<t:${Math.floor(new Date(profile.roblox_account_created_at).getTime() / 1000)}:D>` : "Unknown";
  const embed = new EmbedBuilder()
    .setTitle(`🟥 Roblox Profile • ${profile.roblox_display_name || profile.roblox_username || target.username}`)
    .setDescription(profile.roblox_username
      ? `**@${profile.roblox_username}**${profile.roblox_verified_at ? " • ✅ Verified" : " • ⚠️ Not verified"}`
      : "No Roblox username linked.")
    .setThumbnail(profile.roblox_avatar_url || target.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Roblox User ID", value: profile.roblox_user_id || "Unknown", inline: true },
      { name: "Account Created", value: created, inline: true },
      { name: "DQ Level", value: profile.dq_level == null ? "Not set" : String(profile.dq_level), inline: true },
      { name: "Tavern Roblox Group", value: profile.roblox_community_member ? `✅ Member${profile.roblox_community_role ? ` • ${profile.roblox_community_role}` : ""}` : "❌ Not detected", inline: false },
      { name: "Carrier", value: carrier?.active ? `${carrier.carrier_rank} • ${carrier.completed_carries} completed runs` : "Not an active Carrier", inline: true },
      { name: "Carry Rating", value: carryRep.ratings ? `⭐ ${carryRep.average}/5 (${carryRep.ratings})` : "No ratings", inline: true },
      { name: "Trade Rating", value: tradeRep.ratings ? `⭐ ${tradeRep.average}/5 (${tradeRep.ratings})` : "No ratings", inline: true },
      { name: "Trust", value: `${profile.trust_score ?? 100}${profile.verified_trader ? " • Verified Trader" : ""}`, inline: true },
      { name: "Service", value: `${profile.total_carries ?? 0} runs • ${Math.floor(Number(profile.total_service_minutes || 0) / 60)}h ${Number(profile.total_service_minutes || 0) % 60}m`, inline: true },
      { name: "Trades", value: String(profile.completed_trades ?? 0), inline: true },
    )
    .setFooter({ text: "Roblox identity comes from the verified Carry Tavern account link." });
  return interaction.editReply({ embeds: [embed] });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Connect and view Roblox accounts in The Carry Tavern")
    .addSubcommand((sub) => sub
      .setName("link")
      .setDescription("Start Roblox account verification")
      .addStringOption((option) => option
        .setName("username")
        .setDescription("Your Roblox username")
        .setRequired(true)
        .setMinLength(3)
        .setMaxLength(20)))
    .addSubcommand((sub) => sub
      .setName("verify")
      .setDescription("Finish Roblox verification and sync your nickname"))
    .addSubcommand((sub) => sub
      .setName("profile")
      .setDescription("View a member's Roblox + Tavern profile card")
      .addUserOption((option) => option.setName("user").setDescription("Member to view"))),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "link") return await linkCommand(interaction);
      if (sub === "verify") return await verifyCommand(interaction);
      return await profileCommand(interaction);
    } catch (error) {
      console.error("[ROBLOX]", error);
      const message = `❌ ${error.message || "Roblox request failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(message);
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },
};
