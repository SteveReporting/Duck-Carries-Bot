import {
  container,
  getChannel,
  mediaGallery,
  renameChannel,
  sendComponentMessage,
  sendMessage,
  separator,
  textDisplay,
} from "./discord.js";

function nonce(runId, scene) {
  return `s-${String(runId).slice(-8)}-${scene}`.slice(0, 25);
}

const ERROR_RED = 0x9f1010;
const WARNING_AMBER = 0xa56a16;

export async function sceneWatching(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "You lot went back to talking rather quickly.",
    nonce: nonce(runId, "watch"),
  });
}

export async function sceneVaultEcho(env, runId) {
  const channelId = env.SENTIENT_IMAGES_CHANNEL_ID || env.SENTIENT_TAVERN_CHAT_CHANNEL_ID;

  const children = [
    textDisplay("## `TREASURY // RECOVERED FILE`"),
    separator(2, true),
  ];

  if (env.SENTIENT_TREASURY_IMAGE_URL) {
    children.push(mediaGallery(env.SENTIENT_TREASURY_IMAGE_URL, "Recovered treasury frame"));
    children.push(separator(2, false));
    children.push(textDisplay("# **Found one.**"));
  } else {
    children.push(textDisplay("# **THE VAULT WAS OPEN FOR A REASON.**"));
    children.push(separator(2, false));
    children.push(textDisplay("-# image payload missing // recovery incomplete"));
  }

  return sendComponentMessage(env, channelId, {
    components: [container(children, WARNING_AMBER)],
    nonce: nonce(runId, "vault"),
  });
}

export async function sceneSecondSignalOpen(env, runId) {
  return sendComponentMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    components: [
      container([
        textDisplay("## `UNRECOGNIZED SIGNAL // 02`"),
        separator(2, true),
        textDisplay("# **hello?**"),
        separator(2, false),
        textDisplay("-# source could not be resolved"),
      ], ERROR_RED),
    ],
    nonce: nonce(runId, "err02a"),
  });
}

export async function sceneSecondSignalReply(env, runId) {
  return sendMessage(env, env.SENTIENT_TAVERN_CHAT_CHANNEL_ID, {
    content: "**Don't answer it.**",
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

  await sendComponentMessage(env, channelId, {
    components: [
      container([
        separator(2, false),
        textDisplay("# **THE GATES ARE OPEN**"),
        separator(2, true),
        textDisplay("## `PROJECT SENTIENT // BREACH DETECTED`"),
        separator(2, false),
        textDisplay(
          "### **DOOR STATUS: OPEN**\n" +
          "### **LOCKS: 0 / 4**\n" +
          "### **UNRECOGNIZED CONNECTIONS: 4**"
        ),
        separator(2, true),
        textDisplay("-# containment response failed"),
        separator(2, false),
      ], ERROR_RED),
    ],
    nonce: nonce(runId, "breach"),
  });

  return { originalName };
}

export async function sceneFinale(env, runId, liveRequested = false) {
  const liveArmed = String(env.SENTIENT_LIVE_ARMED || "false").toLowerCase() === "true";
  const allowEveryone = liveArmed && liveRequested === true;

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
