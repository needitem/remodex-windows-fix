// FILE: relay-server.js
// Purpose: Small HTTP wrapper that hosts the upstream-compatible WebSocket relay.
// Layer: CLI service
// Exports: startRelayServer
// Depends on: http, ws, ../relay/relay

const http = require("http");
const { WebSocketServer } = require("ws");
const { getRelayStats, setupRelay } = require("../relay/relay");

function startRelayServer({
  host = process.env.REMODEX_RELAY_HOST || "0.0.0.0",
  port = parsePort(process.env.PORT || process.env.REMODEX_RELAY_PORT, 9000),
} = {}) {
  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      const payload = JSON.stringify({
        ok: true,
        ...getRelayStats(),
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(payload, "utf8"),
      });
      res.end(payload);
      return;
    }

    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
  });

  const wss = new WebSocketServer({ server });
  setupRelay(wss);

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

module.exports = {
  startRelayServer,
};
