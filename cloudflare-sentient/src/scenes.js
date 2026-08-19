import {
  container,
  mediaGallery,
  sendComponentMessage,
  sendMessage,
  sendMessageAsBotToken,
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

function channel(env, kind) {
  switch (kind) {
    case "chat":
      return env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "treasury":
      return env.SENTIENT_TREASURY_CHANNEL_ID || env.SENTIENT_IMAGES_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "signal02":
      return env.SENTIENT_SIGNAL_02_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "core":
      return env.SENTIENT_CORE_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "gate":
      return env.SENTIENT_GATE_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "events":
      return env.SENTIENT_EVENTS_CHANNEL_ID || env.SENTIENT_CARRY_EVENTS_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "finale":
      return env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID;
    case "debug":
      return env.SENTIENT_DEBUG_CHANNEL_ID;
    default:
      return env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
  }
}

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
  return sendMessage(env, channel(env, "chat"), {
    content: "You lot went back to talking rather quickly.",
    nonce: nonce(runId, "watch"),
  });
}

export async function sceneVaultEcho(env) {
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

  return sendWebhookIdentity(env, channel(env, "treasury"), {
    ...who,
    components: [container(children, WARNING_AMBER)],
  });
}

export async function sceneSecondSignalOpen(env, runId = crypto.randomUUID()) {
  const target = channel(env, "signal02");

  // If a dedicated ERR_02 bot token exists, use the real bot account.
  // Otherwise keep the old webhook identity as a fallback.
  if (env.SENTIENT_ERR02_TOKEN) {
    return sendMessageAsBotToken(env.SENTIENT_ERR02_TOKEN, target, {
      content: "hello?",
      nonce: nonce(runId, "err02a"),
    });
  }

  const who = identity(env, "err02");
  return sendWebhookIdentity(env, target, {
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
  return sendMessage(env, channel(env, "chat"), {
    content: "**Don't respond to it.**",
    nonce: nonce(runId, "err02b"),
  });
}

export async function sceneBreach(env) {
  const who = identity(env, "core");

  await sendWebhookIdentity(env, channel(env, "core"), {
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

  return { originalName: null, channelEditing: false };
}

export async function sceneFinale(env, runId, liveRequested = false) {
  const liveArmed = String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true";
  const allowEveryone = liveArmed && liveRequested === true;

  return sendComponentMessage(env, channel(env, "finale"), {
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

export async function restoreBreach() {
  return { restored: false, channelEditing: false };
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
