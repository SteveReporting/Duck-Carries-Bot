const { startSecurity } = require("../security/runtime");

const WINDOW_MS = 60 * 60 * 1000;
const MAX_MENTIONS_PER_HOUR = 4;
const mentionWindows = new Map();
let patched = false;

function pruneWindow(userId, now) {
  const active = (mentionWindows.get(userId) || []).filter((ts) => now - ts < WINDOW_MS);
  if (active.length) mentionWindows.set(userId, active);
  else mentionWindows.delete(userId);
  return active;
}

module.exports = {
  name: "clientReady",
  once: true,
  async execute(client) {
    if (patched) return;

    const timer = setTimeout(async () => {
      try {
        const runtime = await startSecurity(client);
        const { engine } = runtime;
        if (engine.__everyoneHerePolicyPatched) return;

        engine.__everyoneHerePolicyPatched = true;
        patched = true;

        const originalOnMessage = engine.onMessage.bind(engine);
        engine.onMessage = async (message, edited = false) => {
          const isEveryoneHere = Boolean(message?.mentions?.everyone);

          if (
            !edited
            && isEveryoneHere
            && message?.guild?.id === engine.config.discord.guildId
            && !message.author?.bot
          ) {
            // Preserve existing trust/immunity behaviour for owners, trusted staff,
            // Chicken, approved bots, etc. This rate limit is for ordinary users.
            const trusted = await engine.isTrustedActor(message.author.id, message.guild).catch(() => false);
            if (trusted) return;

            const now = Date.now();
            const active = pruneWindow(message.author.id, now);
            active.push(now);
            mentionWindows.set(message.author.id, active);

            // @everyone/@here no longer contributes to spam score and these
            // messages are never deleted by the security engine. The first four
            // in a rolling hour are simply allowed.
            if (active.length <= MAX_MENTIONS_PER_HOUR) {
              console.log(
                `[security] Allowed @everyone/@here ${active.length}/${MAX_MENTIONS_PER_HOUR} this hour from ${message.author.id}; message preserved.`,
              );
              return;
            }

            // On the fifth attempt, keep the message but stop further spam by
            // timing the member out until the oldest ping leaves the one-hour window.
            const remainingMs = Math.max(60_000, WINDOW_MS - (now - active[0]));
            await message.member?.timeout(
              remainingMs,
              `@everyone/@here rate limit: max ${MAX_MENTIONS_PER_HOUR} per hour`,
            ).catch(() => {});

            await engine.incident(
              "everyone-here-rate-limit",
              "medium",
              {
                actorId: message.author.id,
                channelId: message.channelId,
                details: `Exceeded ${MAX_MENTIONS_PER_HOUR} @everyone/@here mentions in a rolling hour. Message was preserved; member timed out for the remaining window.`,
              },
              "spam-detection",
            ).catch(() => {});

            console.log(
              `[security] @everyone/@here limit exceeded by ${message.author.id}; message preserved, timeout applied.`,
            );
            return;
          }

          // Edited @everyone/@here messages are also preserved and are not fed
          // into the old mention-scoring/deletion path.
          if (edited && isEveryoneHere) return;

          return originalOnMessage(message, edited);
        };

        console.log("✅ [SECURITY] @everyone/@here policy active: 4/hour, no message deletion.");
      } catch (error) {
        console.warn(`[SECURITY] Could not apply @everyone/@here policy: ${error.message}`);
      }
    }, 2_000);

    timer.unref?.();
  },
};
