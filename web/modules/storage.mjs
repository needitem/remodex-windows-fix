const PAIRING_STORAGE_KEY = "remodex-web-deck.pairing-payload";
const RELAY_OVERRIDE_KEY = "remodex-web-deck.relay-override";
const CLIENT_NOTE_STORAGE_KEY = "remodex-web-deck.client-note";
const THREAD_CACHE_STORAGE_KEY = "remodex-web-deck.thread-cache";
const LAST_THREAD_STORAGE_KEY = "remodex-web.last-thread-id";

export const DEFAULT_PERSISTED_CLIENT_NOTE = "hello from web client";

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

export function loadStoredClientNote() {
  return safeLocalStorageGet(CLIENT_NOTE_STORAGE_KEY) || "";
}

export function saveStoredClientNote(value) {
  if (typeof value !== "string") {
    safeLocalStorageRemove(CLIENT_NOTE_STORAGE_KEY);
    return;
  }

  safeLocalStorageSet(CLIENT_NOTE_STORAGE_KEY, value);
}

export function loadStoredThreadCache() {
  const rawValue = safeLocalStorageGet(THREAD_CACHE_STORAGE_KEY);
  if (!rawValue) {
    return {};
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return {};
  }
}

export function saveStoredThreadCache(value) {
  safeLocalStorageSet(THREAD_CACHE_STORAGE_KEY, JSON.stringify(value || {}));
}

export function loadStoredLastThreadId() {
  return safeLocalStorageGet(LAST_THREAD_STORAGE_KEY) || null;
}

export function saveStoredLastThreadId(threadId) {
  if (!threadId) {
    safeLocalStorageRemove(LAST_THREAD_STORAGE_KEY);
    return;
  }

  safeLocalStorageSet(LAST_THREAD_STORAGE_KEY, threadId);
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
