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
