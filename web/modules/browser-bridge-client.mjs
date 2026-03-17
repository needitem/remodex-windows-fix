import { buildBrowserRelaySocketUrl } from "./browser-relay-client.mjs";
import { createBrowserSecureTransport } from "./browser-secure-transport.mjs";

const REQUEST_TIMEOUT_MS = 30_000;

export function createBrowserBridgeClient({
  pairingPayload,
  relayBaseUrl,
  onApplicationMessage = () => {},
  onConnectionState = () => {},
  onLog = () => {},
  onNotification = () => {},
} = {}) {
  const secureTransport = createBrowserSecureTransport({ pairingPayload });
  const pendingRequests = new Map();
  let initialized = false;
  let isManualDisconnect = false;
  let nextRequestId = 1;
  let socket = null;

  let resolveReady = () => {};
  let rejectReady = () => {};
  let readyPromise = resetReadyPromise();
  let resolveSecure = () => {};
  let rejectSecure = () => {};
  let securePromise = resetSecurePromise();

  return {
    async connect() {
      isManualDisconnect = false;
      socket = new WebSocket(buildBrowserRelaySocketUrl(relayBaseUrl || pairingPayload?.relay, pairingPayload?.sessionId));
      secureTransport.bindLiveSendWireMessage((wireMessage) => {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(wireMessage);
        }
      });

      socket.addEventListener("close", (event) => {
        if (isManualDisconnect) {
          isManualDisconnect = false;
          onConnectionState({ detail: "Pairing remains stored locally.", label: "Disconnected", status: "warning" });
          return;
        }
        rejectAllPending(event.reason || "Socket closed by the relay.");
        rejectSecure(new Error(event.reason || "Socket closed by the relay."));
        rejectReady(new Error(event.reason || "Socket closed by the relay."));
        onConnectionState({ detail: event.reason || "Socket closed by the relay.", label: "Disconnected", status: "warning" });
      });
      socket.addEventListener("error", () => {
        rejectAllPending("Relay socket error.");
        rejectSecure(new Error("Relay socket error."));
        rejectReady(new Error("Relay socket error."));
        onConnectionState({ detail: "The relay socket failed before the secure handshake completed.", label: "Socket error", status: "error" });
      });
      socket.addEventListener("message", (event) => {
        void handleWireMessage(String(event.data || "")).catch((error) => {
          rejectSecure(error);
          rejectReady(error);
          onLog("error", error.message || "Failed to process a secure relay message.", "wire");
          onConnectionState({ detail: error.message || "Failed to process a secure relay message.", label: "Secure error", status: "error" });
        });
      });
      socket.addEventListener("open", () => {
        onConnectionState({ detail: "Relay socket open. Starting secure pairing handshake.", label: "Pairing", status: "warning" });
        void secureTransport.startHandshake().then((summary) => {
          onLog("info", "Sent clientHello from the browser.", summary.phoneDeviceId);
        }).catch((error) => {
          rejectSecure(error);
          rejectReady(error);
          onLog("error", error.message || "Could not start secure pairing.", "clientHello");
        });
      });

      return readyPromise;
    },
    async waitUntilReady() {
      return readyPromise;
    },
    async disconnect() {
      isManualDisconnect = true;
      rejectAllPending("Disconnected by user.");
      socket?.close(1000, "Disconnected by user");
      socket = null;
      secureTransport.disconnect();
      initialized = false;
      readyPromise = resetReadyPromise();
      securePromise = resetSecurePromise();
      onConnectionState({ detail: "Pairing remains stored locally.", label: "Disconnected", status: "warning" });
    },
    async listThreads(params = {}) {
      await readyPromise;
      return request("thread/list", params);
    },
    async readThread(threadId) {
      await readyPromise;
      return request("thread/read", { includeTurns: true, threadId });
    },
    async listModels(params = {}) {
      await readyPromise;
      return request("model/list", params);
    },
    async startThread(params = {}) {
      await readyPromise;
      return request("thread/start", params);
    },
    async startTurn(params = {}) {
      await readyPromise;
      return request("turn/start", params);
    },
    async updateThreadMetadata(threadId, gitInfo = null) {
      await readyPromise;
      return request("thread/metadata/update", { gitInfo, threadId });
    },
    getHandshakeSummary() {
      return secureTransport.getHandshakeSummary();
    },
  };

  async function handleWireMessage(rawMessage) {
    const handled = await secureTransport.handleWireMessage(rawMessage, {
      onApplicationMessage(payloadText) {
        onApplicationMessage(payloadText);
        handleApplicationPayload(payloadText);
      },
      onControlMessage(controlMessage) {
        const message = controlMessage.message || controlMessage.code || "Secure transport message";
        onLog(controlMessage.kind === "secureError" ? "error" : "info", message, controlMessage.code || controlMessage.kind);
      },
      async onReady(summary) {
        onConnectionState({ detail: "Secure transport established. Initializing the app-server protocol.", label: "Secure", status: "ready" });
        onLog("info", "Browser secure transport is ready.", summary.trustedMacFingerprint);
        resolveSecure();
        try {
          await initializeProtocol();
          resolveReady();
          onConnectionState({ detail: "Secure transport and app-server protocol are ready.", label: "Ready", status: "ready" });
        } catch (error) {
          rejectReady(error);
          onConnectionState({ detail: error.message || "App-server initialization failed.", label: "Initialize failed", status: "error" });
        }
      },
    });

    if (!handled) {
      onLog("warn", "Unhandled wire message reached the browser client.", rawMessage.slice(0, 64));
    }
  }

  async function initializeProtocol() {
    if (initialized) {
      return;
    }
    await securePromise;
    await request("initialize", {
      capabilities: {
        experimentalApi: true,
      },
      clientInfo: {
        name: "Remodex Web",
        version: "0.1.0",
      },
    });
    await notify("initialized", {});
    initialized = true;
    onLog("info", "Initialized the app-server JSON-RPC protocol.", "initialized");
  }

  async function request(method, params) {
    await securePromise;
    const id = `web-${nextRequestId++}`;
    const payloadText = JSON.stringify({ id, method, params });
    await secureTransport.sendApplicationPayload(payloadText);

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`Timed out waiting for ${method}`));
      }, REQUEST_TIMEOUT_MS);

      pendingRequests.set(id, {
        reject,
        resolve(result) {
          clearTimeout(timeoutId);
          resolve(result);
        },
        rejectWith(error) {
          clearTimeout(timeoutId);
          reject(error);
        },
      });
    });
  }

  async function notify(method, params) {
    await securePromise;
    await secureTransport.sendApplicationPayload(JSON.stringify({ method, params }));
  }

  function handleApplicationPayload(payloadText) {
    const parsed = safeParseJSON(payloadText);
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    if (parsed.id != null) {
      const pending = pendingRequests.get(String(parsed.id));
      if (!pending) {
        return;
      }
      pendingRequests.delete(String(parsed.id));
      if (parsed.error) {
        pending.rejectWith(new Error(parsed.error.message || "Request failed."));
        return;
      }
      pending.resolve(parsed.result);
      return;
    }

    if (typeof parsed.method === "string") {
      onNotification(parsed);
    }
  }

  function rejectAllPending(message) {
    for (const [id, pending] of pendingRequests) {
      pending.rejectWith(new Error(message));
      pendingRequests.delete(id);
    }
  }

  function resetReadyPromise() {
    return new Promise((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
  }

  function resetSecurePromise() {
    return new Promise((resolve, reject) => {
      resolveSecure = resolve;
      rejectSecure = reject;
    });
  }
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
