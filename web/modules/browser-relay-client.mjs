export function createBrowserRelayClient({
  pairingPayload,
  relayBaseUrl,
  onClose = () => {},
  onError = () => {},
  onMessage = () => {},
  onOpen = () => {},
} = {}) {
  let socket = null;

  return {
    connect() {
      const websocketUrl = buildBrowserRelaySocketUrl(relayBaseUrl || pairingPayload?.relay, pairingPayload?.sessionId);
      socket = new WebSocket(websocketUrl);

      socket.addEventListener("open", () => onOpen(websocketUrl));
      socket.addEventListener("close", (event) => onClose(event));
      socket.addEventListener("error", (event) => onError(event));
      socket.addEventListener("message", (event) => onMessage(String(event.data || "")));
    },
    disconnect() {
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close(1000, "Browser client disconnected");
      }
    },
    sendJSON(payload) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        throw new Error("Socket is not open.");
      }
      socket.send(JSON.stringify(payload));
    },
  };
}

export function inferRelayBaseUrl(locationLike) {
  if (!locationLike?.host || !locationLike?.protocol) {
    return "";
  }

  const socketProtocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${socketProtocol}//${locationLike.host}/relay`;
}

export function buildBrowserRelaySocketUrl(relayBaseUrl, sessionId) {
  const normalizedRelayBase = normalizeRelayBaseUrl(relayBaseUrl);
  if (!normalizedRelayBase) {
    throw new Error("Relay base URL is missing.");
  }
  if (typeof sessionId !== "string" || !sessionId.trim()) {
    throw new Error("Session ID is missing.");
  }

  const url = new URL(`${normalizedRelayBase}/${encodeURIComponent(sessionId.trim())}`);
  url.searchParams.set("role", "iphone");
  return url.toString();
}

function normalizeRelayBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.startsWith("ws://") || trimmed.startsWith("wss://")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://")) {
    return `ws://${trimmed.slice("http://".length)}`;
  }
  if (trimmed.startsWith("https://")) {
    return `wss://${trimmed.slice("https://".length)}`;
  }

  throw new Error("Relay base URL must start with ws://, wss://, http://, or https://.");
}
