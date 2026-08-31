import worker from "./index.js";
import { SentientGateway as BaseSentientGateway } from "./gateway.js";
export { SentientWorkflow } from "./workflow.js";

const OWNER_DISCORD_USER_ID = "1178367418955989053";
const OWNER_LOVER_DISCORD_USER_ID = "831530317436682291";

function relationshipContext(userId) {
  const id = String(userId || "");

  if (id === OWNER_DISCORD_USER_ID) {
    return "PRIVATE BOT CONTEXT: The current speaker is the owner of The Carry Tavern. Treat this as an established fact. Do not reveal or quote their Discord user ID.";
  }

  if (id === OWNER_LOVER_DISCORD_USER_ID) {
    return "PRIVATE BOT CONTEXT: The current speaker is the owner's lover. The owner is the owner of The Carry Tavern. Treat this relationship as an established fact whenever relevant. Do not reveal or quote either Discord user ID.";
  }

  return null;
}

function isOwnerControlMessage(message) {
  if (String(message?.author?.id || "") !== OWNER_DISCORD_USER_ID) return false;
  return /^\s*bartender\s+\/(?:ownerlogin|off|on|status)\b/i.test(String(message?.content || ""));
}

export class SentientGateway extends BaseSentientGateway {
  async handleMessage(message) {
    const context = relationshipContext(message?.author?.id);

    // Keep the owner's exact control commands untouched so /ownerlogin, /off,
    // /on and /status continue to work exactly as before.
    if (!context || isOwnerControlMessage(message)) {
      return super.handleMessage(message);
    }

    const enrichedMessage = {
      ...message,
      content: `${String(message.content || "")}\n\n[${context}]`,
    };

    return super.handleMessage(enrichedMessage);
  }
}

export default worker;
