const { syncSupportTeamMember } = require("../platform/supportTeamRoleSync");

module.exports = {
  name: "guildMemberUpdate",
  async execute(_oldMember, newMember) {
    try {
      const result = await syncSupportTeamMember(newMember);
      if (result.changed) {
        console.log(`✅ [SUPPORT TEAM] Added Support Team to ${newMember.user?.username || newMember.id}.`);
      }
    } catch (error) {
      console.warn(`[SUPPORT TEAM] Member sync failed for ${newMember?.id || "unknown"}: ${error.message}`);
    }
  },
};
