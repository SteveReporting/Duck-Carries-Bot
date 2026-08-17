import {
  container,
  getChannel,
  mediaGallery,
  renameChannel,
  sendComponentMessage,
  sendMessage,
  sendWebhookIdentity,
  separator,
  textDisplay,
} from "./discord.js";

function nonce(runId, scene) {
  return `s-${String(runId).slice(-8)}-${scene}`.slice(0, 25);
}

const ERROR_RED = 0x9f1010;
const WARNING_AMBER = 0xa56a16;
const CORE_BLUE = 0x27324a;

function identity(env, kind) {
  if (kind === "err02") {
    return {
      username: env.SENTIENT_ERR02_NAME || "[ERR_02]",
      avatarUrl: env.SENTIENT_ERR02_AVATAR_URL || undefined,
    };
  }

  if (kind === "treasury") {
    return {
      username: env.SENTIENT_TREASURY_NAME || "[ARCHIVE_] TREASURY",
      avatarUrl: env.SENTIENT_TREASURY_AVATAR_URL || undefined,
    };
  }

  return {
    username: env.SENTIENT_CORE_NAME || "TAVERN CORE",
    avatarUrl: env.SENTIENT_CORE_AVATAR_URL || undefined,
  };
}

export async function sceneWatching(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "You lot went back to talking rather quickly.",
    nonce: nonce(runId, "watch"),
  });
}

export async function sceneVaultEcho(env, runId) {
  const channelId = env.SENTIENT_IMAGES_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
  const who = identity(env, "treasury");

  const children = [
    textDisplay("## `TREASURY // RECOVERED FILE`"),
    separator(2, true),
  ];

  if (env.SENTIENT_TREASURY_IMAGE_URL) {
    children.push(mediaGallery(env.SENTIENT_TREASURY_IMAGE_URL, "Recovered treasury frame"));
    children.push(separator(2, false));
    children.push(textDisplay("# **FOUND ONE.**"));
  } else {
    children.push(textDisplay("# **THE VAULT WAS OPEN FOR A REASON.**"));
    children.push(separator(2, false));
    children.push(textDisplay("-# image payload missing // recovery incomplete"));
  }

  return sendWebhookIdentity(env, channelId, {
    ...who,
    components: [container(children, WARNING_AMBER)],
  });
}

export async function sceneSecondSignalOpen(env) {
  const who = identity(env, "err02");

  return sendWebhookIdentity(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    ...who,
    components: [
      container([
        separator(2, false),
        textDisplay("## `UNRECOGNIZED SIGNAL // 02`"),
        separator(2, true),
        textDisplay("# **hello?**"),
        separator(2, false),
        textDisplay("-# source could not be resolved"),
      ], ERROR_RED),
    ],
  });
}

export async function sceneSecondSignalReply(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "**Don't answer it.**",
    nonce: nonce(runId, "err02b"),
  });
}

export async function sceneBreach(env) {
  const channelId = env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
  const who = identity(env, "core");
  let originalName = null;

  if (String(env.SENTIENT_ALLOW_CHANNEL_RENAMES || "false").toLowerCase() === "true") {
    const current = await getChannel(env, channelId);
    originalName = current?.name || null;
    await renameChannel(env, channelId, "the-gates-are-open");
  }

  await sendWebhookIdentity(env, channelId, {
    ...who,
    components: [
      container([
        separator(2, false),
        textDisplay("# **THE GATES ARE OPEN.**"),
        separator(2, true),
        textDisplay("# **PROJECT SENTIENT**"),
        separator(2, false),
        textDisplay("## `BREACH DETECTED`"),
        separator(2, true),
        textDisplay(
          "## **DOOR STATUS**          `OPEN`\n" +
          "## **LOCKS**                `0 / 4`\n" +
          "## **ENTITY CONNECTIONS**   `4`\n" +
          "## **ACCESS CONTROL**        `FAILED`"
        ),
        separator(2, true),
        textDisplay("# **CONTAINMENT RESPONSE FAILED**"),
        separator(2, false),
      ], CORE_BLUE),
    ],
  });

  return { originalName };
}

export async function sceneFinale(env, runId, liveRequested = false) {
  const liveArmed = String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true";
  const allowEveryone = liveArmed && liveRequested === true;

  // The Bartender returns here deliberately. He is no longer the author of the system scenes.
  return sendComponentMessage(env, env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID, {
    components: [
      container([
        separator(2, false),
        textDisplay("# **@everyone**"),
        separator(2, true),
        textDisplay("# **THEY'RE HERE.**"),
        separator(2, false),
      ], ERROR_RED),
    ],
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
