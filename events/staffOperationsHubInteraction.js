const {
  handleStaffOperationsHubInteraction,
} = require("../platform/staffOperationsHub");
const { getGuildConfig } = require("../platform/guildConfig");

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    const previousModeratorRole = process.env.PLATFORM_DISCORD_ROLE_MODERATOR;
    const config = interaction.guildId ? getGuildConfig(interaction.guildId) : null;

    if (config?.staff_role_id) {
      process.env.PLATFORM_DISCORD_ROLE_MODERATOR = String(config.staff_role_id);
    }

    try {
      await handleStaffOperationsHubInteraction(interaction);
    } catch (error) {
      console.error("[STAFF HUB] Interaction failed:", error);
      const message = `❌ ${error.message || "Could not refresh the Staff Operations Hub."}`;
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(message).catch(() => {});
      } else if (interaction.isRepliable?.()) {
        await interaction.reply({ content: message, flags: 64 }).catch(() => {});
      }
    } finally {
      if (previousModeratorRole == null) delete process.env.PLATFORM_DISCORD_ROLE_MODERATOR;
      else process.env.PLATFORM_DISCORD_ROLE_MODERATOR = previousModeratorRole;
    }
  },
};
