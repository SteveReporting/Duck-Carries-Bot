import { getChannel, renameChannel, sendMessage } from "./discord.js";

function nonce(runId, scene) {
  return `s-${String(runId).slice(-8)}-${scene}`.slice(0, 25);
}

export async function sceneWatching(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "You lot went back to talking rather quickly.",
    nonce: nonce(runId, "watch"),
  });
}

export async function sceneVaultEcho(env, runId) {
  const channelId = env.SENTIENT_IMAGES_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
  const embeds = env.SENTIENT_TREASURY_IMAGE_URL
    ? [{ image: { url: env.SENTIENT_TREASURY_IMAGE_URL }, footer: { text: "FILE RECOVERED // TREASURY" } }]
    : undefined;

  return sendMessage(env, channelId, {
    content: env.SENTIENT_TREASURY_IMAGE_URL ? "Found one." : "The vault was open for a reason.",
    embeds,
    nonce: nonce(runId, "vault"),
  });
}

export async function sceneSecondSignalOpen(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "`[ERR_02 // SIGNAL RECEIVED]`\nhello?",
    nonce: nonce(runId, "err02a"),
  });
}

export async function sceneSecondSignalReply(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "Don't answer it.",
    nonce: nonce(runId, "err02b"),
  });
}

export async function sceneBreach(env, runId) {
  const channelId = env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
  let originalName = null;

  if (String(env.SENTIENT_ALLOW_CHANNEL_RENAMES || "false").toLowerCase() === "true") {
    const current = await getChannel(env, channelId);
    originalName = current?.name || null;
    await renameChannel(env, channelId, "the-gates-are-open");
  }

  await sendMessage(env, channelId, {
    content: "# THE GATES ARE OPEN.\n`PROJECT SENTIENT // BREACH DETECTED`",
    nonce: nonce(runId, "breach"),
  });

  return { originalName };
}

export async function sceneFinale(env, runId, liveRequested = false) {
  const liveArmed = String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true";
  const allowEveryone = liveArmed && liveRequested === true;

  return sendMessage(env, env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID, {
    content: "@everyone they're here.",
    allowEveryone,
    nonce: nonce(runId, "finale"),
  });
}

export async function restoreBreach(env, originalName) {
  if (!originalName) return { restored: false };
  await renameChannel(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, originalName);
  return { restored: true, name: originalName };
}

export async function runManualScene(env, scene, runId = crypto.randomUUID()) {
  switch (scene) {
    case "watching":
      await sceneWatching(env, runId);
      return { scene };
    case "vault_echo":
      await sceneVaultEcho(env, runId);
      return { scene };
    case "second_signal":
      await sceneSecondSignalOpen(env, runId);
      await scheduler.wait(6500);
      await sceneSecondSignalReply(env, runId);
      return { scene };
    case "breach":
      return { scene, ...(await sceneBreach(env, runId)) };
    case "finale":
      await sceneFinale(env, runId, false);
      return { scene, pingedEveryone: false };
    default:
      throw new Error(`Unknown scene: ${scene}`);
  }
}
