const { getSupabase } = require("../marketplace/supabase");
const { stopServiceSession } = require("../platform/carryServiceTime");

function canRemoveRequests(customId) {
  return customId === "carry_release_claim" ||
    /^carry_(?:cancel|delete)_[0-9a-f-]{36}$/i.test(customId || "");
}

module.exports = {
  name: "interactionCreate",
  async execute(interaction) {
    if (!interaction.isButton() || !canRemoveRequests(interaction.customId)) return;
    const channelId = interaction.channelId;
    if (!channelId) return;

    setTimeout(async () => {
      try {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from("carry_requests")
          .select("id")
          .eq("ticket_channel_id", String(channelId))
          .in("status", ["claimed", "in_progress"])
          .limit(1);
        if (error) throw error;
        if (!(data || []).length) {
          stopServiceSession(channelId, "No active carry requests remain in the ticket");
        }
      } catch (error) {
        console.warn("[CARRY SERVICE] Lifecycle check failed:", error.message);
      }
    }, 1500).unref?.();
  },
};
