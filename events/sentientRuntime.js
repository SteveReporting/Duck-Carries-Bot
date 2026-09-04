"use strict";

const { createSentientRuntime } = require("../sentient/runtime");

module.exports = {
  name: "clientReady",
  once: true,
  async execute(readyClient, injectedClient) {
    const client = injectedClient || readyClient;
    if (!client || client.sentient) return;
    client.sentient = createSentientRuntime(client).attach();
  },
};
