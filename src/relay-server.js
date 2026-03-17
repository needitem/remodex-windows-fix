// FILE: relay-server.js
// Purpose: Small HTTP wrapper that hosts the upstream-compatible WebSocket relay.
// Layer: CLI service
// Exports: startRelayServer
// Depends on: http, ws, ../relay/relay, ./fixed-window-rate-limiter, ./web-client-static

const http = require("http");
const { WebSocketServer } = require("ws");
const {
  getRelayStats,
  relaySessionLogLabel,
  setupRelay,
} = require("../relay/relay");
const { FixedWindowRateLimiter } = require("./fixed-window-rate-limiter");
const { serveWebClientRequest } = require("./web-client-static");

function startRelayServer({
  host = process.env.REMODEX_RELAY_HOST || "0.0.0.0",
  port = parsePort(process.env.PORT || process.env.REMODEX_RELAY_PORT, 9000),
  trustProxy = readOptionalBooleanEnv(["REMODEX_TRUST_PROXY", "PHODEX_TRUST_PROXY"]) || false,
  exposeDetailedHealth = readOptionalBooleanEnv([
    "REMODEX_RELAY_EXPOSE_DETAILED_HEALTH",
    "PHODEX_RELAY_EXPOSE_DETAILED_HEALTH",
  ]) || false,
  upgradeWindowMs = parsePositiveInt(
    process.env.REMODEX_RELAY_UPGRADE_WINDOW_MS || process.env.PHODEX_RELAY_UPGRADE_WINDOW_MS,
    60_000
  ),
  upgradeMaxRequests = parsePositiveInt(
    process.env.REMODEX_RELAY_UPGRADE_MAX_PER_WINDOW || process.env.PHODEX_RELAY_UPGRADE_MAX_PER_WINDOW,
    60
  ),
} = {}) {
  const upgradeRateLimiter = new FixedWindowRateLimiter(upgradeWindowMs, upgradeMaxRequests);
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const payload = JSON.stringify(
        exposeDetailedHealth
          ? {
            ok: true,
            ...getRelayStats(),
          }
          : {
            ok: true,
          }
      );
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload, "utf8"),
      });
      res.end(payload);
      return;
    }

    if (serveWebClientRequest(req, res)) {
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  const wss = new WebSocketServer({ noServer: true });
  setupRelay(wss);

  server.on("upgrade", (req, socket, head) => {
    const clientKey = clientAddressKeyFromRequest(req, trustProxy);
    const role = readHeaderString(req.headers["x-role"]) || "missing";
    const redactedPath = redactRelayPathname(req.url || "");

    console.log(
      `[relay] upgrade request path=${redactedPath} remote=${clientKey} role=${role}`
    );

    if (!upgradeRateLimiter.allow(clientKey)) {
      console.log(`[relay] rejecting upgrade due to rate limit: ${redactedPath}`);
      rejectUpgrade(socket);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  server.listen(port, host, () => {
    console.log(`[remodex-relay] Listening on ws://${host}:${port}/relay`);
    console.log(`[remodex-relay] Health endpoint: http://${host}:${port}/health`);
  });

  const shutdown = () => {
    wss.close(() => {
      server.close(() => process.exit(0));
    });
    setTimeout(() => process.exit(0), 250).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  return { server, wss };
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptionalBooleanEnv(keys) {
  for (const key of keys) {
    const rawValue = process.env[key];
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      continue;
    }

    switch (rawValue.trim().toLowerCase()) {
      case "1":
      case "true":
      case "yes":
      case "on":
        return true;
      case "0":
      case "false":
      case "no":
      case "off":
        return false;
      default:
        break;
    }
  }

  return null;
}

function clientAddressKeyFromRequest(req, trustProxy) {
  if (trustProxy) {
    const realIp = readHeaderString(req.headers["x-real-ip"]);
    if (realIp) {
      return realIp;
    }

    const forwardedFor = readHeaderString(req.headers["x-forwarded-for"]);
    if (forwardedFor) {
      const firstHop = forwardedFor.split(",").map((value) => value.trim()).find(Boolean);
      if (firstHop) {
        return firstHop;
      }
    }
  }

  return req.socket?.remoteAddress || "unknown";
}

function redactRelayPathname(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith("/relay/")) {
    return pathname || "/";
  }

  const sessionId = pathname.match(/^\/relay\/([^/?]+)/)?.[1];
  if (!sessionId) {
    return "/relay/[session]";
  }

  const suffix = pathname.slice(`/relay/${sessionId}`.length);
  return `/relay/${relaySessionLogLabel(sessionId)}${suffix}`;
}

function readHeaderString(value) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function rejectUpgrade(socket) {
  const body = JSON.stringify({
    ok: false,
    error: "Too many requests",
    code: "rate_limited",
  });
  const response = [
    "HTTP/1.1 429 Too Many Requests",
    "Connection: close",
    "Content-Type: application/json; charset=utf-8",
    "Retry-After: 60",
    `Content-Length: ${Buffer.byteLength(body, "utf8")}`,
    "",
    body,
  ].join("\r\n");

  socket.write(response);
  socket.destroy();
}

module.exports = {
  startRelayServer,
  clientAddressKeyFromRequest,
  readOptionalBooleanEnv,
  redactRelayPathname,
};
