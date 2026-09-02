const { startLocalAiProxy } = require("./localAiProxy");

try {
    startLocalAiProxy();
} catch (error) {
    console.error("[LOCAL AI PROXY] Failed to start:", error);
}
