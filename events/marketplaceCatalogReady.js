const { getSupabase } = require("../marketplace/supabase");
const {
  repairActiveCatalogueArtwork,
  repairOrphanListings,
} = require("../platform/marketplaceCatalog");

module.exports = {
  name: "clientReady",
  once: true,

  async execute() {
    try {
      const supabase = getSupabase();
      const result = await repairOrphanListings(supabase);
      if (result.repaired) {
        console.log(`[MARKETPLACE] Startup catalogue repair completed: ${result.repaired} listing(s) repaired.`);
      }

      const artwork = await repairActiveCatalogueArtwork(supabase);
      if (artwork.updated) {
        console.log(`[MARKETPLACE] Startup artwork repair completed: ${artwork.updated} item image(s) refreshed.`);
      }
    } catch (error) {
      console.warn("[MARKETPLACE] Startup catalogue repair failed:", error.message);
    }
  },
};
