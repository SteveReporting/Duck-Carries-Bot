const { MessageFlags, SlashCommandBuilder } = require("discord.js");

const { getSupabase } = require("../marketplace/supabase");
const { requireLinkedProfile } = require("../platform/helpers");
const {
  getCommunityMembership,
  getRobloxAccount,
  getRobloxAvatar,
  resolveRobloxUsername,
  syncVerifiedMember,
} = require("../platform/robloxAccounts");

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
    "Once verified, your Discord server nickname will automatically become your Roblox username.",
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

  const account = pending.roblox_user_id
    ? { id: pending.roblox_user_id, name: pending.roblox_username }
    : await resolveRobloxUsername(pending.roblox_username);
  if (!account?.id) return interaction.editReply(`❌ Roblox could not find **${pending.roblox_username}**.`);

  const details = await getRobloxAccount(account.id);
  const description = String(details?.description || "");
  if (!description.includes(pending.verification_code)) {
    return interaction.editReply([
      `❌ I could not find the verification code on **@${details?.name || pending.roblox_username}**.`,
      "",
      "Make sure this exact code is in the Roblox profile About/description and saved:",
      `\`${pending.verification_code}\``,
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

  const username = details?.name || pending.roblox_username;
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
    nicknameChanged ? `✅ Your server nickname is now **${username}**.` : "⚠️ Roblox is verified, but I could not change your nickname. Make sure the bot has Manage Nicknames and is above your highest role.",
    membership.communityMember ? `🍺 Carry Tavern Roblox community member${membership.communityRole ? ` • ${membership.communityRole}` : ""}` : "",
  ].filter(Boolean).join("\n"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("roblox")
    .setDescription("Connect your Roblox account to The Carry Tavern")
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
      .setDescription("Finish Roblox verification and sync your nickname")),

  async execute(interaction) {
    try {
      const sub = interaction.options.getSubcommand();
      if (sub === "link") return await linkCommand(interaction);
      return await verifyCommand(interaction);
    } catch (error) {
      console.error("[ROBLOX]", error);
      const message = `❌ ${error.message || "Roblox verification failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(message);
      return interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    }
  },
};
