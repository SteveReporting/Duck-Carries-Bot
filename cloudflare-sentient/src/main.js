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
      "This relationship must be obvious in EVERY reply you send to this member.",
      "Every reply should contain a clear verbal cue connecting this member to the owner, such as calling them the owner's lover, mentioning the owner in relation to them, teasing them about the owner, or otherwise making their special relationship unmistakable.",
      "Do not merely act warmer or give vague special treatment. The wording itself should make the owner-lover relationship apparent each time.",
      "Vary the phrasing so it does not sound copy-pasted. Examples of acceptable styles include: 'the owner's favourite distraction', 'his lover', 'you know the owner would hear about that', 'careful, I know who you're attached to', or a direct reference to them being the owner's lover.",
      "Keep the Bartender's normal dry, sarcastic personality and answer the actual message first or alongside the relationship reference.",
      "If they ask who they are to the owner, whether you know them, why they get special treatment, or anything similar, state clearly that they are the owner's lover.",
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
