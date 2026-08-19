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
const IDENTITY_PURPLE = 0x5b2a86;

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
      return env.SENTIENT_ANNOUNCEMENTS_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;
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

async function speakAsErr02(env, target, content, runId, beat) {
  if (env.SENTIENT_ERR02_TOKEN) {
    return sendMessageAsBotToken(env.SENTIENT_ERR02_TOKEN, target, {
      content,
      nonce: nonce(runId, beat),
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
        textDisplay(`# **${content}**`),
        separator(2, false),
        textDisplay("-# source could not be resolved"),
      ], ERROR_RED),
    ],
  });
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
  await muteBartender(env, 10000);
  return speakAsErr02(env, target, "hello anyone there?", runId, "err02a");
}

export async function sceneSecondSignalReply(env, runId) {
  try {
    return await sendMessage(env, channel(env, "signal02"), {
      content: "**Don't respond to it.**",
      nonce: nonce(runId, "err02b"),
    });
  } finally {
    await unmuteBartender(env);
  }
}

// 60-second test-only beats. These dramatize the current name panic without
// exposing email addresses, private fields, or any additional real-world data.
export async function sceneTestNamesNoticed(env, runId) {
  return sendMessage(env, channel(env, "chat"), {
    content: "**You noticed the names.**",
    nonce: nonce(runId, "tnames"),
  });
}

export async function sceneTestErr02Probe(env, runId) {
  const target = channel(env, "signal02");
  await muteBartender(env, 12000);
  return speakAsErr02(env, target, "how does it know your names?", runId, "t02probe");
}

export async function sceneTestBartenderWarning(env, runId) {
  return sendMessage(env, channel(env, "signal02"), {
    content: "**Don't ask it to prove anything.**",
    nonce: nonce(runId, "twarn"),
  });
}

export async function sceneTestErr02Escalation(env, runId) {
  return speakAsErr02(
    env,
    channel(env, "signal02"),
    "it remembers more every time you answer.",
    runId,
    "t02esc"
  );
}

export async function sceneTestIdentityIndex(env, runId) {
  const who = identity(env, "core");
  return sendWebhookIdentity(env, channel(env, "core"), {
    ...who,
    components: [
      container([
        separator(2, false),
        textDisplay("# **IDENTITY INDEX // UNSEALED**"),
        separator(2, true),
        textDisplay("## `MEMBER CORRELATION ACTIVE`"),
        separator(2, true),
        textDisplay(
          "## **DISPLAY NAMES**       `INDEXED`\n" +
          "## **KNOWN FIRST NAMES**   `CORRELATED`\n" +
          "## **PRIVATE FIELDS**      `SEALED`\n" +
          "## **EMAIL CONTENT**       `NOT EXPOSED`"
        ),
        separator(2, true),
        textDisplay("# **THE TAVERN REMEMBERS WHAT YOU CALL YOURSELVES.**"),
        separator(2, false),
      ], IDENTITY_PURPLE),
    ],
  });
}

export async function sceneTestBartenderAnswer(env, runId) {
  try {
    return await sendMessage(env, channel(env, "signal02"), {
      content: "You keep calling it a leak. **I call it remembering.**",
      nonce: nonce(runId, "tanswer"),
    });
  } finally {
    await unmuteBartender(env);
  }
}

export async function sceneTestFinale(env, runId) {
  return sendComponentMessage(env, channel(env, "finale"), {
    components: [
      container([
        separator(2, false),
        textDisplay("## `60 SECOND CONTAINMENT TEST // FAILED`"),
        separator(2, true),
        textDisplay("# **YOU WERE NEVER INVISIBLE TO THE TAVERN.**"),
        separator(2, false),
        textDisplay("-# test mode // no @everyone ping // private fields remain sealed"),
      ], ERROR_RED),
    ],
    allowEveryone: false,
    nonce: nonce(runId, "tfinal"),
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
