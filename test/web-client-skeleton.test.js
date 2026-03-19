// FILE: web-client-skeleton.test.js
// Purpose: Verifies the browser client skeleton assets and URL helpers stay wired correctly.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/web-client-static

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  sign,
} = require("node:crypto");

const { resolveWebClientAsset } = require("../src/web-client-static");

test("resolveWebClientAsset maps /app/ to the browser shell entrypoint", () => {
  const asset = resolveWebClientAsset("/app/");

  assert.ok(asset);
  assert.match(asset.filePath, /web[\\\/]index\.html$/);
  assert.equal(asset.contentType, "text/html; charset=utf-8");
});

test("resolveWebClientAsset blocks traversal outside the web root", () => {
  assert.equal(resolveWebClientAsset("/app/../../package.json"), null);
});

test("browser relay URL helper appends the session id and iphone role query parameter", async () => {
  const { buildBrowserRelaySocketUrl } = await import("../web/modules/browser-relay-client.mjs");

  assert.equal(
    buildBrowserRelaySocketUrl("https://relay.example/relay", "session-42"),
    "wss://relay.example/relay/session-42?role=iphone"
  );
});

test("pairing parser rejects incomplete payloads", async () => {
  const { parsePairingPayload } = await import("../web/modules/pairing.mjs");

  assert.throws(
    () => parsePairingPayload('{"v":2,"relay":"wss://relay.example/relay","macDeviceId":"mac-1","macIdentityPublicKey":"key","expiresAt":1}'),
    /sessionId/
  );
});

test("web storage exposes the persisted client note default", async () => {
  const storage = createMemoryStorage();
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = storage;

  try {
    const {
      DEFAULT_PERSISTED_CLIENT_NOTE,
      loadStoredClientNote,
      saveStoredClientNote,
    } = await import(`../web/modules/storage.mjs?case=${Date.now()}`);

    assert.equal(DEFAULT_PERSISTED_CLIENT_NOTE, "hello from web client");
    assert.equal(loadStoredClientNote(), "");

    saveStoredClientNote(DEFAULT_PERSISTED_CLIENT_NOTE);
    assert.equal(loadStoredClientNote(), "hello from web client");
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
});

test("browser secure transport completes the secure handshake and decrypts bridge envelopes", async () => {
  const storage = createMemoryStorage();
  const macIdentity = createOkpKeyPair("ed25519");
  const macEphemeral = createOkpKeyPair("x25519");
  const {
    buildTranscriptBytes,
    createBrowserSecureTransport,
    nonceForDirection,
  } = await import("../web/modules/browser-secure-transport.mjs");
  const transport = createBrowserSecureTransport({
    pairingPayload: {
      sessionId: "session-1",
      relay: "wss://relay.example/relay",
      macDeviceId: "mac-1",
      macIdentityPublicKey: macIdentity.publicKey,
    },
    storage,
    uuidFactory: () => "browser-device-1",
  });
  const wireMessages = [];
  const applicationMessages = [];
  const controlMessages = [];

  transport.bindLiveSendWireMessage((message) => {
    wireMessages.push(JSON.parse(message));
  });
  transport.updatePairingPayload({
    sessionId: "session-1",
    relay: "wss://relay.example/relay",
    macDeviceId: "mac-1",
    macIdentityPublicKey: macIdentity.publicKey,
  });

  const summary = await transport.startHandshake();
  assert.equal(summary.phoneDeviceId, "browser-device-1");

  const clientHello = wireMessages[0];
  const clientNonce = Buffer.from(clientHello.clientNonce, "base64");
  const serverNonce = Buffer.alloc(32, 7);
  const transcriptBytes = Buffer.from(buildTranscriptBytes({
    sessionId: "session-1",
    protocolVersion: 1,
    handshakeMode: "qr_bootstrap",
    keyEpoch: 1,
    macDeviceId: "mac-1",
    phoneDeviceId: "browser-device-1",
    macIdentityPublicKey: macIdentity.publicKey,
    phoneIdentityPublicKey: clientHello.phoneIdentityPublicKey,
    macEphemeralPublicKey: macEphemeral.publicKey,
    phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey,
    clientNonce,
    serverNonce,
    expiresAtForTranscript: 123,
  }));
  const macSignature = sign(
    null,
    transcriptBytes,
    createPrivateKey({
      key: {
        crv: "Ed25519",
        d: base64ToBase64Url(macIdentity.privateKey),
        kty: "OKP",
        x: base64ToBase64Url(macIdentity.publicKey),
      },
      format: "jwk",
    })
  );

  await transport.handleWireMessage(JSON.stringify({
    kind: "serverHello",
    protocolVersion: 1,
    sessionId: "session-1",
    handshakeMode: "qr_bootstrap",
    macDeviceId: "mac-1",
    macIdentityPublicKey: macIdentity.publicKey,
    macEphemeralPublicKey: macEphemeral.publicKey,
    serverNonce: serverNonce.toString("base64"),
    keyEpoch: 1,
    expiresAtForTranscript: 123,
    macSignature: macSignature.toString("base64"),
    clientNonce: clientHello.clientNonce,
  }), {
    onApplicationMessage(message) {
      applicationMessages.push(message);
    },
    onControlMessage(message) {
      controlMessages.push(message);
    },
  });

  const clientAuth = wireMessages[1];
  assert.equal(clientAuth.kind, "clientAuth");

  let readySummary = null;
  await transport.handleWireMessage(JSON.stringify({
    kind: "secureReady",
    sessionId: "session-1",
    keyEpoch: 1,
    macDeviceId: "mac-1",
  }), {
    onApplicationMessage(message) {
      applicationMessages.push(message);
    },
    onControlMessage(message) {
      controlMessages.push(message);
    },
    onReady(summaryValue) {
      readySummary = summaryValue;
    },
  });

  assert.equal(readySummary.phoneDeviceId, "browser-device-1");
  assert.equal(wireMessages[2].kind, "resumeState");

  const sharedSecret = diffieHellman({
    privateKey: createPrivateKey({
      key: {
        crv: "X25519",
        d: base64ToBase64Url(macEphemeral.privateKey),
        kty: "OKP",
        x: base64ToBase64Url(macEphemeral.publicKey),
      },
      format: "jwk",
    }),
    publicKey: createPublicKey({
      key: {
        crv: "X25519",
        kty: "OKP",
        x: base64ToBase64Url(clientHello.phoneEphemeralPublicKey),
      },
      format: "jwk",
    }),
  });
  const salt = createHash("sha256").update(transcriptBytes).digest();
  const infoPrefix = "remodex-e2ee-v1|session-1|mac-1|browser-device-1|1";
  const macToPhoneKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|macToPhone`, "utf8"), 32));
  const phoneToMacKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|phoneToMac`, "utf8"), 32));

  await transport.handleWireMessage(JSON.stringify(encryptEnvelope(
    { bridgeOutboundSeq: 1, payloadText: JSON.stringify({ id: "list-1", result: { ok: true } }) },
    macToPhoneKey,
    "mac",
    0,
    "session-1",
    1,
    nonceForDirection
  )), {
    onApplicationMessage(message) {
      applicationMessages.push(message);
    },
    onControlMessage(message) {
      controlMessages.push(message);
    },
  });

  assert.deepEqual(applicationMessages, [
    JSON.stringify({ id: "list-1", result: { ok: true } }),
  ]);

  await transport.sendApplicationPayload(JSON.stringify({ id: "req-1", method: "thread/list", params: {} }));
  const outboundEnvelope = wireMessages[3];
  const outboundPayload = decryptEnvelope(outboundEnvelope, phoneToMacKey, nonceForDirection);
  assert.equal(outboundPayload.payloadText, JSON.stringify({ id: "req-1", method: "thread/list", params: {} }));
  assert.deepEqual(controlMessages, []);
});

test("browser secure transport persists a stable browser device id", async () => {
  const storage = createMemoryStorage();
  const {
    loadOrCreateBrowserDeviceState,
  } = await import("../web/modules/browser-secure-transport.mjs");

  const first = await loadOrCreateBrowserDeviceState({ storage, uuidFactory: () => "browser-device-1" });
  const second = await loadOrCreateBrowserDeviceState({ storage, uuidFactory: () => "browser-device-2" });

  assert.equal(first.phoneDeviceId, "browser-device-1");
  assert.equal(second.phoneDeviceId, "browser-device-1");
});

test("browser bridge client keeps fast model/list responses from timing out", async () => {
  const storage = createMemoryStorage();
  const macIdentity = createOkpKeyPair("ed25519");
  const macEphemeral = createOkpKeyPair("x25519");
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousWebSocket = globalThis.WebSocket;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const fastSetTimeout = (callback, delay = 0, ...args) => previousSetTimeout(callback, Math.min(delay, 200), ...args);

  globalThis.setTimeout = fastSetTimeout;
  globalThis.clearTimeout = previousClearTimeout;
  globalThis.window = {
    clearTimeout: previousClearTimeout,
    setTimeout: fastSetTimeout,
  };
  globalThis.localStorage = storage;

  try {
    const {
      buildTranscriptBytes,
      nonceForDirection,
    } = await import(`../web/modules/browser-secure-transport.mjs?case=bridge-${Date.now()}`);
    const { createBrowserBridgeClient } = await import(`../web/modules/browser-bridge-client.mjs?case=bridge-${Date.now()}`);
    const relayServer = createFakeBrowserRelayServer({
      buildTranscriptBytes,
      macEphemeral,
      macIdentity,
      nonceForDirection,
      scheduleTask: previousSetTimeout,
    });

    globalThis.WebSocket = class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();

        previousSetTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch("open", {});
        }, 0);
      }

      addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }

      send(message) {
        relayServer.handleOutgoing(this, String(message));
      }

      close(code = 1000, reason = "") {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatch("close", { code, reason });
      }

      dispatch(type, event) {
        for (const handler of this.listeners.get(type) || []) {
          handler(event);
        }
      }
    };

    const client = createBrowserBridgeClient({
      pairingPayload: {
        sessionId: "session-1",
        relay: "wss://relay.example/relay",
        macDeviceId: "mac-1",
        macIdentityPublicKey: macIdentity.publicKey,
      },
    });

    await client.connect();
    const result = await client.listModels();

    assert.equal(relayServer.modelListRequestCount, 1);
    assert.equal(result.data[0].model, "gpt-5");
    await client.disconnect();
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousLocalStorage;
    globalThis.WebSocket = previousWebSocket;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

test("browser bridge client keeps retrying after a previously ready session drops", async () => {
  const storage = createMemoryStorage();
  const macIdentity = createOkpKeyPair("ed25519");
  const macEphemeral = createOkpKeyPair("x25519");
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousWebSocket = globalThis.WebSocket;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;
  const previousDateNow = Date.now;
  const fastSetTimeout = (callback, delay = 0, ...args) => previousSetTimeout(callback, Math.min(delay, 40), ...args);
  let nowValue = 1_000;
  const socketInstances = [];

  globalThis.setTimeout = fastSetTimeout;
  globalThis.clearTimeout = previousClearTimeout;
  globalThis.window = {
    clearTimeout: previousClearTimeout,
    setTimeout: fastSetTimeout,
  };
  globalThis.localStorage = storage;
  Date.now = () => nowValue;

  try {
    const {
      buildTranscriptBytes,
      nonceForDirection,
    } = await import(`../web/modules/browser-secure-transport.mjs?case=persist-${Date.now()}`);
    const { createBrowserBridgeClient } = await import(`../web/modules/browser-bridge-client.mjs?case=persist-${Date.now()}`);

    globalThis.WebSocket = class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        this.sequence = socketInstances.length + 1;
        this.connectStartedAt = nowValue;
        socketInstances.push(this);

        previousSetTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch("open", {});
        }, 0);
      }

      addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }

      send(message) {
        const parsed = JSON.parse(String(message));

        if (this.sequence === 1) {
          handleInitialSessionMessage({
            buildTranscriptBytes,
            macEphemeral,
            macIdentity,
            nonceForDirection,
            parsed,
            socket: this,
          });
          return;
        }

        if (this.sequence === 2 && parsed.kind === "clientHello") {
          nowValue = this.connectStartedAt + 13_000;
          this.close(4002, "Mac session not available");
        }
      }

      close(code = 1000, reason = "") {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatch("close", { code, reason });
      }

      dispatch(type, event) {
        for (const handler of this.listeners.get(type) || []) {
          handler(event);
        }
      }
    };

    const client = createBrowserBridgeClient({
      pairingPayload: {
        sessionId: "session-1",
        relay: "wss://relay.example/relay",
        macDeviceId: "mac-1",
        macIdentityPublicKey: macIdentity.publicKey,
      },
    });

    await client.connect();
    socketInstances[0].close(4002, "Mac disconnected");
    await new Promise((resolve) => previousSetTimeout(resolve, 200));
    assert.ok(socketInstances.length >= 3, "expected the browser client to keep retrying");
    await client.disconnect();
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousLocalStorage;
    globalThis.WebSocket = previousWebSocket;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
    Date.now = previousDateNow;
  }
});

test("browser bridge client keeps retrying while waiting for the Mac bridge to rejoin", async () => {
  const storage = createMemoryStorage();
  const macIdentity = createOkpKeyPair("ed25519");
  const macEphemeral = createOkpKeyPair("x25519");
  const previousWindow = globalThis.window;
  const previousLocalStorage = globalThis.localStorage;
  const previousWebSocket = globalThis.WebSocket;
  const previousSetTimeout = globalThis.setTimeout;
  const previousClearTimeout = globalThis.clearTimeout;

  const fastSetTimeout = (callback, delay = 0, ...args) => previousSetTimeout(callback, Math.min(delay, 40), ...args);

  globalThis.setTimeout = fastSetTimeout;
  globalThis.clearTimeout = previousClearTimeout;
  globalThis.window = {
    clearTimeout: previousClearTimeout,
    setTimeout: fastSetTimeout,
  };
  globalThis.localStorage = storage;

  try {
    const {
      buildTranscriptBytes,
      nonceForDirection,
    } = await import(`../web/modules/browser-secure-transport.mjs?case=waiting-mac-${Date.now()}`);
    const { createBrowserBridgeClient } = await import(`../web/modules/browser-bridge-client.mjs?case=waiting-mac-${Date.now()}`);
    const relayServer = createFakeBrowserRelayServer({
      buildTranscriptBytes,
      macEphemeral,
      macIdentity,
      nonceForDirection,
      scheduleTask: previousSetTimeout,
    });

    const connectionUpdates = [];
    let socketSequence = 0;

    globalThis.WebSocket = class FakeWebSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;

      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.CONNECTING;
        this.listeners = new Map();
        this.sequence = ++socketSequence;

        previousSetTimeout(() => {
          this.readyState = FakeWebSocket.OPEN;
          this.dispatch("open", {});
        }, 0);
      }

      addEventListener(type, handler) {
        const handlers = this.listeners.get(type) || [];
        handlers.push(handler);
        this.listeners.set(type, handlers);
      }

      send(message) {
        const parsed = JSON.parse(String(message));
        if (parsed.kind === "clientHello" && this.sequence < 3) {
          this.close(4002, "Mac session not available");
          return;
        }
        relayServer.handleOutgoing(this, String(message));
      }

      close(code = 1000, reason = "") {
        this.readyState = FakeWebSocket.CLOSED;
        this.dispatch("close", { code, reason });
      }

      dispatch(type, event) {
        for (const handler of this.listeners.get(type) || []) {
          handler(event);
        }
      }
    };

    const client = createBrowserBridgeClient({
      pairingPayload: {
        sessionId: "session-1",
        relay: "wss://relay.example/relay",
        macDeviceId: "mac-1",
        macIdentityPublicKey: macIdentity.publicKey,
      },
      onConnectionState(update) {
        connectionUpdates.push(update);
      },
    });

    await client.connect();
    const result = await client.listModels();

    assert.equal(result.data[0].model, "gpt-5");
    assert.ok(connectionUpdates.some((update) => update.label === "Waiting for Mac"));
    assert.ok(socketSequence >= 3);

    await client.disconnect();
  } finally {
    globalThis.window = previousWindow;
    globalThis.localStorage = previousLocalStorage;
    globalThis.WebSocket = previousWebSocket;
    globalThis.setTimeout = previousSetTimeout;
    globalThis.clearTimeout = previousClearTimeout;
  }
});

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    removeItem(key) {
      map.delete(key);
    },
    setItem(key, value) {
      map.set(key, value);
    },
  };
}

function createOkpKeyPair(type) {
  const { privateKey, publicKey } = generateKeyPairSync(type);
  const privateJwk = privateKey.export({ format: "jwk" });
  const publicJwk = publicKey.export({ format: "jwk" });
  return {
    privateKey: base64UrlToBase64(privateJwk.d),
    publicKey: base64UrlToBase64(publicJwk.x),
  };
}

function encryptEnvelope(payloadObject, key, sender, counter, sessionId, keyEpoch, nonceForDirectionFn) {
  const nonce = Buffer.from(nonceForDirectionFn(sender, counter));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(payloadObject), "utf8")),
    cipher.final(),
  ]);
  return {
    kind: "encryptedEnvelope",
    v: 1,
    sessionId,
    keyEpoch,
    sender,
    counter,
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decryptEnvelope(envelope, key, nonceForDirectionFn) {
  const nonce = Buffer.from(nonceForDirectionFn(envelope.sender, envelope.counter));
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function base64UrlToBase64(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4 || 4)) % 4)}`;
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function base64ToBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createFakeBrowserRelayServer({
  buildTranscriptBytes,
  macEphemeral,
  macIdentity,
  nonceForDirection,
  scheduleTask,
}) {
  let bridgeOutboundSeq = 0;
  let clientHello = null;
  let macToPhoneKey = null;
  let phoneToMacKey = null;

  return {
    modelListRequestCount: 0,
    handleOutgoing(socket, rawMessage) {
      const parsed = JSON.parse(rawMessage);

      if (parsed.kind === "clientHello") {
        clientHello = parsed;
        const serverNonce = Buffer.alloc(32, 7);
        const transcriptBytes = Buffer.from(buildTranscriptBytes({
          sessionId: "session-1",
          protocolVersion: 1,
          handshakeMode: "qr_bootstrap",
          keyEpoch: 1,
          macDeviceId: "mac-1",
          phoneDeviceId: clientHello.phoneDeviceId,
          macIdentityPublicKey: macIdentity.publicKey,
          phoneIdentityPublicKey: clientHello.phoneIdentityPublicKey,
          macEphemeralPublicKey: macEphemeral.publicKey,
          phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey,
          clientNonce: Buffer.from(clientHello.clientNonce, "base64"),
          serverNonce,
          expiresAtForTranscript: 123,
        }));
        const macSignature = sign(
          null,
          transcriptBytes,
          createPrivateKey({
            key: {
              crv: "Ed25519",
              d: base64ToBase64Url(macIdentity.privateKey),
              kty: "OKP",
              x: base64ToBase64Url(macIdentity.publicKey),
            },
            format: "jwk",
          })
        );
        const sharedSecret = diffieHellman({
          privateKey: createPrivateKey({
            key: {
              crv: "X25519",
              d: base64ToBase64Url(macEphemeral.privateKey),
              kty: "OKP",
              x: base64ToBase64Url(macEphemeral.publicKey),
            },
            format: "jwk",
          }),
          publicKey: createPublicKey({
            key: {
              crv: "X25519",
              kty: "OKP",
              x: base64ToBase64Url(clientHello.phoneEphemeralPublicKey),
            },
            format: "jwk",
          }),
        });
        const salt = createHash("sha256").update(transcriptBytes).digest();
        const infoPrefix = `remodex-e2ee-v1|session-1|mac-1|${clientHello.phoneDeviceId}|1`;
        macToPhoneKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|macToPhone`, "utf8"), 32));
        phoneToMacKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|phoneToMac`, "utf8"), 32));

        socket.dispatch("message", {
          data: JSON.stringify({
            kind: "serverHello",
            protocolVersion: 1,
            sessionId: "session-1",
            handshakeMode: "qr_bootstrap",
            macDeviceId: "mac-1",
            macIdentityPublicKey: macIdentity.publicKey,
            macEphemeralPublicKey: macEphemeral.publicKey,
            serverNonce: serverNonce.toString("base64"),
            keyEpoch: 1,
            expiresAtForTranscript: 123,
            macSignature: macSignature.toString("base64"),
            clientNonce: clientHello.clientNonce,
          }),
        });
        return;
      }

      if (parsed.kind === "clientAuth") {
        scheduleTask(() => {
          socket.dispatch("message", {
            data: JSON.stringify({
              kind: "secureReady",
              sessionId: "session-1",
              keyEpoch: 1,
              macDeviceId: "mac-1",
            }),
          });
        }, 0);
        return;
      }

      if (parsed.kind !== "encryptedEnvelope") {
        return;
      }

      const outboundPayload = decryptEnvelope(parsed, phoneToMacKey, nonceForDirection);
      const rpcMessage = JSON.parse(outboundPayload.payloadText);

      if (rpcMessage.method === "initialize") {
        scheduleTask(() => {
          socket.dispatch("message", {
            data: JSON.stringify(encryptEnvelope(
              {
                bridgeOutboundSeq: ++bridgeOutboundSeq,
                payloadText: JSON.stringify({
                  id: rpcMessage.id,
                  result: { ok: true },
                }),
              },
              macToPhoneKey,
              "mac",
              0,
              "session-1",
              1,
              nonceForDirection
            )),
          });
        }, 0);
        return;
      }

      if (rpcMessage.method === "model/list") {
        this.modelListRequestCount += 1;
        socket.dispatch("message", {
          data: JSON.stringify(encryptEnvelope(
            {
              bridgeOutboundSeq: ++bridgeOutboundSeq,
              payloadText: JSON.stringify({
                id: rpcMessage.id,
                result: {
                  data: [
                    {
                      defaultReasoningEffort: "medium",
                      displayName: "GPT-5",
                      hidden: false,
                      isDefault: true,
                      model: "gpt-5",
                      supportedReasoningEfforts: [
                        {
                          description: "Balanced",
                          reasoningEffort: "medium",
                        },
                      ],
                    },
                  ],
                },
              }),
            },
            macToPhoneKey,
            "mac",
            1,
            "session-1",
            1,
            nonceForDirection
          )),
        });
      }
    },
  };
}

function handleInitialSessionMessage({
  buildTranscriptBytes,
  macEphemeral,
  macIdentity,
  nonceForDirection,
  parsed,
  socket,
}) {
  if (parsed.kind === "clientHello") {
    const clientHello = parsed;
    const serverNonce = Buffer.alloc(32, 7);
    const transcriptBytes = Buffer.from(buildTranscriptBytes({
      sessionId: "session-1",
      protocolVersion: 1,
      handshakeMode: "qr_bootstrap",
      keyEpoch: 1,
      macDeviceId: "mac-1",
      phoneDeviceId: clientHello.phoneDeviceId,
      macIdentityPublicKey: macIdentity.publicKey,
      phoneIdentityPublicKey: clientHello.phoneIdentityPublicKey,
      macEphemeralPublicKey: macEphemeral.publicKey,
      phoneEphemeralPublicKey: clientHello.phoneEphemeralPublicKey,
      clientNonce: Buffer.from(clientHello.clientNonce, "base64"),
      serverNonce,
      expiresAtForTranscript: 123,
    }));
    const macSignature = sign(
      null,
      transcriptBytes,
      createPrivateKey({
        key: {
          crv: "Ed25519",
          d: base64ToBase64Url(macIdentity.privateKey),
          kty: "OKP",
          x: base64ToBase64Url(macIdentity.publicKey),
        },
        format: "jwk",
      })
    );

    const sharedSecret = diffieHellman({
      privateKey: createPrivateKey({
        key: {
          crv: "X25519",
          d: base64ToBase64Url(macEphemeral.privateKey),
          kty: "OKP",
          x: base64ToBase64Url(macEphemeral.publicKey),
        },
        format: "jwk",
      }),
      publicKey: createPublicKey({
        key: {
          crv: "X25519",
          kty: "OKP",
          x: base64ToBase64Url(clientHello.phoneEphemeralPublicKey),
        },
        format: "jwk",
      }),
    });
    const salt = createHash("sha256").update(transcriptBytes).digest();
    const infoPrefix = `remodex-e2ee-v1|session-1|mac-1|${clientHello.phoneDeviceId}|1`;
    socket.macToPhoneKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|macToPhone`, "utf8"), 32));
    socket.phoneToMacKey = Buffer.from(hkdfSync("sha256", sharedSecret, salt, Buffer.from(`${infoPrefix}|phoneToMac`, "utf8"), 32));
    socket.bridgeOutboundSeq = 0;

    socket.dispatch("message", {
      data: JSON.stringify({
        kind: "serverHello",
        protocolVersion: 1,
        sessionId: "session-1",
        handshakeMode: "qr_bootstrap",
        macDeviceId: "mac-1",
        macIdentityPublicKey: macIdentity.publicKey,
        macEphemeralPublicKey: macEphemeral.publicKey,
        serverNonce: serverNonce.toString("base64"),
        keyEpoch: 1,
        expiresAtForTranscript: 123,
        macSignature: macSignature.toString("base64"),
        clientNonce: clientHello.clientNonce,
      }),
    });
    return;
  }

  if (parsed.kind === "clientAuth") {
    setTimeout(() => {
      socket.dispatch("message", {
        data: JSON.stringify({
          kind: "secureReady",
          sessionId: "session-1",
          keyEpoch: 1,
          macDeviceId: "mac-1",
        }),
      });
    }, 0);
    return;
  }

  if (parsed.kind !== "encryptedEnvelope") {
    return;
  }

  const outboundPayload = decryptEnvelope(parsed, socket.phoneToMacKey, nonceForDirection);
  const rpcMessage = JSON.parse(outboundPayload.payloadText);
  if (rpcMessage.method !== "initialize") {
    return;
  }

  socket.dispatch("message", {
    data: JSON.stringify(encryptEnvelope(
      {
        bridgeOutboundSeq: ++socket.bridgeOutboundSeq,
        payloadText: JSON.stringify({
          id: rpcMessage.id,
          result: { ok: true },
        }),
      },
      socket.macToPhoneKey,
      "mac",
      0,
      "session-1",
      1,
      nonceForDirection
    )),
  });
}
