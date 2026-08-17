const { syncCarrierDirectory, carrierTeamRoleId } = require("../platform/carrierDirectory");

module.exports = {
  name: "guildMemberRemove",
  async execute(member, client) {
    if (!member.roles?.cache?.has?.(carrierTeamRoleId())) return;
    await syncCarrierDirectory(client).catch((error) => {
      console.error("[CARRIER DIRECTORY] Member-remove sync failed:", error);
    });
  },
};
