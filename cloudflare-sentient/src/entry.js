export { SentientWorkflow } from "./workflow.js";
export { SentientGateway } from "./gateway.js";

import sentientApp from "./index.js";
import { maybeSendErr02Ambient } from "./err02Ambient.js";

export default {
  fetch(request, env, ctx) {
    return sentientApp.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    if (typeof sentientApp.scheduled === "function") {
      await sentientApp.scheduled(controller, env, ctx);
    }

    // Keep the optional ERR_02 ambient behavior, but never target or ping a
    // specific member from the scheduler.
    ctx.waitUntil(
      maybeSendErr02Ambient(env)
        .then((result) => {
          if (result?.sent) {
            console.log(`[SENTIENT] ERR_02 ambient message sent: ${result.messageId || "unknown"}`);
          }
        })
        .catch((error) => {
          console.error("[SENTIENT] ERR_02 ambient message failed:", error);
        })
    );
  },
};
