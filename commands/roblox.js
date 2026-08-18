const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, requireLinkedProfile } = require("../platform/helpers");
const { carrierReputation, tradeReputation } = require("../platform/communitySystems");
const {
  getCommunityMembership,
  getRobloxAvatar,
  resolveRobloxUsername,
  syncVerifiedMember,
  verificationGameUrl,
} = require("../platform/robloxAccounts");

async function linkCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const typed = interaction.options.getString("username", true).trim();
  const account = await resolveRobloxUsername(typed);
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${typed}**.`);

  const gameUrl = verificationGameUrl();
  if (!gameUrl) {
    return interaction.editReply("❌ The Roblox verification game has not been configured yet. Please contact Tavern staff.");
  }

  const supabase = getSupabase();

  const { data: alreadyLinked, error: alreadyLinkedError } = await supabase
    .from("profiles")
    .select("id,discord_id")
    .eq("roblox_user_id", String(account.id))
    .neq("id", profile.id)
    .maybeSingle();
  if (alreadyLinkedError) throw new Error(alreadyLinkedError.message);
  if (alreadyLinked) {
    return interaction.editReply("❌ That Roblox account is already linked to another Carry Tavern account.");
  }

  const { data: otherPending, error: otherPendingError } = await supabase
    .from("roblox_link_requests")
    .select("id,user_id")
    .eq("roblox_user_id", String(account.id))
    .eq("status", "pending")
    .neq("user_id", profile.id)
    .limit(1)
    .maybeSingle();
  if (otherPendingError) throw new Error(otherPendingError.message);
  if (otherPending) {
    return interaction.editReply("❌ That Roblox account already has a pending verification request from another Tavern account.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("roblox_link_requests")
    .select("id")
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
      .select("id,roblox_username,roblox_user_id")
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
      .select("id,roblox_username,roblox_user_id")
      .single();
    if (error) throw new Error(error.message);
    request = data;
  }

  return interaction.editReply([
    `🟥 **Roblox verification started for @${request.roblox_username}.**`,
    "",
    "🎮 **Join the Carry Tavern verification game while logged into that Roblox account:**",
    gameUrl,
    "",
    "That's it. There is **no profile code** to copy or paste.",
    "Once your Roblox account joins the game, the verification server confirms your Roblox User ID and saves the link automatically.",
    "Your Discord verification role and nickname will sync automatically shortly after.",
    "",
    "If you already joined and want to force the Discord-side sync, run `/roblox verify`.",
  ].join("\n"));
}

async function verifyCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const supabase = getSupabase();
  const { data: verifiedProfile, error: verifiedError } = await supabase.from("profiles")
    .select("roblox_username,roblox_verified_at")
    .eq("id", profile.id)
    .maybeSingle();
  if (verifiedError) throw new Error(verifiedError.message);

  if (verifiedProfile?.roblox_verified_at && verifiedProfile.roblox_username) {
    const nicknameChanged = interaction.member
      ? await syncVerifiedMember(interaction.member, verifiedProfile)
      : false;
    return interaction.editReply([
      `✅ **Roblox is verified as @${verifiedProfile.roblox_username}.**`,
      nicknameChanged
        ? "✅ Your server nickname and verification roles are synced."
        : "✅ Your verification is saved. If your nickname did not change, make sure the bot has Manage Nicknames and is above your highest role.",
    ].join("\n"));
  }

  const { data: pending, error: pendingError } = await supabase.from("roblox_link_requests")
    .select("id,roblox_username,roblox_user_id,status")
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw new Error(pendingError.message);

  if (!pending) {
    return interaction.editReply("❌ You do not have a pending Roblox link. Run `/roblox link` first.");
  }

  const gameUrl = verificationGameUrl();
  return interaction.editReply([
    `⏳ **@${pending.roblox_username} is still waiting for game verification.**`,
    "",
    gameUrl ? `🎮 Join the verification game: ${gameUrl}` : "❌ The verification game is not configured. Contact Tavern staff.",
    "",
    "Make sure you join while logged into the exact Roblox account you linked.",
    "The verification is completed automatically when that account joins the game.",
  ].join("\n"));
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
      .setDescription("Check game verification and sync your nickname"))
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
