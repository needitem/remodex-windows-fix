// FILE: relay-server.js
// Purpose: Small HTTP wrapper that hosts the upstream-compatible WebSocket relay plus local web assets.
// Layer: CLI service
// Exports: startRelayServer
// Depends on: http, ws, ../relay/relay, ./fixed-window-rate-limiter, ./web-client-static

const http = require("http");
const { WebSocketServer } = require("ws");
const {
  getRelayStats,
  hasAuthenticatedMacSession,
  relaySessionLogLabel,
  resolveTrustedMacSession,
  setupRelay,
} = require("../relay/relay");
const { createPushSessionService } = require("../relay/push-service");
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
  enablePushService = readOptionalBooleanEnv([
    "REMODEX_ENABLE_PUSH_SERVICE",
    "PHODEX_ENABLE_PUSH_SERVICE",
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
  const httpRateLimiter = new FixedWindowRateLimiter(60_000, 120);
  const pushRateLimiter = new FixedWindowRateLimiter(60_000, 30);
  const upgradeRateLimiter = new FixedWindowRateLimiter(upgradeWindowMs, upgradeMaxRequests);
  const pushEnabled = Boolean(enablePushService);
  const pushSessionService = pushEnabled
    ? createPushSessionService({
        canRegisterSession({ sessionId, notificationSecret }) {
          return hasAuthenticatedMacSession(sessionId, notificationSecret);
        },
        canNotifyCompletion({ sessionId, notificationSecret }) {
          return hasAuthenticatedMacSession(sessionId, notificationSecret);
        },
      })
    : createDisabledPushSessionService();

  const server = http.createServer((req, res) => {
    void handleHTTPRequest(req, res, {
      exposeDetailedHealth,
      httpRateLimiter,
      pushEnabled,
      pushRateLimiter,
      pushSessionService,
      trustProxy,
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  setupRelay(wss);

  server.on("upgrade", (req, socket, head) => {
    const pathname = safePathname(req.url);
    const clientKey = clientAddressKeyFromRequest(req, trustProxy);
    const role = readHeaderString(req.headers["x-role"]) || "missing";
    const redactedPath = redactRelayPathname(req.url || "");

    console.log(
      `[relay] upgrade request path=${redactedPath} remote=${clientKey} role=${role}`
    );

    if (!pathname.startsWith("/relay/")) {
      console.log(`[relay] rejecting upgrade for non-relay path: ${redactedPath}`);
      socket.destroy();
      return;
    }

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

  return { server, wss, pushSessionService };
}

async function handleHTTPRequest(req, res, {
  exposeDetailedHealth,
  httpRateLimiter,
  pushEnabled,
  pushRateLimiter,
  pushSessionService,
  trustProxy,
}) {
  const pathname = safePathname(req.url);

  if (req.method === "GET" && pathname === "/health") {
    return writeJson(
      res,
      200,
      exposeDetailedHealth
        ? {
            ok: true,
            relay: getRelayStats(),
            push: pushSessionService.getStats(),
          }
        : {
            ok: true,
          }
    );
  }

  if (serveWebClientRequest(req, res)) {
    return;
  }

  const requestKey = clientAddressKeyFromRequest(req, trustProxy);
  if (!httpRateLimiter.allow(requestKey)) {
    return writeRateLimitResponse(res);
  }

  if (req.method === "POST" && pathname === "/v1/push/session/register-device") {
    if (!pushEnabled) {
      return writeJson(res, 404, {
        ok: false,
        error: "Not found",
      });
    }
    if (!pushRateLimiter.allow(`${requestKey}:register-device`)) {
      return writeRateLimitResponse(res);
    }
    return handleJSONRoute(req, res, async (body) => pushSessionService.registerDevice(body));
  }

  if (req.method === "POST" && pathname === "/v1/push/session/notify-completion") {
    if (!pushEnabled) {
      return writeJson(res, 404, {
        ok: false,
        error: "Not found",
      });
    }
    if (!pushRateLimiter.allow(`${requestKey}:notify-completion`)) {
      return writeRateLimitResponse(res);
    }
    return handleJSONRoute(req, res, async (body) => pushSessionService.notifyCompletion(body));
  }

  if (req.method === "POST" && pathname === "/v1/trusted/session/resolve") {
    return handleJSONRoute(req, res, async (body) => resolveTrustedMacSession(body));
  }

  writeJson(res, 404, {
    ok: false,
    error: "Not found",
  });
}

async function handleJSONRoute(req, res, handler) {
  try {
    const body = await readJSONBody(req);
    const result = await handler(body);
    return writeJson(res, 200, result);
  } catch (error) {
    return writeJson(res, error.status || 500, {
      ok: false,
      error: error.message || "Internal server error",
      code: error.code || "internal_error",
    });
  }
}

function readJSONBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;

    req.on("data", (chunk) => {
      totalSize += chunk.length;
      if (totalSize > 64 * 1024) {
        reject(Object.assign(new Error("Request body too large"), {
          status: 413,
          code: "body_too_large",
        }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      if (!rawBody.trim()) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(rawBody));
      } catch {
        reject(Object.assign(new Error("Invalid JSON body"), {
          status: 400,
          code: "invalid_json",
        }));
      }
    });

    req.on("error", reject);
  });
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(body));
}

function writeRateLimitResponse(res) {
  res.setHeader("retry-after", "60");
  writeJson(res, 429, {
    ok: false,
    error: "Too many requests",
    code: "rate_limited",
  });
}

function createDisabledPushSessionService() {
  return {
    getStats() {
      return {
        enabled: false,
        registeredSessions: 0,
        deliveredDedupeKeys: 0,
        apnsConfigured: false,
      };
    },
  };
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

function safePathname(rawUrl) {
  try {
    return new URL(rawUrl || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function clientAddressKeyFromRequest(req, trustProxy) {
  if (trustProxy) {
    const forwarded = forwardedClientAddress(req);
    if (forwarded) {
      return forwarded;
    }
  }

  return req.socket?.remoteAddress || "unknown";
}

function forwardedClientAddress(req) {
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

  return "";
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
  clientAddressKeyFromRequest,
  readOptionalBooleanEnv,
  redactRelayPathname,
  startRelayServer,
};
