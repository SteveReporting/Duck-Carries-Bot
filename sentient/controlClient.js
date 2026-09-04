"use strict";

const DEFAULT_CONTROL_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_TIMEOUT_MS = 12_000;

function envBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(raw).trim());
}

function trimTrailingSlash(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

class SentientUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "SentientUnavailableError";
  }
}

class SentientControlClient {
  constructor(options = {}) {
    this.baseUrl = trimTrailingSlash(
      options.baseUrl || process.env.SENTIENT_CONTROL_BASE_URL || DEFAULT_CONTROL_BASE_URL,
    );
    this.secret = String(options.secret || process.env.SENTIENT_ADMIN_SECRET || "").trim();
    this.enabled = options.enabled ?? envBoolean("SENTIENT_INTEGRATION_ENABLED", true);
    this.timeoutMs = Math.max(
      1_000,
      Number(options.timeoutMs || process.env.SENTIENT_CONTROL_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    );
    this.lastError = null;
    this.lastSuccessAt = null;
  }

  isConfigured() {
    return Boolean(this.enabled && this.baseUrl && this.secret);
  }

  configurationState() {
    if (!this.enabled) return { configured: false, reason: "integration disabled" };
    if (!this.baseUrl) return { configured: false, reason: "SENTIENT_CONTROL_BASE_URL is missing" };
    if (!this.secret) return { configured: false, reason: "SENTIENT_ADMIN_SECRET is missing" };
    return { configured: true, reason: null };
  }

  async request(path, options = {}) {
    const {
      method = "POST",
      body,
      auth = true,
      timeoutMs = this.timeoutMs,
      headers = {},
    } = options;

    if (!this.enabled) throw new SentientUnavailableError("SENTIENT integration is disabled.");
    if (!this.baseUrl) throw new SentientUnavailableError("SENTIENT_CONTROL_BASE_URL is not configured.");
    if (auth && !this.secret) throw new SentientUnavailableError("SENTIENT_ADMIN_SECRET is not configured.");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, Number(timeoutMs || this.timeoutMs)));
    timer.unref?.();

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(auth ? { "x-sentient-secret": this.secret } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      const text = await response.text();
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { text };
        }
      }

      if (!response.ok) {
        const message = payload?.error || payload?.message || `SENTIENT HTTP ${response.status}`;
        const error = new Error(String(message));
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      this.lastSuccessAt = new Date().toISOString();
      this.lastError = null;
      return payload;
    } catch (error) {
      const wrapped = error?.name === "AbortError"
        ? new Error(`SENTIENT request timed out after ${timeoutMs}ms.`)
        : error;
      this.lastError = {
        at: new Date().toISOString(),
        message: wrapped?.message || String(wrapped),
      };
      throw wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  call(endpoint, payload = {}) {
    return this.request(`/api/${endpoint}`, { method: "POST", body: payload });
  }

  health() {
    return this.request("/api/health", { method: "GET", auth: false, timeoutMs: 5_000 });
  }

  scopedPayload(action, guildId, payload = {}) {
    return { action, ...(guildId ? { guildId: String(guildId) } : {}), ...payload };
  }

  intelligence(action, guildId, payload = {}) {
    return this.call("intelligence", this.scopedPayload(action, guildId, payload));
  }

  databank(action, guildId, payload = {}) {
    return this.call("databank", this.scopedPayload(action, guildId, payload));
  }

  governance(action, guildId, payload = {}) {
    return this.call("governance", this.scopedPayload(action, guildId, payload));
  }

  advanced(action, guildId, payload = {}) {
    return this.call("advanced", this.scopedPayload(action, guildId, payload));
  }

  recovery(action, guildId, payload = {}) {
    return this.call("recovery", this.scopedPayload(action, guildId, payload));
  }

  suite(action, guildId, payload = {}) {
    return this.call("suite", this.scopedPayload(action, guildId, payload));
  }

  guilds(action, guildId, payload = {}) {
    return this.call("guilds", { action, ...(guildId ? { guildId: String(guildId) } : {}), ...payload });
  }

  worker(path = "/health", method = "GET", body = undefined) {
    return this.call("sentient", { path, method, ...(body === undefined ? {} : { body }) });
  }
}

module.exports = {
  DEFAULT_CONTROL_BASE_URL,
  SentientControlClient,
  SentientUnavailableError,
  envBoolean,
};
