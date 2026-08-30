const { syncAllSupportTeam } = require("../platform/supportTeamRoleSync");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    const timer = setTimeout(async () => {
      try {
        const guildId = process.env.GUILD_ID;
        if (!guildId) throw new Error("GUILD_ID is not configured.");

        const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId);
        const result = await syncAllSupportTeam(guild);

        if (!result.supportRole) {
          console.warn("[SUPPORT TEAM] Role named 'Support Team' was not found. No staff roles were changed.");
          return;
        }

        console.log(
          `✅ [SUPPORT TEAM] ${result.supportRole.name}: ${result.assigned} assigned, ${result.already} already had it, ${result.failed} failed (${result.staff} staff detected).`,
        );
      } catch (error) {
        console.warn(`[SUPPORT TEAM] Startup sync failed: ${error.message}`);
      }
    }, 6_000);

    timer.unref?.();
  },
};
