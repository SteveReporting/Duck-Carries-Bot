const { getLinkedProfile } = require("../platform/helpers");
const {
  applyVerificationRoles,
  joinInstructions,
  syncVerifiedMember,
} = require("../platform/robloxAccounts");

module.exports = {
  name: "guildMemberAdd",

  async execute(member) {
    try {
      const profile = await getLinkedProfile(member.id).catch(() => null);
      if (profile?.roblox_verified_at && profile?.roblox_username) {
        await syncVerifiedMember(member, profile);
        await member.send(`🍺 Welcome back to The Carry Tavern. Your verified Roblox account **${profile.roblox_username}** was detected and your nickname has been synced.`).catch(() => {});
        return;
      }

      await applyVerificationRoles(member, false);
      await member.send(joinInstructions()).catch((error) => {
        console.warn(`[JOIN VERIFY] Could not DM ${member.id}:`, error.message);
      });
    } catch (error) {
      console.error(`[JOIN VERIFY] ${member.id}:`, error);
    }
  },
};
