const PAIRING_STORAGE_KEY = "remodex-web-deck.pairing-payload";
const RELAY_OVERRIDE_KEY = "remodex-web-deck.relay-override";

export function loadStoredPairingPayload() {
  const rawValue = safeLocalStorageGet(PAIRING_STORAGE_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

export function saveStoredPairingPayload(payload) {
  safeLocalStorageSet(PAIRING_STORAGE_KEY, JSON.stringify(payload));
}

export function clearStoredPairingPayload() {
  safeLocalStorageRemove(PAIRING_STORAGE_KEY);
}

export function loadStoredRelayOverride() {
  return safeLocalStorageGet(RELAY_OVERRIDE_KEY) || "";
}

export function saveStoredRelayOverride(value) {
  if (typeof value !== "string" || !value.trim()) {
    safeLocalStorageRemove(RELAY_OVERRIDE_KEY);
    return;
  }

  safeLocalStorageSet(RELAY_OVERRIDE_KEY, value.trim());
}

function safeLocalStorageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key) || "";
  } catch {
    return "";
  }
}

function safeLocalStorageSet(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {}
}

function safeLocalStorageRemove(key) {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {}
}
