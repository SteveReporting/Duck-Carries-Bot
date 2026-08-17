const { syncCarrierDirectory, carrierTeamRoleId } = require("../platform/carrierDirectory");

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
    const teamRoleId = carrierTeamRoleId();
    const hadCarrierTeam = oldMember.roles.cache.has(teamRoleId);
    const hasCarrierTeam = newMember.roles.cache.has(teamRoleId);

    const oldRoleIds = [...oldMember.roles.cache.keys()].sort().join(",");
    const newRoleIds = [...newMember.roles.cache.keys()].sort().join(",");
    const rolesChanged = oldRoleIds !== newRoleIds;

    if (hadCarrierTeam !== hasCarrierTeam || (hasCarrierTeam && rolesChanged)) {
      scheduleDirectoryRefresh(client);
    }
  },
};
