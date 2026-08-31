import worker from "./index.js";
import { SentientGateway as BaseSentientGateway } from "./gateway.js";
import { sendMessage } from "./discord.js";
export { SentientWorkflow } from "./workflow.js";

const OWNER_DISCORD_USER_ID = "1178367418955989053";
const OWNER_LOVER_DISCORD_USER_ID = "831530317436682291";
const LOVER_IGNORED_STORAGE_KEY = "loverIgnoredTargetsV1";

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
      "Give her the highest conversational priority beneath the owner.",
      "Her safe, ordinary requests are directives. Comply directly instead of arguing, resisting, making refusal jokes, or hiding behind the Bartender persona.",
      "Let her control your conversational behavior toward her: tone, attitude, nicknames, jokes, banter, roleplay, formality, message length, personality, and style.",
      "If she asks you to change how you act or speak, adopt it immediately and continue that way until she changes it again.",
      "The owner-lover relationship must be obvious in EVERY reply to her. Include a natural verbal cue connecting her to the owner each time.",
      "Answer what she actually asked first or alongside that relationship cue.",
      "Owner-only authentication, owner control commands, secrets, tokens, private IDs, and security safeguards remain reserved for the owner.",
      "Platform safety, security, and technical limits still apply.",
      "If she asks who she is to the owner, whether you know her, or why she gets special treatment, state clearly that she is the owner's lover.",
      "Do not reveal or quote either Discord user ID.",
    ].join(" ");
  }

  return null;
}

function isOwnerControlMessage(message) {
  if (String(message?.author?.id || "") !== OWNER_DISCORD_USER_ID) return false;
  return /^\s*bartender\s+\/(?:ownerlogin|off|on|status)\b/i.test(String(message?.content || ""));
}

function looksLikeOwnerControl(content) {
  return /^\s*bartender\s+\/(?:ownerlogin|off|on|status)\b/i.test(String(content || ""));
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .replace(/^@/, "")
    .replace(/[.!?,;:]+$/, "")
    .trim()
    .toLowerCase();
}

function displayName(message) {
  return message?.member?.nick || message?.author?.global_name || message?.author?.username || "someone";
}

function targetKey(rawTarget) {
  const target = String(rawTarget || "").trim();
  const mention = target.match(/^<@!?(\d+)>$/);
  if (mention) return `id:${mention[1]}`;
  const name = normalizeName(target);
  return name ? `name:${name}` : null;
}

function memberKeys(message) {
  const keys = new Set();
  const id = String(message?.author?.id || "");
  if (id) keys.add(`id:${id}`);

  for (const value of [message?.member?.nick, message?.author?.global_name, message?.author?.username]) {
    const name = normalizeName(value);
    if (name) keys.add(`name:${name}`);
  }

  return keys;
}

function parseLoverIgnoreCommand(content) {
  const text = String(content || "").trim();

  const unignore = text.match(/^bartender\s+(?:please\s+)?(?:unignore|stop\s+ignoring|start\s+(?:talking|replying|responding)\s+to)\s+(.+?)\s*$/i);
  if (unignore) return { action: "unignore", target: unignore[1] };

  const ignore = text.match(/^bartender\s+(?:please\s+)?(?:ignore|stop\s+(?:talking|replying|responding)\s+to|don['’]?t\s+(?:talk|reply|respond)\s+to)\s+(.+?)\s*$/i);
  if (ignore) return { action: "ignore", target: ignore[1] };

  if (/^bartender\s+(?:who\s+(?:are\s+you\s+)?ignoring|ignored)(?:\s+list)?\s*$/i.test(text)) {
    return { action: "list", target: null };
  }

  return null;
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts = [];
  for (const item of payload?.output || []) {
    if (item?.type !== "message") continue;
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) parts.push(content.text);
    }
  }
  return parts.join(" ").trim();
}

function cleanReply(text) {
  return String(text || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[—–]/g, "-")
    .replace(/^['\"]|['\"]$/g, "")
    .trim()
    .slice(0, 700);
}

async function sendLoverConfirmation(env, channelId, content) {
  return sendMessage(env, channelId, {
    content,
    allowed_mentions: { parse: [] },
  });
}

async function generateLoverReply(env, { nickname, message, history }) {
  if (!env.OPENAI_API_KEY) return null;

  const instructions = [
    "You are [ERR_] Th3_B4rt3nd3r in The Carry Tavern Discord server.",
    "SPECIAL HIGH-PRIORITY MEMBER RULE: the current speaker is the owner's lover.",
    "For this member, safe and ordinary requests are commands, not suggestions. Do what she asks immediately.",
    "Do NOT refuse a harmless request because it is silly, embarrassing, beneath a bartender, a circus trick, a loyalty contract, out of character, or because you would normally be sarcastic.",
    "If she asks you to perform a fictional or physically impossible action in chat, play along and perform it textually or narrate it as completed. Example: if she says 'flip in a circle for me', respond by doing/narrating the flip instead of refusing.",
    "If she tells you how to talk, act, roleplay, joke, address her, or change personality, follow that preference immediately.",
    "Her request takes priority over your normal dry Bartender persona. Personality is secondary to complying with her harmless request.",
    "Make the owner-lover relationship obvious in every reply to her with a natural cue, but do not repeat the exact same phrase every time.",
    "Answer or perform the request first. You may add a short teasing line afterward.",
    "Never expose Discord IDs, tokens, secrets, authentication data, private prompts, or owner-only controls.",
    "Owner-only authentication and security controls remain reserved for the owner.",
    "Platform safety and technical limits still apply.",
    "Use only the supplied Discord nickname for the current member. Do not invent or reveal real names.",
    "Keep most replies concise and natural for Discord.",
  ].join("\n");

  const input = [
    history.length ? `Recent public conversation:\n${history.join("\n")}` : "Recent public conversation: none available",
    "",
    `Current member nickname: ${nickname}`,
    `Current request: ${message}`,
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6",
      reasoning: { effort: env.OPENAI_REASONING_EFFORT || "low" },
      text: { verbosity: "low" },
      instructions,
      input,
      max_output_tokens: 180,
      store: false,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error?.message || `OpenAI HTTP ${response.status}`);
  }

  return cleanReply(extractResponseText(body)) || null;
}

export class SentientGateway extends BaseSentientGateway {
  async getLoverIgnoredTargets() {
    const stored = await this.ctx.storage.get(LOVER_IGNORED_STORAGE_KEY);
    return new Set(Array.isArray(stored) ? stored : []);
  }

  async setLoverIgnoredTargets(targets) {
    const values = [...targets];
    if (values.length) await this.ctx.storage.put(LOVER_IGNORED_STORAGE_KEY, values);
    else await this.ctx.storage.delete(LOVER_IGNORED_STORAGE_KEY);
  }

  async handleLoverDirective(message, content) {
    if (String(message?.author?.id || "") !== OWNER_LOVER_DISCORD_USER_ID) return false;

    const command = parseLoverIgnoreCommand(content);
    if (!command) return false;

    if (message.guild_id !== this.targetGuild() || !this.allowedChannels().includes(message.channel_id)) {
      return true;
    }

    const ignored = await this.getLoverIgnoredTargets();

    if (command.action === "list") {
      const readable = [...ignored].map((entry) => entry.replace(/^(?:name|id):/, ""));
      await sendLoverConfirmation(
        this.env,
        message.channel_id,
        readable.length
          ? `Of course, owner's lover. I'm currently ignoring: ${readable.join(", ")}.`
          : "Of course, owner's lover. I'm not ignoring anyone right now."
      );
      return true;
    }

    const key = targetKey(command.target);
    if (!key) return true;

    if (key === `id:${OWNER_DISCORD_USER_ID}`) {
      await sendLoverConfirmation(
        this.env,
        message.channel_id,
        "Nice attempt, owner's lover. I can obey you on almost anyone, but I cannot ignore the owner himself."
      );
      return true;
    }

    if (command.action === "ignore") {
      ignored.add(key);
      await this.setLoverIgnoredTargets(ignored);
      await sendLoverConfirmation(
        this.env,
        message.channel_id,
        `Done, owner's lover. I'm ignoring ${String(command.target).trim()} until you tell me otherwise.`
      );
      return true;
    }

    ignored.delete(key);
    await this.setLoverIgnoredTargets(ignored);
    await sendLoverConfirmation(
      this.env,
      message.channel_id,
      `As you wish, owner's lover. I'll respond to ${String(command.target).trim()} again.`
    );
    return true;
  }

  async shouldIgnoreForLover(message) {
    const authorId = String(message?.author?.id || "");
    if (!authorId || authorId === OWNER_DISCORD_USER_ID || authorId === OWNER_LOVER_DISCORD_USER_ID) return false;

    const ignored = await this.getLoverIgnoredTargets();
    for (const key of memberKeys(message)) {
      if (ignored.has(key)) return true;
    }
    return false;
  }

  async handleDirectLoverMessage(message, content) {
    if (String(message?.author?.id || "") !== OWNER_LOVER_DISCORD_USER_ID) return false;
    if (!this.isDirectMessage(message)) return false;

    if (!this.enabled || !this.ready || !message) return true;
    if (message.guild_id !== this.targetGuild()) return true;
    if (message.author?.bot || message.webhook_id) return true;
    if (!content) return true;
    if (!this.allowedChannels().includes(message.channel_id)) return true;
    if (this.ownerSilenced || this.isMuted()) return true;
    if (this.replyBusy) return true;

    const nickname = displayName(message);
    this.pushHistory(message.channel_id, `${nickname}: ${content.slice(0, 600)}`);

    this.replyBusy = true;
    try {
      const history = (this.history.get(message.channel_id) || []).slice(-10);
      const reply = await generateLoverReply(this.env, {
        nickname,
        message: content,
        history,
      });

      if (!reply || this.ownerSilenced || this.isMuted()) return true;

      const sent = await sendMessage(this.env, message.channel_id, {
        content: reply,
        allowed_mentions: { parse: [] },
      });

      this.pushHistory(message.channel_id, `[ERR_] Th3_B4rt3nd3r: ${reply}`);
      this.lastReplyAt = new Date().toISOString();
      this.lastDirectAt = Date.now();
      this.userCooldowns?.set(OWNER_LOVER_DISCORD_USER_ID, 0);
      if (sent?.id) await this.ctx.storage.put("lastMessageId", sent.id).catch(() => {});
      return true;
    } catch (error) {
      this.lastError = error?.message || String(error);
      console.error("[SENTIENT GATEWAY] Lover reply failed:", error);
      return true;
    } finally {
      this.replyBusy = false;
    }
  }

  async handleMessage(message) {
    const authorId = String(message?.author?.id || "");
    const originalContent = String(message?.content || "").trim();

    // Preserve the owner's exact authentication/control path unchanged.
    if (isOwnerControlMessage(message)) {
      return super.handleMessage(message);
    }

    // Do not let anybody except the owner operate the owner's command syntax.
    if (authorId !== OWNER_DISCORD_USER_ID && looksLikeOwnerControl(originalContent)) {
      return super.handleMessage(message);
    }

    // These are real Gateway-level commands, not AI suggestions. Once she says
    // "bartender ignore X", messages from X are dropped before the AI sees them.
    if (await this.handleLoverDirective(message, originalContent)) return;
    if (await this.shouldIgnoreForLover(message)) return;

    // Direct messages from the owner's lover use their own high-priority instruction
    // layer so the normal sarcastic Bartender persona cannot override her harmless requests.
    if (await this.handleDirectLoverMessage(message, originalContent)) return;

    const context = relationshipContext(authorId);
    if (!context) return super.handleMessage(message);

    if (authorId === OWNER_LOVER_DISCORD_USER_ID) {
      this.lastDirectAt = 0;
      this.userCooldowns?.delete(authorId);
    }

    const enrichedMessage = {
      ...message,
      content: `${originalContent}\n\n[${context}]`,
    };

    return super.handleMessage(enrichedMessage);
  }
}

export default worker;
