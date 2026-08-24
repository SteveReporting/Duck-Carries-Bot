const { getSupabase } = require("../marketplace/supabase");
const { repairOrphanListings } = require("../platform/marketplaceCatalog");

module.exports = {
  name: "clientReady",
  once: true,

  async execute() {
    try {
      const result = await repairOrphanListings(getSupabase());
      if (result.repaired) {
        console.log(`[MARKETPLACE] Startup catalogue repair completed: ${result.repaired} listing(s) repaired.`);
      }
    } catch (error) {
      console.warn("[MARKETPLACE] Startup catalogue repair failed:", error.message);
    }
  },
};
