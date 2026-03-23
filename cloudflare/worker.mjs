import { DurableObject } from "cloudflare:workers";
import { WEB_ASSETS } from "./web-assets.generated.mjs";

const CLOSE_CODE_INVALID_SESSION = 4000;
const CLOSE_CODE_MAC_REPLACED = 4001;
const CLOSE_CODE_SESSION_UNAVAILABLE = 4002;
const CLOSE_CODE_IPHONE_REPLACED = 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse({
        ok: true,
        service: "remodex-relay",
        runtime: "cloudflare-workers",
      });
    }

    if (url.pathname === "/" || url.pathname === "/app") {
      return Response.redirect(`${url.origin}/app/`, 302);
    }

    const webAsset = WEB_ASSETS.get(url.pathname);
    if (webAsset) {
      return new Response(webAsset.body, {
        status: 200,
        headers: {
          "cache-control": webAsset.cacheControl,
          "content-type": webAsset.contentType,
        },
      });
    }

    const match = url.pathname.match(/^\/relay\/([^/?]+)/);
    if (!match) {
      return new Response("not found", { status: 404 });
    }

    const sessionId = match[1];
    const stub = env.SESSION_RELAY.get(env.SESSION_RELAY.idFromName(sessionId));
    return stub.fetch(request);
  },
};

export class SessionRelay extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.ctx = ctx;
    this.env = env;
    this.mac = null;
    this.clients = new Set();
    this.notificationSecret = null;

    for (const socket of this.ctx.getWebSockets()) {
      const metadata = socket.deserializeAttachment() || {};
      if (metadata.role === "mac") {
        this.mac = socket;
      } else if (metadata.role === "iphone") {
        this.clients.add(socket);
      }
    }
  }

  async fetch(request) {
    const upgrade = request.headers.get("Upgrade");
    if (!upgrade || upgrade.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    const sessionId = url.pathname.match(/^\/relay\/([^/?]+)/)?.[1];
    const role = resolveRelayRole(request, url);

    if (!sessionId || (role !== "mac" && role !== "iphone")) {
      return closeWebSocketResponse(
        CLOSE_CODE_INVALID_SESSION,
        "Missing sessionId or invalid x-role header"
      );
    }

    if (role === "iphone" && !this.isSocketOpen(this.mac)) {
      return closeWebSocketResponse(
        CLOSE_CODE_SESSION_UNAVAILABLE,
        "Mac session not available"
      );
    }

    const pair = new WebSocketPair();
    const [clientSocket, serverSocket] = Object.values(pair);

    this.ctx.acceptWebSocket(serverSocket);
    serverSocket.serializeAttachment({ role, sessionId });

    if (role === "mac") {
      this.notificationSecret = readHeaderString(request.headers.get("x-notification-secret"));
      if (this.isSocketOpen(this.mac)) {
        this.safeClose(
          this.mac,
          CLOSE_CODE_MAC_REPLACED,
          "Replaced by new Mac connection"
        );
      }
      this.mac = serverSocket;
      console.log(`[relay] Mac connected -> ${relaySessionLogLabel(sessionId)}`);
    } else {
      for (const existingClient of this.clients) {
        if (existingClient === serverSocket) {
          continue;
        }
        this.safeClose(
          existingClient,
          CLOSE_CODE_IPHONE_REPLACED,
          "Replaced by newer iPhone connection"
        );
      }
      this.clients = new Set([serverSocket]);
      console.log(`[relay] iPhone connected -> ${relaySessionLogLabel(sessionId)} (1 client)`);
    }

    return new Response(null, { status: 101, webSocket: clientSocket });
  }

  async webSocketMessage(socket, message) {
    const metadata = socket.deserializeAttachment() || {};
    const text = normalizeMessage(message);

    if (metadata.role === "mac") {
      for (const client of this.clients) {
        this.safeSend(client, text);
      }
      return;
    }

    if (this.isSocketOpen(this.mac)) {
      this.safeSend(this.mac, text);
    }
  }

  async webSocketClose(socket) {
    await this.dropSocket(socket);
  }

  async webSocketError(socket, error) {
    const metadata = socket.deserializeAttachment() || {};
    console.error(
      `[relay] WebSocket error (${metadata.role || "unknown"}, ${relaySessionLogLabel(metadata.sessionId)}):`,
      error?.message || String(error)
    );
    await this.dropSocket(socket);
  }

  async dropSocket(socket) {
    const metadata = socket.deserializeAttachment() || {};
    const sessionLabel = relaySessionLogLabel(metadata.sessionId);

    if (metadata.role === "mac") {
      if (this.mac === socket) {
        this.mac = null;
        this.notificationSecret = null;
        console.log(`[relay] Mac disconnected -> ${sessionLabel}`);
        for (const client of this.clients) {
          this.safeClose(client, CLOSE_CODE_SESSION_UNAVAILABLE, "Mac disconnected");
        }
        this.clients.clear();
      }
    } else if (metadata.role === "iphone") {
      this.clients.delete(socket);
      console.log(`[relay] iPhone disconnected -> ${sessionLabel} (${this.clients.size} remaining)`);
    }
  }

  isSocketOpen(socket) {
    return !!socket && socket.readyState === 1;
  }

  safeSend(socket, message) {
    if (!this.isSocketOpen(socket)) {
      return;
    }

    try {
      socket.send(message);
    } catch {}
  }

  safeClose(socket, code, reason) {
    if (!socket) {
      return;
    }

    try {
      socket.close(code, reason);
    } catch {}
  }
}

function normalizeMessage(message) {
  if (typeof message === "string") {
    return message;
  }

  if (message instanceof ArrayBuffer) {
    return new TextDecoder().decode(message);
  }

  return String(message);
}

function closeWebSocketResponse(code, reason) {
  const pair = new WebSocketPair();
  const [clientSocket, serverSocket] = Object.values(pair);
  serverSocket.accept();
  serverSocket.close(code, reason);
  return new Response(null, { status: 101, webSocket: clientSocket });
}

function readHeaderString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveRelayRole(request, url = new URL(request.url)) {
  const headerRole = readHeaderString(request.headers.get("x-role"));
  if (headerRole === "mac" || headerRole === "iphone") {
    return headerRole;
  }

  const queryRole = readHeaderString(url.searchParams.get("role"));
  return queryRole === "iphone" ? queryRole : null;
}

function relaySessionLogLabel(sessionId) {
  const normalizedSessionId = typeof sessionId === "string" ? sessionId.trim() : "";
  if (!normalizedSessionId) {
    return "session=[redacted]";
  }

  return `session#${shortDigestHex(normalizedSessionId)}`;
}

function shortDigestHex(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, "0");
}

function jsonResponse(value) {
  const payload = JSON.stringify(value);
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
