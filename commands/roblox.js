const { randomBytes } = require("node:crypto");
const {
  ActionRowBuilder,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { getLinkedProfile, requireLinkedProfile } = require("../platform/helpers");
const { carrierReputation, tradeReputation } = require("../platform/communitySystems");
const {
  checkRobloxDescriptionVerification,
  getCommunityMembership,
  getRobloxAvatar,
  resolveRobloxUsername,
  syncVerifiedMember,
  verificationGameUrl,
} = require("../platform/robloxAccounts");

function createVerificationCode() {
  return `CTV-${randomBytes(5).toString("hex").toUpperCase()}`;
}

function verificationMethodSelector(requestId) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`roblox_verify_method:${requestId}`)
      .setPlaceholder("Choose your verification method")
      .setMinValues(1)
      .setMaxValues(1)
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Verification Game")
          .setDescription("Join the Roblox game and verify automatically")
          .setEmoji("🎮")
          .setValue("game"),
        new StringSelectMenuOptionBuilder()
          .setLabel("Roblox Bio / About")
          .setDescription("Use a unique code in your Roblox About")
          .setEmoji("📝")
          .setValue("bio"),
      ),
  );
}

async function ensureVerificationCode(supabase, pending) {
  if (pending?.verification_code) return pending.verification_code;

  const verificationCode = createVerificationCode();
  const { error } = await supabase
    .from("roblox_link_requests")
    .update({ verification_code: verificationCode })
    .eq("id", pending.id)
    .eq("status", "pending");
  if (error) throw new Error(error.message);
  return verificationCode;
}

async function completeDescriptionVerification({
  interaction,
  profile,
  pending,
  account,
  details,
}) {
  const supabase = getSupabase();

  const { data: alreadyLinked, error: alreadyLinkedError } = await supabase
    .from("profiles")
    .select("id")
    .eq("roblox_user_id", String(account.id))
    .neq("id", profile.id)
    .maybeSingle();
  if (alreadyLinkedError) throw new Error(alreadyLinkedError.message);
  if (alreadyLinked) {
    return interaction.editReply("❌ That Roblox account is already linked to another Carry Tavern account.");
  }

  const [avatarUrl, membership] = await Promise.all([
    getRobloxAvatar(account.id),
    getCommunityMembership(account.id),
  ]);

  const verifiedAt = new Date().toISOString();
  const username = details?.name || account.name || pending.roblox_username;
  const displayName = details?.displayName || username;

  const { error: profileUpdateError } = await supabase
    .from("profiles")
    .update({
      roblox_username: username,
      roblox_user_id: String(account.id),
      roblox_display_name: displayName,
      roblox_avatar_url: avatarUrl,
      roblox_verified_at: verifiedAt,
      roblox_account_created_at: details?.created || null,
      roblox_community_member: membership.communityMember,
      roblox_community_role: membership.communityRole,
    })
    .eq("id", profile.id);
  if (profileUpdateError) throw new Error(profileUpdateError.message);

  const { error: requestUpdateError } = await supabase
    .from("roblox_link_requests")
    .update({
      status: "verified",
      roblox_user_id: String(account.id),
      roblox_username: username,
      verified_at: verifiedAt,
    })
    .eq("id", pending.id)
    .eq("user_id", profile.id)
    .eq("status", "pending");
  if (requestUpdateError) throw new Error(requestUpdateError.message);

  const nicknameChanged = interaction.member
    ? await syncVerifiedMember(interaction.member, {
      roblox_username: username,
      roblox_verified_at: verifiedAt,
    })
    : false;

  const { error: notificationError } = await supabase.from("notifications").insert({
    user_id: profile.id,
    kind: "roblox_link",
    title: "Roblox account verified",
    body: `${username} was verified through your Roblox profile description.`,
    link: "/hub",
  });
  if (notificationError) {
    console.warn("[ROBLOX] Verification notification failed:", notificationError.message);
  }

  const { error: auditError } = await supabase.from("audit_log").insert({
    actor_id: profile.id,
    action: "roblox.discord_bio_verify",
    target_type: "profile",
    target_id: profile.id,
    new_value: {
      roblox_user_id: String(account.id),
      roblox_username: username,
      community_member: membership.communityMember,
    },
    source: "discord",
  });
  if (auditError) {
    console.warn("[ROBLOX] Verification audit log failed:", auditError.message);
  }

  return interaction.editReply([
    `✅ **Roblox verified: @${username}**`,
    "✅ The verification code was found in the Roblox About/description.",
    nicknameChanged
      ? `✅ Your server nickname is now **${username}**.`
      : "⚠️ Roblox is verified, but I could not change your nickname. Make sure the bot has Manage Nicknames and is above your highest role.",
    membership.communityMember
      ? `🍺 Carry Tavern Roblox community member${membership.communityRole ? ` • ${membership.communityRole}` : ""}`
      : "",
  ].filter(Boolean).join("\n"));
}

async function linkCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, { alreadyDeferred: true });
  if (!profile) return;

  const typed = interaction.options.getString("username", true).trim();
  const account = await resolveRobloxUsername(typed);
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${typed}**.`);

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

  const canonicalUsername = account.name || typed;
  const { data: otherUsernamePending, error: otherUsernamePendingError } = await supabase
    .from("roblox_link_requests")
    .select("id,user_id,roblox_user_id")
    .ilike("roblox_username", canonicalUsername)
    .eq("status", "pending")
    .neq("user_id", profile.id)
    .limit(1)
    .maybeSingle();
  if (otherUsernamePendingError) throw new Error(otherUsernamePendingError.message);
  if (otherUsernamePending) {
    return interaction.editReply("❌ That Roblox username already has a pending verification request from another Tavern account.");
  }

  const { data: existing, error: existingError } = await supabase
    .from("roblox_link_requests")
    .select("id,verification_code")
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  let request;
  if (existing) {
    const verificationCode = existing.verification_code || createVerificationCode();
    const { data, error } = await supabase.from("roblox_link_requests")
      .update({
        roblox_username: canonicalUsername,
        roblox_user_id: String(account.id),
        verification_code: verificationCode,
        created_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("id,roblox_username,roblox_user_id,verification_code")
      .single();
    if (error) throw new Error(error.message);
    request = data;
  } else {
    const { data, error } = await supabase.from("roblox_link_requests")
      .insert({
        user_id: profile.id,
        roblox_username: canonicalUsername,
        roblox_user_id: String(account.id),
        verification_code: createVerificationCode(),
        status: "pending",
      })
      .select("id,roblox_username,roblox_user_id,verification_code")
      .single();
    if (error) throw new Error(error.message);
    request = data;
  }

  return interaction.editReply({
    content: [
      `🟥 **Roblox verification started for @${request.roblox_username}.**`,
      "",
      "Select the verification method you want to use from the box below:",
      "",
      "🎮 **Verification Game** — once selected, joining the game on this Roblox account verifies you automatically.",
      "📝 **Roblox Bio / About** — once selected, the bot gives you the code to place in your About.",
    ].join("\n"),
    components: [verificationMethodSelector(request.id)],
  });
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
    .select("id,roblox_username,roblox_user_id,verification_code,status")
    .eq("user_id", profile.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (pendingError) throw new Error(pendingError.message);

  if (!pending) {
    return interaction.editReply("❌ You do not have a pending Roblox link. Run `/roblox link` first.");
  }

  pending.verification_code = await ensureVerificationCode(supabase, pending);

  let account;
  if (pending.roblox_user_id) {
    account = { id: pending.roblox_user_id, name: pending.roblox_username };
  } else {
    account = await resolveRobloxUsername(pending.roblox_username);
    if (account?.id) {
      const { error } = await supabase.from("roblox_link_requests")
        .update({
          roblox_user_id: String(account.id),
          roblox_username: account.name || pending.roblox_username,
        })
        .eq("id", pending.id)
        .eq("status", "pending");
      if (error) throw new Error(error.message);
    }
  }

  if (!account?.id) {
    return interaction.editReply(`❌ Roblox could not find **${pending.roblox_username}**.`);
  }

  const check = await checkRobloxDescriptionVerification(
    account.id,
    pending.verification_code,
  );

  if (check.found) {
    return completeDescriptionVerification({
      interaction,
      profile,
      pending,
      account,
      details: check.details,
    });
  }

  const { data: gameVerified, error: gameVerifiedError } = await supabase
    .from("profiles")
    .select("roblox_username,roblox_verified_at")
    .eq("id", profile.id)
    .maybeSingle();
  if (gameVerifiedError) throw new Error(gameVerifiedError.message);

  if (gameVerified?.roblox_verified_at && gameVerified.roblox_username) {
    const nicknameChanged = interaction.member
      ? await syncVerifiedMember(interaction.member, gameVerified)
      : false;
    return interaction.editReply([
      `✅ **Roblox is verified as @${gameVerified.roblox_username}.**`,
      "✅ The verification game completed while I was checking your bio.",
      nicknameChanged
        ? "✅ Your server nickname and verification roles are synced."
        : "✅ Your verification is saved. If your nickname did not change, make sure the bot has Manage Nicknames and is above your highest role.",
    ].join("\n"));
  }

  const gameUrl = verificationGameUrl();
  const details = check.details;
  const reason = check.descriptionEmpty
    ? "Roblox returned an empty About/description. The update may still be propagating."
    : "Roblox has not exposed the code through its public profile API yet.";

  return interaction.editReply([
    `⏳ **@${details?.name || pending.roblox_username} is not verified yet.**`,
    "",
    `I checked the Roblox bio ${check.attempts} time${check.attempts === 1 ? "" : "s"}. ${reason}`,
    "",
    "Keep this exact code in the Roblox About/description:",
    `\`${pending.verification_code}\``,
    "",
    "Then run `/roblox verify` again.",
    gameUrl ? `🎮 Or verify instantly by joining the game: ${gameUrl}` : "",
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
      .setDescription("Verify by game or Roblox bio and sync your nickname"))
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
