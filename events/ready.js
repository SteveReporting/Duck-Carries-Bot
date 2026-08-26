const { startPlatformSync } = require("../platform/sync");
const { startStaffRoleSync } = require("../platform/staff-role-sync");
const { startTreasuryStockPanel } = require("../platform/treasuryStock");
const { startCarrierDirectorySync, carrierTeamRoleId } = require("../platform/carrierDirectory");
const { carryClaimRoleId } = require("../platform/carryClaimAccess");
const { startWebsiteCarryActions } = require("../platform/webCarryActions");
const { startCarryCleanup } = require("../platform/carryCleanup");
const { startLiveCarrierLeaderboard } = require("../platform/liveCarrierLeaderboard");
const { ensureCarrierDepartmentStartup } = require("../platform/carrierDepartmentStartup");
const { startCarrierSeparatorMembership } = require("../platform/carrierSeparatorMembership");

function configuredCarrierRoles() {
  return [
    ["Carrier Team", carrierTeamRoleId()],
    ["Carrier / Barback", process.env.CARRIER_ROLE_BARBACK || process.env.CARRIER_ROLE],
    ["Bartender", process.env.CARRIER_ROLE_BARTENDER],
    ["Caskkeeper", process.env.CARRIER_ROLE_CASKKEEPER],
    ["Tapmaster", process.env.CARRIER_ROLE_TAPMASTER],
    ["Brewmaster", process.env.CARRIER_ROLE_BREWMASTER],
    ["Master of the Tap", process.env.CARRIER_ROLE_MASTER_OF_TAP],
  ].filter(([, id]) => Boolean(id));
}

async function validateRoleConfiguration(client) {
  if (!process.env.GUILD_ID) return;

  const guild = await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
  if (!guild) {
    console.error(`❌ [ROLE CHECK] Could not access configured guild ${process.env.GUILD_ID}.`);
    return;
  }

  const claimRoleId = carryClaimRoleId();
  const claimRole = await guild.roles.fetch(claimRoleId).catch(() => null);
  if (!claimRole) {
    console.error(`❌ [ROLE CHECK] Carry Ticket claim role ${claimRoleId} does not exist in ${guild.name}. Set CARRY_CLAIM_ROLE_ID to the correct Discord role ID.`);
  } else {
    console.log(`✅ [ROLE CHECK] Carry Ticket claims require @${claimRole.name} (${claimRole.id}).`);
  }

  const checked = new Set();
  for (const [label, roleId] of configuredCarrierRoles()) {
    if (checked.has(roleId)) continue;
    checked.add(roleId);

    const role = await guild.roles.fetch(roleId).catch(() => null);
    if (!role) {
      console.error(`❌ [ROLE CHECK] ${label} role ${roleId} does not exist in ${guild.name}.`);
      continue;
    }

    if (!role.editable && label !== "Carrier Team") {
      console.warn(`⚠️ [ROLE CHECK] @${role.name} exists, but the bot cannot manage it. Move the bot role above @${role.name} and make sure Manage Roles is enabled if automatic Carrier rank sync should assign/remove it.`);
    } else {
      console.log(`✅ [ROLE CHECK] @${role.name} is available${label === "Carrier Team" ? " for Carrier roster sync" : " for automatic Carrier role sync"}.`);
    }
  }
}

module.exports = {
  name: "clientReady",
  async execute(client) {
    console.log(`${client.user.tag} is online`);
    client.user.setActivity("The Carry Tavern 🍺");

    const departmentStartup = await ensureCarrierDepartmentStartup(client).catch((error) => ({
      created: [],
      separatorsCreated: [],
      traineesAssigned: 0,
      bartendersScanned: 0,
      warnings: [error.message || "Unknown Carrier Department startup error"],
    }));

    console.log(
      `✅ [CARRIER DEPARTMENT] Startup repair complete: ${departmentStartup.created.length} department role(s) created, ${departmentStartup.separatorsCreated?.length || 0} separator role(s) created, ${departmentStartup.traineesAssigned}/${departmentStartup.bartendersScanned || 0} cached Bartender(s) newly assigned Trainee Carrier.`,
    );
    for (const warning of departmentStartup.warnings || []) {
      console.warn(`[CARRIER DEPARTMENT] ${warning}`);
    }

    startCarrierSeparatorMembership(client);

    await validateRoleConfiguration(client).catch((error) => {
      console.warn("[ROLE CHECK] Validation failed:", error.message);
    });

    startPlatformSync(client);
    startWebsiteCarryActions(client);
    startCarryCleanup();
    startCarrierDirectorySync(client);
    startStaffRoleSync(client);
    startTreasuryStockPanel(client);
    startLiveCarrierLeaderboard(client);
    console.log("✅ Tavern platform heartbeat, website carry controls, completed-carry cleanup, Carrier directory, Discord role sync, announcement sync, Treasury stock panel and live Carrier leaderboard updater started.");
  },
};
