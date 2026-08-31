import {
  container,
  sendComponentMessage,
  sendComponentMessageAsBotToken,
  sendWebhookIdentity,
  separator,
  textDisplay,
} from "./discord.js";

function nonce(runId, scene) {
  return `s-${String(runId).slice(-8)}-${scene}`.slice(0, 25);
}

const ERROR_RED = 0x9f1010;
const BARTENDER_RED = 0x6d1f2f;
const CORE_BLUE = 0x27324a;

function channel(env, kind) {
  switch (kind) {
    case "chat":
      return env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "signal02":
      return env.SENTIENT_SIGNAL_02_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "core":
      return env.SENTIENT_CORE_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
    case "finale":
      return env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
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

  return {
    username: env.SENTIENT_CORE_NAME || "TAVERN CORE",
    avatarUrl: env.SENTIENT_CORE_AVATAR_URL || undefined,
  };
}

function gatewayStub(env) {
  if (!env.SENTIENT_GATEWAY) return null;
  const id = env.SENTIENT_GATEWAY.idFromName("bartender-live");
  return env.SENTIENT_GATEWAY.get(id);
}

async function muteBartender(env, durationMs = 10000) {
  const stub = gatewayStub(env);
  if (!stub) return;
  await stub.fetch("https://sentient-gateway/mute", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ durationMs }),
  }).catch((error) => console.error("[SENTIENT] Could not mute live Bartender:", error));
}

async function unmuteBartender(env) {
  const stub = gatewayStub(env);
  if (!stub) return;
  await stub.fetch("https://sentient-gateway/unmute", { method: "POST" })
    .catch((error) => console.error("[SENTIENT] Could not unmute live Bartender:", error));
}

function signalComponents(content) {
  return [
    container([
      separator(2, false),
      textDisplay("## `UNRECOGNIZED SIGNAL // 02`"),
      separator(2, true),
      textDisplay(`# **${content}**`),
      separator(2, false),
      textDisplay("-# source: ERR_02 // connection unstable"),
    ], ERROR_RED),
  ];
}

function bartenderComponents(label, content) {
  return [
    container([
      separator(2, false),
      textDisplay(`## \`${label}\``),
      separator(2, true),
      textDisplay(`# **${content}**`),
      separator(2, false),
      textDisplay("-# [ERR_] Th3_B4rt3nd3r // live channel"),
    ], BARTENDER_RED),
  ];
}

async function speakAsErr02(env, target, content, runId, beat) {
  const components = signalComponents(content);

  if (env.SENTIENT_ERR02_TOKEN) {
    return sendComponentMessageAsBotToken(env.SENTIENT_ERR02_TOKEN, target, {
      components,
      nonce: nonce(runId, beat),
    });
  }

  const who = identity(env, "err02");
  return sendWebhookIdentity(env, target, {
    ...who,
    components,
  });
}

async function speakAsBartender(env, target, label, content, runId, beat) {
  return sendComponentMessage(env, target, {
    components: bartenderComponents(label, content),
    allowEveryone: false,
    nonce: nonce(runId, beat),
  });
}

export async function sceneWatching(env, runId) {
  return speakAsBartender(
    env,
    channel(env, "chat"),
    "BARTENDER // OBSERVATION",
    "You lot went back to talking rather quickly.",
    runId,
    "watch"
  );
}

export async function sceneSecondSignalOpen(env, runId = crypto.randomUUID()) {
  const target = channel(env, "signal02");
  await muteBartender(env, 10000);
  return speakAsErr02(env, target, "hello anyone there?", runId, "err02a");
}

export async function sceneSecondSignalReply(env, runId) {
  try {
    return await speakAsBartender(
      env,
      channel(env, "signal02"),
      "BARTENDER // WARNING",
      "Don't respond to it.",
      runId,
      "err02b"
    );
  } finally {
    await unmuteBartender(env);
  }
}

export async function sceneBreach(env, runId) {
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
          "## **ENTITY CONNECTIONS**   `2`\n" +
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
      throw new Error(`Unknown or retired scene: ${scene}`);
  }
}
