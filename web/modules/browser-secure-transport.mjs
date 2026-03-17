const DEVICE_STATE_STORAGE_KEY = "remodex-web.browser-device-state";

export function prepareBrowserSecureTransport({
  pairingPayload,
  storage = globalThis.localStorage,
  uuidFactory = () => globalThis.crypto?.randomUUID?.() || `browser-${Date.now()}`,
} = {}) {
  const deviceState = loadOrCreateBrowserDeviceState(storage, uuidFactory);
  return {
    deviceState,
    handshake: pairingPayload
      ? buildBrowserHandshakeScaffold(pairingPayload, deviceState)
      : null,
  };
}

export function loadOrCreateBrowserDeviceState(storage, uuidFactory) {
  try {
    const parsed = JSON.parse(storage.getItem(DEVICE_STATE_STORAGE_KEY) || "{}");
    if (typeof parsed.phoneDeviceId === "string" && parsed.phoneDeviceId.trim()) {
      return parsed;
    }
  } catch {}

  const nextState = {
    phoneDeviceId: uuidFactory(),
    version: 1,
  };
  storage.setItem(DEVICE_STATE_STORAGE_KEY, JSON.stringify(nextState));
  return nextState;
}

export function buildBrowserHandshakeScaffold(pairingPayload, deviceState) {
  if (!pairingPayload?.sessionId || !pairingPayload?.relay || !pairingPayload?.macDeviceId) {
    throw new Error("Pairing payload is incomplete for browser secure transport scaffolding.");
  }
  if (!deviceState?.phoneDeviceId) {
    throw new Error("Browser device state is missing phoneDeviceId.");
  }

  return {
    handshakeMode: "qr_bootstrap",
    kind: "clientHello",
    macDeviceId: pairingPayload.macDeviceId,
    protocolVersion: 1,
    relay: pairingPayload.relay,
    sessionId: pairingPayload.sessionId,
    status: "pending-browser-crypto",
    trustedMacFingerprint: shortFingerprint(pairingPayload.macIdentityPublicKey || ""),
    phoneDeviceId: deviceState.phoneDeviceId,
  };
}

function shortFingerprint(value) {
  const normalized = String(value || "");
  if (!normalized) {
    return "unknown";
  }
  return `${normalized.slice(0, 10)}...${normalized.slice(-6)}`;
}
