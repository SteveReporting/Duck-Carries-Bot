const http = require("http");
const { getLocalAiBaseUrl } = require("../ai/localChat");

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function readBody(request) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let total = 0;

        request.on("data", (chunk) => {
            total += chunk.length;
            if (total > MAX_BODY_BYTES) {
                reject(new Error("Request body is too large."));
                request.destroy();
                return;
            }
            chunks.push(chunk);
        });

        request.on("end", () => resolve(Buffer.concat(chunks)));
        request.on("error", reject);
    });
}

function sendJson(response, status, value) {
    const body = JSON.stringify(value);
    response.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
    });
    response.end(body);
}

function startLocalAiProxy() {
    const secret = String(process.env.LOCAL_AI_PROXY_SECRET || "").trim();
    if (!secret) {
        console.log("🤖 Local AI proxy disabled (LOCAL_AI_PROXY_SECRET is not set).");
        return null;
    }

    const host = process.env.LOCAL_AI_PROXY_HOST || "127.0.0.1";
    const port = Math.max(1, Math.min(65535, Number(process.env.LOCAL_AI_PROXY_PORT) || 11435));

    const server = http.createServer(async (request, response) => {
        const auth = String(request.headers.authorization || "");
        if (auth !== `Bearer ${secret}`) {
            return sendJson(response, 401, { error: "Unauthorized" });
        }

        if (request.method === "GET" && request.url === "/health") {
            return sendJson(response, 200, {
                ok: true,
                backend: getLocalAiBaseUrl(),
            });
        }

        if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
            return sendJson(response, 404, { error: "Not found" });
        }

        try {
            const body = await readBody(request);
            const upstream = await fetch(`${getLocalAiBaseUrl()}/chat/completions`, {
                method: "POST",
                headers: {
                    Authorization: "Bearer ollama",
                    "Content-Type": "application/json",
                },
                body,
                signal: AbortSignal.timeout(120000),
            });

            const payload = Buffer.from(await upstream.arrayBuffer());
            response.writeHead(upstream.status, {
                "Content-Type": upstream.headers.get("content-type") || "application/json",
                "Content-Length": payload.length,
                "Cache-Control": "no-store",
            });
            response.end(payload);
        } catch (error) {
            console.error("[LOCAL AI PROXY]", error.message);
            if (!response.headersSent) {
                return sendJson(response, 502, { error: error.message });
            }
            response.end();
        }
    });

    server.listen(port, host, () => {
        console.log(`🤖 Local AI proxy listening on http://${host}:${port}`);
    });

    return server;
}

module.exports = { startLocalAiProxy };
