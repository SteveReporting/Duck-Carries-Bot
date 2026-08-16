const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getLinkedProfile, marketplaceBaseUrl } = require("../platform/helpers");
const { joinInstructions, syncVerifiedMember } = require("../platform/robloxAccounts");

function channelMention(id, fallback) {
  return id ? `<#${id}>` : fallback;
}

async function buildStatus(interaction) {
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  const linked = Boolean(profile);
  const verified = Boolean(profile?.roblox_verified_at && profile?.roblox_username);
  const verifiedRole = process.env.VERIFIED_ROLE_ID;
  const hasVerifiedRole = verifiedRole ? interaction.member?.roles?.cache?.has(verifiedRole) : verified;
  const nicknameOkay = verified && interaction.member?.nickname === profile.roblox_username;
  return { profile, linked, verified, hasVerifiedRole, nicknameOkay };
}

async function guideCommand(interaction) {
  const state = await buildStatus(interaction);
  const base = marketplaceBaseUrl();
  const rules = channelMention(process.env.RULES_CHANNEL_ID, "the server rules");
  const verification = channelMention(process.env.VERIFICATION_CHANNEL_ID, "the verification channel");
  const embed = new EmbedBuilder()
    .setTitle("🍺 Welcome to The Carry Tavern")
    .setDescription("Complete the steps below to unlock the Tavern and use the carry systems.")
    .addFields(
      { name: `${state.linked ? "✅" : "1️⃣"} Connect Discord`, value: state.linked ? "Your Tavern profile is connected." : (base ? `Sign in with Discord: ${base}/auth` : "Connect your Discord account to your Tavern profile.") },
      { name: `${state.verified ? "✅" : "2️⃣"} Verify Roblox`, value: state.verified ? `Verified as **@${state.profile.roblox_username}**.` : `Go to ${verification} and run \`/roblox link\`, add the verification code to your Roblox About, then run \`/roblox verify\`.` },
      { name: `${state.hasVerifiedRole ? "✅" : "3️⃣"} Server Access`, value: state.hasVerifiedRole ? "Your verified access is active." : "The bot unlocks your verified role after Roblox verification." },
      { name: "4️⃣ Read the Rules", value: `Read ${rules} before using carries, trading or the Treasury.` },
      { name: "5️⃣ Start Using the Tavern", value: "Use `/help` for Carries, Carrier tools, Roblox, Marketplace, Trading, Treasury and Staff commands." },
    )
    .setFooter({ text: "Your Discord nickname is automatically synced to your verified Roblox username." });
  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function refreshCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const state = await buildStatus(interaction);
  if (!state.verified) return interaction.editReply(joinInstructions());
  const nickname = await syncVerifiedMember(interaction.member, state.profile);
  return interaction.editReply([
    "✅ Onboarding access refreshed.",
    `Roblox: **@${state.profile.roblox_username}**`,
    nickname ? `Nickname synced to **${state.profile.roblox_username}**.` : "Roblox is verified. If your nickname did not update, the bot may need Manage Nicknames or a higher role position.",
  ].join("\n"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("onboarding")
    .setDescription("Carry Tavern member onboarding")
    .addSubcommand((s) => s.setName("guide").setDescription("Show your onboarding checklist"))
    .addSubcommand((s) => s.setName("refresh").setDescription("Refresh verified role and Roblox nickname")),
  async execute(interaction) {
    try {
      return interaction.options.getSubcommand() === "refresh" ? refreshCommand(interaction) : guideCommand(interaction);
    } catch (error) {
      console.error("[ONBOARDING]", error);
      const text = `❌ ${error.message || "Onboarding check failed."}`;
      if (interaction.deferred || interaction.replied) return interaction.editReply(text);
      return interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    }
  },
};
