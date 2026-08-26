// The Google Apps Script Carrier review bridge authenticates GET requests with
// query-string parameters. Keep the token in POST JSON too, but also mirror it
// into the POST URL so saveReview/notes/decision actions authenticate the same
// way as list/get. This wrapper is intentionally limited to the configured
// Carrier application bridge URL.
if (!global.__carrierReviewFetchPatched && typeof global.fetch === "function") {
  global.__carrierReviewFetchPatched = true;
  const originalFetch = global.fetch.bind(global);

  global.fetch = async (input, init = {}) => {
    try {
      const bridgeUrl = String(process.env.CARRIER_APPLICATION_API_URL || "").trim();
      const bridgeToken = String(process.env.CARRIER_APPLICATION_API_TOKEN || "").trim();
      const method = String(init?.method || "GET").toUpperCase();
      const rawUrl = typeof input === "string" || input instanceof URL
        ? String(input)
        : String(input?.url || "");

      if (bridgeUrl && bridgeToken && method === "POST" && rawUrl === bridgeUrl) {
        const target = new URL(rawUrl);
        if (!target.searchParams.has("token")) target.searchParams.set("token", bridgeToken);
        if (!target.searchParams.has("action") && init?.body) {
          try {
            const parsed = JSON.parse(String(init.body));
            if (parsed?.action) target.searchParams.set("action", String(parsed.action));
          } catch {}
        }
        input = target.toString();
      }
    } catch (error) {
      console.warn(`[CARRIER APPLICATION REVIEW] Could not normalize bridge POST auth: ${error.message}`);
    }

    return originalFetch(input, init);
  };
}

const carrierAppReview = require("../commands/carrier-app-review");

module.exports = {
  name: "interactionCreate",

  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    if (interaction.customId !== "carrier_review_open") return;

    try {
      return await carrierAppReview.execute(interaction);
    } catch (error) {
      console.error("[CARRIER APPLICATION REVIEW]", error);
      const message = `❌ Could not open Carrier application review: ${error.message || "Unknown error"}`.slice(0, 1900);
      if (interaction.deferred || interaction.replied) {
        return interaction.editReply(message).catch(() => {});
      }
      if (interaction.isRepliable?.()) {
        return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
      }
    }
  },
};
