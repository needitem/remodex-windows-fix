const DEVICE_STATE_STORAGE_KEY = "remodex-web.browser-device-state";
const HANDSHAKE_MODE_QR_BOOTSTRAP = "qr_bootstrap";
const HANDSHAKE_TAG = "remodex-e2ee-v1";
const SECURE_PROTOCOL_VERSION = 1;
const SECURE_SENDER_IPHONE = "iphone";
const SECURE_SENDER_MAC = "mac";

export function createBrowserSecureTransport({
  cryptoApi = globalThis.crypto,
  pairingPayload = null,
  storage = globalThis.localStorage,
  uuidFactory = () => cryptoApi.randomUUID?.() || `browser-${Date.now()}`,
} = {}) {
  let activeSession = null;
  let boundSendWireMessage = null;
  let currentPairingPayload = pairingPayload;
  let deviceStatePromise = null;
  let lastAppliedBridgeOutboundSeq = 0;
  let pendingHandshake = null;

  return {
    async ensureDeviceState() {
      if (!deviceStatePromise) {
        deviceStatePromise = loadOrCreateBrowserDeviceState({ cryptoApi, storage, uuidFactory });
      }
      return deviceStatePromise;
    },
    bindLiveSendWireMessage(sendWireMessage) {
      boundSendWireMessage = sendWireMessage;
    },
    disconnect() {
      activeSession = null;
      pendingHandshake = null;
    },
    getHandshakeSummary() {
      return {
        deviceStateReady: Boolean(deviceStatePromise),
        pairingSessionId: currentPairingPayload?.sessionId || null,
        status: activeSession?.isReady ? "ready" : pendingHandshake ? "handshaking" : "idle",
      };
    },
    isSecureChannelReady() {
      return Boolean(activeSession?.isReady);
    },
    async startHandshake(nextPairingPayload = currentPairingPayload) {
      currentPairingPayload = nextPairingPayload;
      const sendWireMessage = requireSendWireMessage(boundSendWireMessage);
      validatePairingPayload(currentPairingPayload);

      const deviceState = await this.ensureDeviceState();
      const clientNonce = randomBytes(cryptoApi, 32);
      const phoneEphemeralKeyPair = await cryptoApi.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
      const phoneEphemeralPublicJwk = await cryptoApi.subtle.exportKey("jwk", phoneEphemeralKeyPair.publicKey);
      const phoneEphemeralPrivateJwk = await cryptoApi.subtle.exportKey("jwk", phoneEphemeralKeyPair.privateKey);

      pendingHandshake = {
        clientNonce,
        handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
        phoneEphemeralPrivateJwk,
        phoneEphemeralPublicKey: base64UrlToBase64(phoneEphemeralPublicJwk.x),
      };

      sendWireMessage(JSON.stringify({
        kind: "clientHello",
        protocolVersion: SECURE_PROTOCOL_VERSION,
        sessionId: currentPairingPayload.sessionId,
        handshakeMode: HANDSHAKE_MODE_QR_BOOTSTRAP,
        phoneDeviceId: deviceState.phoneDeviceId,
        phoneIdentityPublicKey: deviceState.identityPublicKey,
        phoneEphemeralPublicKey: pendingHandshake.phoneEphemeralPublicKey,
        clientNonce: bytesToBase64(clientNonce),
      }));

      return {
        phoneDeviceId: deviceState.phoneDeviceId,
        trustedMacFingerprint: shortFingerprint(currentPairingPayload.macIdentityPublicKey),
      };
    },
    async handleWireMessage(rawMessage, {
      onApplicationMessage = () => {},
      onControlMessage = () => {},
      onReady = () => {},
    } = {}) {
      const parsed = safeParseJSON(rawMessage);
      if (!parsed || typeof parsed !== "object") {
        return false;
      }

      switch (parsed.kind) {
        case "encryptedEnvelope":
          await handleEncryptedEnvelope({ cryptoApi, message: parsed, onApplicationMessage, activeSessionRef: () => activeSession, updateLastAppliedBridgeOutboundSeq(value) { lastAppliedBridgeOutboundSeq = value; } });
          return true;
        case "secureError":
          onControlMessage(parsed);
          return true;
        case "secureReady":
          if (!activeSession || parsed.sessionId !== activeSession.sessionId || Number(parsed.keyEpoch) !== activeSession.keyEpoch) {
            onControlMessage({ kind: "secureError", code: "invalid_secure_ready", message: "The browser received a mismatched secureReady message." });
            return true;
          }
          activeSession.isReady = true;
          requireSendWireMessage(boundSendWireMessage)(JSON.stringify({
            kind: "resumeState",
            sessionId: activeSession.sessionId,
            keyEpoch: activeSession.keyEpoch,
            lastAppliedBridgeOutboundSeq,
          }));
          onReady({
            keyEpoch: activeSession.keyEpoch,
            phoneDeviceId: activeSession.phoneDeviceId,
            trustedMacFingerprint: activeSession.trustedMacFingerprint,
          });
          return true;
        case "serverHello":
          activeSession = await completeHandshake({
            cryptoApi,
            deviceState: await this.ensureDeviceState(),
            onControlMessage,
            pairingPayload: currentPairingPayload,
            pendingHandshake,
            serverHello: parsed,
            sendWireMessage: requireSendWireMessage(boundSendWireMessage),
          });
          pendingHandshake = null;
          return true;
        default:
          return false;
      }
    },
    async sendApplicationPayload(payloadText) {
      if (!activeSession?.isReady) {
        throw new Error("Secure channel is not ready yet.");
      }
      const envelope = await encryptEnvelopePayload({
        counter: activeSession.nextOutboundCounter,
        cryptoApi,
        key: activeSession.phoneToMacKey,
        keyEpoch: activeSession.keyEpoch,
        payloadObject: { payloadText },
        sender: SECURE_SENDER_IPHONE,
        sessionId: activeSession.sessionId,
      });
      activeSession.nextOutboundCounter += 1;
      requireSendWireMessage(boundSendWireMessage)(JSON.stringify(envelope));
    },
    updatePairingPayload(nextPairingPayload) {
      currentPairingPayload = nextPairingPayload;
    },
  };
}

export async function loadOrCreateBrowserDeviceState({ cryptoApi = globalThis.crypto, storage = globalThis.localStorage, uuidFactory } = {}) {
  const existingState = readStoredDeviceState(storage);
  if (existingState) {
    return existingState;
  }

  const keyPair = await cryptoApi.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const privateJwk = await cryptoApi.subtle.exportKey("jwk", keyPair.privateKey);
  const publicJwk = await cryptoApi.subtle.exportKey("jwk", keyPair.publicKey);
  const nextState = {
    identityPrivateJwk: privateJwk,
    identityPublicKey: base64UrlToBase64(publicJwk.x),
    phoneDeviceId: uuidFactory(),
    version: 1,
  };

  storage.setItem(DEVICE_STATE_STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export async function encryptEnvelopePayload({
  counter,
  cryptoApi = globalThis.crypto,
  key,
  keyEpoch,
  payloadObject,
  sender,
  sessionId,
}) {
  const nonce = nonceForDirection(sender, counter);
  const plaintext = new TextEncoder().encode(JSON.stringify(payloadObject));
  const encrypted = new Uint8Array(await cryptoApi.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    key,
    plaintext
  ));
  const tag = encrypted.slice(encrypted.length - 16);
  const ciphertext = encrypted.slice(0, encrypted.length - 16);

  return {
    kind: "encryptedEnvelope",
    v: SECURE_PROTOCOL_VERSION,
    sessionId,
    keyEpoch,
    sender,
    counter,
    ciphertext: bytesToBase64(ciphertext),
    tag: bytesToBase64(tag),
  };
}

export function nonceForDirection(sender, counter) {
  const nonce = new Uint8Array(12);
  nonce[0] = sender === SECURE_SENDER_MAC ? 1 : 2;
  let value = BigInt(counter);
  for (let index = 11; index >= 1; index -= 1) {
    nonce[index] = Number(value & 0xffn);
    value >>= 8n;
  }
  return nonce;
}

export function buildTranscriptBytes({
  clientNonce,
  expiresAtForTranscript,
  handshakeMode,
  keyEpoch,
  macDeviceId,
  macEphemeralPublicKey,
  macIdentityPublicKey,
  phoneDeviceId,
  phoneEphemeralPublicKey,
  phoneIdentityPublicKey,
  protocolVersion,
  serverNonce,
  sessionId,
}) {
  return concatBytes(
    encodeLengthPrefixedUTF8(HANDSHAKE_TAG),
    encodeLengthPrefixedUTF8(sessionId),
    encodeLengthPrefixedUTF8(String(protocolVersion)),
    encodeLengthPrefixedUTF8(handshakeMode),
    encodeLengthPrefixedUTF8(String(keyEpoch)),
    encodeLengthPrefixedUTF8(macDeviceId),
    encodeLengthPrefixedUTF8(phoneDeviceId),
    encodeLengthPrefixedBytes(base64ToBytes(macIdentityPublicKey)),
    encodeLengthPrefixedBytes(base64ToBytes(phoneIdentityPublicKey)),
    encodeLengthPrefixedBytes(base64ToBytes(macEphemeralPublicKey)),
    encodeLengthPrefixedBytes(base64ToBytes(phoneEphemeralPublicKey)),
    encodeLengthPrefixedBytes(clientNonce),
    encodeLengthPrefixedBytes(serverNonce),
    encodeLengthPrefixedUTF8(String(expiresAtForTranscript))
  );
}

async function completeHandshake({
  cryptoApi,
  deviceState,
  onControlMessage,
  pairingPayload,
  pendingHandshake,
  serverHello,
  sendWireMessage,
}) {
  if (!pendingHandshake) {
    throw new Error("The browser received serverHello without a pending clientHello.");
  }
  if (serverHello.sessionId !== pairingPayload.sessionId) {
    throw new Error("The relay session does not match the loaded pairing payload.");
  }
  if (serverHello.macDeviceId !== pairingPayload.macDeviceId || serverHello.macIdentityPublicKey !== pairingPayload.macIdentityPublicKey) {
    throw new Error("The serverHello bridge identity does not match the pairing payload.");
  }

  const transcriptBytes = buildTranscriptBytes({
    sessionId: pairingPayload.sessionId,
    protocolVersion: Number(serverHello.protocolVersion),
    handshakeMode: pendingHandshake.handshakeMode,
    keyEpoch: Number(serverHello.keyEpoch),
    macDeviceId: serverHello.macDeviceId,
    phoneDeviceId: deviceState.phoneDeviceId,
    macIdentityPublicKey: serverHello.macIdentityPublicKey,
    phoneIdentityPublicKey: deviceState.identityPublicKey,
    macEphemeralPublicKey: serverHello.macEphemeralPublicKey,
    phoneEphemeralPublicKey: pendingHandshake.phoneEphemeralPublicKey,
    clientNonce: pendingHandshake.clientNonce,
    serverNonce: base64ToBytes(serverHello.serverNonce),
    expiresAtForTranscript: Number(serverHello.expiresAtForTranscript) || 0,
  });

  const macIdentityKey = await importPublicOkpKey(cryptoApi, "Ed25519", serverHello.macIdentityPublicKey, ["verify"]);
  const macSignatureValid = await cryptoApi.subtle.verify(
    { name: "Ed25519" },
    macIdentityKey,
    base64ToBytes(serverHello.macSignature),
    transcriptBytes
  );
  if (!macSignatureValid) {
    onControlMessage({ kind: "secureError", code: "invalid_server_signature", message: "The browser could not verify the bridge signature." });
    throw new Error("The browser could not verify the bridge signature.");
  }

  const phoneIdentityPrivateKey = await cryptoApi.subtle.importKey(
    "jwk",
    deviceState.identityPrivateJwk,
    { name: "Ed25519" },
    false,
    ["sign"]
  );
  const phoneAuthTranscript = concatBytes(
    transcriptBytes,
    encodeLengthPrefixedUTF8("client-auth")
  );
  const phoneSignature = new Uint8Array(await cryptoApi.subtle.sign(
    { name: "Ed25519" },
    phoneIdentityPrivateKey,
    phoneAuthTranscript
  ));

  const phoneEphemeralPrivateKey = await cryptoApi.subtle.importKey(
    "jwk",
    pendingHandshake.phoneEphemeralPrivateJwk,
    { name: "X25519" },
    false,
    ["deriveBits"]
  );
  const macEphemeralPublicKey = await importPublicOkpKey(cryptoApi, "X25519", serverHello.macEphemeralPublicKey, []);
  const sharedSecret = new Uint8Array(await cryptoApi.subtle.deriveBits(
    { name: "X25519", public: macEphemeralPublicKey },
    phoneEphemeralPrivateKey,
    256
  ));
  const salt = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", transcriptBytes));
  const infoPrefix = `${HANDSHAKE_TAG}|${pairingPayload.sessionId}|${serverHello.macDeviceId}|${deviceState.phoneDeviceId}|${serverHello.keyEpoch}`;
  const phoneToMacKey = await deriveAesKey(cryptoApi, sharedSecret, salt, `${infoPrefix}|phoneToMac`);
  const macToPhoneKey = await deriveAesKey(cryptoApi, sharedSecret, salt, `${infoPrefix}|macToPhone`);

  sendWireMessage(JSON.stringify({
    kind: "clientAuth",
    sessionId: pairingPayload.sessionId,
    phoneDeviceId: deviceState.phoneDeviceId,
    keyEpoch: Number(serverHello.keyEpoch),
    phoneSignature: bytesToBase64(phoneSignature),
  }));

  return {
    isReady: false,
    keyEpoch: Number(serverHello.keyEpoch),
    lastInboundCounter: -1,
    macToPhoneKey,
    phoneDeviceId: deviceState.phoneDeviceId,
    phoneToMacKey,
    sessionId: pairingPayload.sessionId,
    nextOutboundCounter: 0,
    trustedMacFingerprint: shortFingerprint(serverHello.macIdentityPublicKey),
  };
}

async function handleEncryptedEnvelope({
  activeSessionRef,
  cryptoApi,
  message,
  onApplicationMessage,
  updateLastAppliedBridgeOutboundSeq,
}) {
  const activeSession = activeSessionRef();
  if (!activeSession?.isReady) {
    throw new Error("Secure channel is not ready yet.");
  }
  if (
    message.sessionId !== activeSession.sessionId
    || Number(message.keyEpoch) !== activeSession.keyEpoch
    || message.sender !== SECURE_SENDER_MAC
    || !Number.isInteger(Number(message.counter))
    || Number(message.counter) <= activeSession.lastInboundCounter
  ) {
    throw new Error("The browser rejected an invalid or replayed secure envelope.");
  }

  const nonce = nonceForDirection(SECURE_SENDER_MAC, Number(message.counter));
  const encrypted = concatBytes(base64ToBytes(message.ciphertext), base64ToBytes(message.tag));
  const plaintext = new Uint8Array(await cryptoApi.subtle.decrypt(
    { name: "AES-GCM", iv: nonce, tagLength: 128 },
    activeSession.macToPhoneKey,
    encrypted
  ));
  activeSession.lastInboundCounter = Number(message.counter);

  const payloadObject = safeParseJSON(new TextDecoder().decode(plaintext));
  if (Number.isInteger(payloadObject?.bridgeOutboundSeq)) {
    updateLastAppliedBridgeOutboundSeq(payloadObject.bridgeOutboundSeq);
  }
  if (typeof payloadObject?.payloadText === "string" && payloadObject.payloadText) {
    onApplicationMessage(payloadObject.payloadText);
  }
}

async function deriveAesKey(cryptoApi, sharedSecret, salt, infoString) {
  const hkdfBaseKey = await cryptoApi.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveBits"]);
  const rawKey = await cryptoApi.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: new TextEncoder().encode(infoString),
    },
    hkdfBaseKey,
    256
  );
  return cryptoApi.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function importPublicOkpKey(cryptoApi, curve, publicKeyBase64, usages) {
  return cryptoApi.subtle.importKey(
    "jwk",
    {
      crv: curve,
      kty: "OKP",
      x: base64ToBase64Url(publicKeyBase64),
    },
    { name: curve },
    false,
    usages
  );
}

function validatePairingPayload(pairingPayload) {
  if (!pairingPayload?.sessionId || !pairingPayload?.relay || !pairingPayload?.macDeviceId || !pairingPayload?.macIdentityPublicKey) {
    throw new Error("Pairing payload is incomplete for secure transport.");
  }
}

function readStoredDeviceState(storage) {
  try {
    const parsed = JSON.parse(storage.getItem(DEVICE_STATE_STORAGE_KEY) || "{}");
    if (
      typeof parsed.phoneDeviceId === "string"
      && parsed.phoneDeviceId.trim()
      && typeof parsed.identityPublicKey === "string"
      && parsed.identityPublicKey.trim()
      && parsed.identityPrivateJwk
    ) {
      return parsed;
    }
  } catch {}
  return null;
}

function randomBytes(cryptoApi, length) {
  const value = new Uint8Array(length);
  cryptoApi.getRandomValues(value);
  return value;
}

function encodeLengthPrefixedUTF8(value) {
  return encodeLengthPrefixedBytes(new TextEncoder().encode(String(value)));
}

function encodeLengthPrefixedBytes(bytes) {
  const lengthBuffer = new Uint8Array(4);
  new DataView(lengthBuffer.buffer).setUint32(0, bytes.length, false);
  return concatBytes(lengthBuffer, bytes);
}

function concatBytes(...arrays) {
  const totalLength = arrays.reduce((sum, bytes) => sum + bytes.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const bytes of arrays) {
    output.set(bytes, offset);
    offset += bytes.length;
  }
  return output;
}

function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlToBase64(value) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4 || 4)) % 4)}`;
  return padded.replace(/-/g, "+").replace(/_/g, "/");
}

function base64ToBase64Url(value) {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function requireSendWireMessage(sendWireMessage) {
  if (typeof sendWireMessage !== "function") {
    throw new Error("A live relay sender is required before the browser can pair.");
  }
  return sendWireMessage;
}

function shortFingerprint(value) {
  const normalized = String(value || "");
  return normalized ? `${normalized.slice(0, 10)}...${normalized.slice(-6)}` : "unknown";
}
