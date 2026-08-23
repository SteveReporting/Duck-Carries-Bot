const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require("discord.js");
const { getLinkedProfile, marketplaceBaseUrl, requireLinkedProfile } = require("../platform/helpers");

function channelMention(id, fallback) {
  return id ? `<#${id}>` : fallback;
}

async function guideCommand(interaction) {
  const profile = await getLinkedProfile(interaction.user.id).catch(() => null);
  const base = marketplaceBaseUrl();
  const rules = channelMention(process.env.RULES_CHANNEL_ID, "the server rules");

  const embed = new EmbedBuilder()
    .setTitle("🍺 Welcome to The Carry Tavern")
    .setDescription("Use the steps below to get started. Roblox identity for carry requests is handled through Bloxlink.")
    .addFields(
      {
        name: `${profile ? "✅" : "1️⃣"} Connect Discord`,
        value: profile
          ? "Your Tavern profile is connected."
          : (base ? `Sign in with Discord: ${base}/auth` : "Connect your Discord account to your Tavern profile."),
      },
      {
        name: "2️⃣ Link Roblox with Bloxlink",
        value: "Make sure your Roblox account is linked to your Discord account through Bloxlink. The Tavern does not use a separate Roblox verification system anymore.",
      },
      { name: "3️⃣ Read the Rules", value: `Read ${rules} before using carries, trading or the Treasury.` },
      { name: "4️⃣ Start Using the Tavern", value: "Use `/help` for Carries, Carrier tools, Roblox, Marketplace, Trading, Treasury and Staff commands." },
    )
    .setFooter({ text: "When you request a carry, the bot resolves your Roblox username through Bloxlink automatically." });

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function refreshCommand(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const profile = await requireLinkedProfile(interaction, {
    alreadyDeferred: true,
    requireRoblox: true,
  });
  if (!profile) return;

  return interaction.editReply([
    "✅ Tavern identity refreshed from Bloxlink.",
    `Roblox: **@${profile.roblox_username}**`,
    "No separate Carry Tavern Roblox verification is required.",
  ].join("\n"));
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("onboarding")
    .setDescription("Carry Tavern member onboarding")
    .addSubcommand((s) => s.setName("guide").setDescription("Show your onboarding guide"))
    .addSubcommand((s) => s.setName("refresh").setDescription("Refresh your Roblox identity from Bloxlink")),
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
