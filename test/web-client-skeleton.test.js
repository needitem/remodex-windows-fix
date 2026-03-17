// FILE: web-client-skeleton.test.js
// Purpose: Verifies the browser client skeleton assets and URL helpers stay wired correctly.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/web-client-static

const test = require("node:test");
const assert = require("node:assert/strict");

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

test("browser secure transport scaffold persists a stable browser device id and derives handshake metadata", async () => {
  const storage = createMemoryStorage();
  const {
    prepareBrowserSecureTransport,
  } = await import("../web/modules/browser-secure-transport.mjs");

  const first = prepareBrowserSecureTransport({
    pairingPayload: {
      sessionId: "session-1",
      relay: "wss://relay.example/relay",
      macDeviceId: "mac-1",
      macIdentityPublicKey: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    },
    storage,
    uuidFactory: () => "browser-device-1",
  });
  const second = prepareBrowserSecureTransport({ storage, uuidFactory: () => "browser-device-2" });

  assert.equal(first.deviceState.phoneDeviceId, "browser-device-1");
  assert.equal(second.deviceState.phoneDeviceId, "browser-device-1");
  assert.equal(first.handshake.sessionId, "session-1");
  assert.equal(first.handshake.trustedMacFingerprint, "ABCDEFGHIJ...UVWXYZ");
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
