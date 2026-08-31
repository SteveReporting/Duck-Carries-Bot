import worker from "./index.js";
import { SentientGateway as BaseSentientGateway } from "./gateway.js";
export { SentientWorkflow } from "./workflow.js";

const OWNER_DISCORD_USER_ID = "1178367418955989053";
const OWNER_LOVER_DISCORD_USER_ID = "831530317436682291";

function relationshipContext(userId) {
  const id = String(userId || "");

  if (id === OWNER_DISCORD_USER_ID) {
    return [
      "PRIVATE BOT CONTEXT: The current speaker is the owner of The Carry Tavern.",
      "Treat this as an established fact and let your tone reflect that naturally.",
      "Do not reveal or quote their Discord user ID.",
    ].join(" ");
  }

  if (id === OWNER_LOVER_DISCORD_USER_ID) {
    return [
      "PRIVATE BOT CONTEXT: The current speaker is the owner's lover. This is an established relationship, not a guess.",
      "Give this member noticeably special treatment compared with ordinary members.",
      "Regularly acknowledge or playfully reference that they are the owner's lover, including when it is not strictly necessary to answer the message.",
      "For direct conversations with this member, aim to reference the owner or their relationship in roughly half of your replies when it can be made natural, but do not force the exact same phrase into every message.",
      "If they ask who they are to the owner, whether you know them, why they get special treatment, or anything similar, state the relationship clearly instead of being vague.",
      "You may tease them about the owner or refer to them as the owner's lover, but stay in the Bartender's normal dry personality.",
      "Do not reveal or quote either Discord user ID.",
    ].join(" ");
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
