export const ERR02_OWNER_LOGIN_COMMAND = "err02 /ownerlogin Toothless";
export const ERR02_OWNER_OFF_COMMAND = "err02 /off";
export const ERR02_OWNER_ON_COMMAND = "err02 /on";
export const ERR02_OWNER_STATUS_COMMAND = "err02 /status";
export const ERR02_ENABLED_STORAGE_KEY = "err02Enabled";

export function normalizeErr02Command(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function isErr02ControlCommand(value) {
  const command = normalizeErr02Command(value);
  return command === ERR02_OWNER_LOGIN_COMMAND ||
    command === ERR02_OWNER_OFF_COMMAND ||
    command === ERR02_OWNER_ON_COMMAND ||
    command === ERR02_OWNER_STATUS_COMMAND ||
    /^err02\s+\/ownerlogin\b/i.test(command) ||
    /^err02\s+\/(?:off|on|status)\b/i.test(command);
}
