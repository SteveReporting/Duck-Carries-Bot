const { syncCarrierDirectory, carrierTeamRoleId } = require("../platform/carrierDirectory");
const { ensureMemberSeparatorRoles } = require("../platform/carrierSeparatorMembership");

let refreshTimer = null;

function scheduleDirectoryRefresh(client) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    syncCarrierDirectory(client).catch((error) => {
      console.error("[CARRIER DIRECTORY] Role-change sync failed:", error);
    });
  }, 750);
  refreshTimer.unref?.();
}

module.exports = {
  name: "guildMemberUpdate",
  async execute(oldMember, newMember, client) {
    const oldRoleIds = [...oldMember.roles.cache.keys()].sort().join(",");
    const newRoleIds = [...newMember.roles.cache.keys()].sort().join(",");
    const rolesChanged = oldRoleIds !== newRoleIds;
    if (!rolesChanged) return;

    if (!newMember.user.bot) {
      const separatorResult = await ensureMemberSeparatorRoles(
        newMember,
        "Automatic Carrier separator sync after role change",
      ).catch((error) => ({ warnings: [error.message] }));

      for (const warning of separatorResult.warnings || []) {
        console.warn(`[CARRIER SEPARATORS] ${warning}`);
      }
    }

    const teamRoleId = carrierTeamRoleId();
    const hadCarrierTeam = oldMember.roles.cache.has(teamRoleId);
    const hasCarrierTeam = newMember.roles.cache.has(teamRoleId);

    if (hadCarrierTeam !== hasCarrierTeam || hasCarrierTeam) {
      scheduleDirectoryRefresh(client);
    }
  },
};
