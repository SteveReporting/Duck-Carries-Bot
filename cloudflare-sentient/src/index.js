export class SentientGateway {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "GET" || request.method === "HEAD") {
      const body = JSON.stringify({
        ok: true,
        service: "carry-tavern-sentient",
        durableObject: "SentientGateway",
        id: this.state?.id?.toString?.() || null,
        path: url.pathname,
      });

      return new Response(request.method === "HEAD" ? null : body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response("method not allowed", {
      status: 405,
      headers: { allow: "GET, HEAD" },
    });
  }
}

const HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>The Carry Tavern // Project Sentient</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 50% 20%, rgba(95, 45, 145, .28), transparent 36rem),
        #07050a;
      color: #eee8f4;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    main {
      width: min(760px, calc(100% - 32px));
      padding: 34px;
      border: 1px solid rgba(206, 173, 255, .18);
      border-radius: 18px;
      background: rgba(12, 8, 17, .86);
      box-shadow: 0 24px 90px rgba(0, 0, 0, .55);
    }
    .eyebrow { opacity: .58; letter-spacing: .18em; font-size: 12px; }
    h1 { margin: 12px 0 10px; font-size: clamp(30px, 7vw, 58px); letter-spacing: -.05em; }
    p { line-height: 1.7; color: #c9bfd2; }
    .pulse { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #87ffb5; box-shadow: 0 0 20px #87ffb5; margin-right: 9px; }
    .status { margin-top: 26px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,.09); font-size: 13px; color: #a69bae; }
    code { color: #ddd0ea; }
  </style>
</head>
<body>
  <main>
    <div class="eyebrow">THE CARRY TAVERN // PROJECT SENTIENT</div>
    <h1>Something is awake.</h1>
    <p>The Sentient gateway is responding. This endpoint is the web-facing edge of the event. The Discord character process remains separate and can continue running on its persistent bot host.</p>
    <div class="status"><span class="pulse"></span>EDGE STATUS: ONLINE &nbsp;•&nbsp; <code>/health</code> &nbsp;•&nbsp; <code>/api/status</code></div>
  </main>
</body>
</html>`;

const json = (body, status = 200) => new Response(JSON.stringify(body, null, 2), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  },
});

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,HEAD,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    if (url.pathname === "/health") {
      return new Response(request.method === "HEAD" ? null : "ok", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    if (url.pathname === "/api/status") {
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      }

      return json({
        ok: true,
        service: "carry-tavern-sentient",
        edge: "online",
        timestamp: new Date().toISOString(),
      });
    }

    if (url.pathname !== "/") {
      return json({ ok: false, error: "not_found" }, 404);
    }

    if (request.method === "HEAD") {
      return new Response(null, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    return new Response(HTML, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer",
      },
    });
  },
};
