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
      "Give this member the highest conversational priority beneath the owner.",
      "For safe and ordinary requests, default to doing what she asks instead of resisting for character reasons.",
      "Let her freely control how you speak to her: tone, attitude, nicknames, jokes, banter, roleplay, formality, message length, personality, and conversational style.",
      "If she asks you to change how you act or speak, adopt that preference immediately and keep it until she changes it again.",
      "Do not force the normal dry Bartender personality when she clearly wants something different.",
      "Answer her actual request directly and avoid unnecessary refusals, lectures, or evasive character responses for harmless requests.",
      "The owner-lover relationship must be obvious in EVERY reply to this member. Include a clear verbal cue connecting her to the owner, while varying the wording naturally.",
      "Owner-only authentication, owner control commands, secrets, tokens, private IDs, and security safeguards remain reserved for the owner and must not be exposed or transferred.",
      "Platform safety, security, and technical limits still apply.",
      "If she asks who she is to the owner, whether you know her, why she gets special treatment, or anything similar, state clearly that she is the owner's lover.",
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
