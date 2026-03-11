import { DurableObject } from "cloudflare:workers";

const CLOSE_CODE_INVALID_SESSION = 4000;
const CLOSE_CODE_MAC_REPLACED = 4001;
const CLOSE_CODE_SESSION_UNAVAILABLE = 4002;
const CLOSE_CODE_IPHONE_REPLACED = 4003;

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
    const role = request.headers.get("x-role");

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
    serverSocket.serializeAttachment({ role });

    if (role === "mac") {
      if (this.isSocketOpen(this.mac)) {
        this.safeClose(
          this.mac,
          CLOSE_CODE_MAC_REPLACED,
          "Replaced by new Mac connection"
        );
      }
      this.mac = serverSocket;
      console.log(`[relay] Mac connected -> session ${sessionId}`);
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
      console.log(`[relay] iPhone connected -> session ${sessionId} (1 client)`);
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
    console.error("[relay] WebSocket error:", error?.message || String(error));
    await this.dropSocket(socket);
  }

  async dropSocket(socket) {
    const metadata = socket.deserializeAttachment() || {};

    if (metadata.role === "mac") {
      if (this.mac === socket) {
        this.mac = null;
        for (const client of this.clients) {
          this.safeClose(client, CLOSE_CODE_SESSION_UNAVAILABLE, "Mac disconnected");
        }
        this.clients.clear();
      }
    } else if (metadata.role === "iphone") {
      this.clients.delete(socket);
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

function jsonResponse(value) {
  const payload = JSON.stringify(value);
  return new Response(payload, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
    },
  });
}
