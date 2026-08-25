const {
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require("discord.js");

const { installLiveCarrierLeaderboard } = require("../platform/liveCarrierLeaderboard");

function allowed(interaction) {
  if (!interaction.inGuild()) return false;
  if (interaction.guild.ownerId === interaction.user.id) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  return Boolean(
    process.env.AI_MANAGER_ROLE_ID &&
    interaction.member?.roles?.cache?.has(process.env.AI_MANAGER_ROLE_ID)
  );
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName("live-leaderboard")
    .setDescription("Set up the permanent auto-updating Carrier leaderboard")
    .addAttachmentOption((option) =>
      option
        .setName("avatar")
        .setDescription("Tavern logo for the leaderboard webhook profile picture")
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!allowed(interaction)) {
      return interaction.editReply("❌ You do not have permission to configure the live Carrier leaderboard.");
    }

    try {
      const avatar = interaction.options.getAttachment("avatar", true);
      if (!avatar.contentType?.startsWith("image/")) {
        throw new Error("The avatar must be an image attachment.");
      }

      const result = await installLiveCarrierLeaderboard(interaction, avatar);
      return interaction.editReply([
        "✅ **Live Carrier leaderboard configured**",
        `Channel: <#${result.channelId}>`,
        `Message ID: \`${result.messageId}\``,
        result.reused
          ? "♻️ The existing leaderboard webhook message was reused and converted into the live board."
          : "🆕 No reusable leaderboard post was found, so one permanent live message was created.",
        `🔄 It now refreshes every **${result.refreshSeconds} seconds** by editing that same message in place.`,
        "",
        "No other Carrier channel webhooks or Carrier News announcements were touched.",
      ].join("\n"));
    } catch (error) {
      console.error("[LIVE LEADERBOARD SETUP]", error);
      return interaction.editReply(`❌ ${error.message || "Could not configure the live Carrier leaderboard."}`);
    }
  },
};
