import { buildBrowserRelaySocketUrl } from "./browser-relay-client.mjs";
import { createBrowserSecureTransport } from "./browser-secure-transport.mjs";

const REQUEST_TIMEOUT_MS = 30_000;
const CONNECT_RETRY_DELAY_MS = 900;
const UNEXPECTED_CLOSE_RETRY_DELAY_MS = 1_500;
const CLOSE_CODE_INVALID_SESSION = 4000;
const CLOSE_CODE_IPHONE_REPLACED = 4003;

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
  let hasEstablishedSession = false;
  let initialized = false;
  let isManualDisconnect = false;
  let nextRequestId = 1;
  let reconnectTimer = null;
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
      clearReconnectTimer();
      openSocket({
        connectStartedAt: Date.now(),
      });
      return readyPromise;
    },
    async waitUntilReady() {
      return readyPromise;
    },
    async disconnect() {
      isManualDisconnect = true;
      hasEstablishedSession = false;
      clearReconnectTimer();
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
    async readThreadRuntime(threadId) {
      await readyPromise;
      return request("thread/runtime/read", { threadId });
    },
    async readThreadPatch(threadId, turnId = null) {
      await readyPromise;
      return request("thread/patch/read", turnId ? { threadId, turnId } : { threadId });
    },
    async readActiveThread() {
      await readyPromise;
      return request("thread/active/read", {});
    },
    async readAccount() {
      await readyPromise;
      return request("account/read", {});
    },
    async readRateLimits() {
      await readyPromise;
      return request("account/rateLimits/read", {});
    },
    async listModels(params = {}) {
      await readyPromise;
      return request("model/list", params);
    },
    async gitBranchesWithStatus(cwd) {
      await readyPromise;
      return request("git/branchesWithStatus", { cwd });
    },
    async gitCheckout(cwd, branch) {
      await readyPromise;
      return request("git/checkout", { branch, cwd });
    },
    async gitCreateBranch(cwd, name) {
      await readyPromise;
      return request("git/createBranch", { cwd, name });
    },
    async gitRemoteUrl(cwd) {
      await readyPromise;
      return request("git/remoteUrl", { cwd });
    },
    async startThread(params = {}) {
      await readyPromise;
      return request("thread/start", params);
    },
    async forkThread(params = {}) {
      await readyPromise;
      return request("thread/fork", params);
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

  function openSocket({ connectStartedAt }) {
    secureTransport.disconnect();
    securePromise = resetSecurePromise();
    socket = new WebSocket(buildBrowserRelaySocketUrl(relayBaseUrl || pairingPayload?.relay, pairingPayload?.sessionId));
    const activeSocket = socket;

    secureTransport.bindLiveSendWireMessage((wireMessage) => {
      if (activeSocket?.readyState === WebSocket.OPEN) {
        activeSocket.send(wireMessage);
      }
    });

    activeSocket.addEventListener("close", (event) => {
      if (socket !== activeSocket) {
        return;
      }
      if (socket === activeSocket) {
        socket = null;
      }
      if (isManualDisconnect) {
        isManualDisconnect = false;
        onConnectionState({ detail: "Pairing remains stored locally.", label: "Disconnected", status: "warning" });
        return;
      }

      const closeReason = event.reason || "Socket closed by the relay.";
      const closeCode = Number(event.code) || 0;
      const shouldRetryWaitingForMac = !initialized
        && !hasEstablishedSession
        && closeReason === "Mac session not available";
      const shouldRetryPersistentSession = hasEstablishedSession
        && closeCode !== CLOSE_CODE_INVALID_SESSION
        && closeCode !== CLOSE_CODE_IPHONE_REPLACED;

      if (shouldRetryWaitingForMac) {
        onLog("warn", "Mac session is not available yet. Retrying the relay socket.", closeReason);
        onConnectionState({
          detail: "The pairing is still valid, but the Mac bridge is not attached right now. Retrying automatically.",
          label: "Waiting for Mac",
          status: "warning",
        });
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          openSocket({ connectStartedAt });
        }, CONNECT_RETRY_DELAY_MS);
        return;
      }

      rejectAllPending(closeReason);

      if (shouldRetryPersistentSession) {
        secureTransport.disconnect();
        readyPromise = resetReadyPromise();
        initialized = false;
        onLog("warn", "Relay socket closed unexpectedly. Reconnecting automatically.", closeReason);
        onConnectionState({
          detail: "The relay socket dropped unexpectedly. Reconnecting automatically.",
          label: "Reconnecting",
          status: "warning",
        });
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          openSocket({ connectStartedAt: Date.now() });
        }, UNEXPECTED_CLOSE_RETRY_DELAY_MS);
        return;
      }

      rejectSecure(new Error(closeReason));
      rejectReady(new Error(closeReason));
      onConnectionState({ detail: closeReason, label: "Disconnected", status: "warning" });
    });

    activeSocket.addEventListener("error", () => {
      if (socket !== activeSocket) {
        return;
      }
      rejectAllPending("Relay socket error.");
      rejectSecure(new Error("Relay socket error."));
      rejectReady(new Error("Relay socket error."));
      onConnectionState({ detail: "The relay socket failed before the secure handshake completed.", label: "Socket error", status: "error" });
    });

    activeSocket.addEventListener("message", (event) => {
      if (socket !== activeSocket) {
        return;
      }
      void handleWireMessage(String(event.data || "")).catch((error) => {
        rejectSecure(error);
        rejectReady(error);
        onLog("error", error.message || "Failed to process a secure relay message.", "wire");
        onConnectionState({ detail: error.message || "Failed to process a secure relay message.", label: "Secure error", status: "error" });
      });
    });

    activeSocket.addEventListener("open", () => {
      if (socket !== activeSocket) {
        return;
      }
      clearReconnectTimer();
      onConnectionState({ detail: "Relay socket open. Starting secure pairing handshake.", label: "Pairing", status: "warning" });
      void secureTransport.startHandshake().then((summary) => {
        onLog("info", "Sent clientHello from the browser.", summary.phoneDeviceId);
      }).catch((error) => {
        rejectSecure(error);
        rejectReady(error);
        onLog("error", error.message || "Could not start secure pairing.", "clientHello");
      });
    });
  }

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
        hasEstablishedSession = true;
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

      void secureTransport.sendApplicationPayload(payloadText).catch((error) => {
        pendingRequests.delete(id);
        clearTimeout(timeoutId);
        reject(error);
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

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
