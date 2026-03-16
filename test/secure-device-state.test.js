// FILE: secure-device-state.test.js
// Purpose: Verifies bridge device state persists a stable relay session id across launches.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, child_process, fs, os, path

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("loadOrCreateBridgeDeviceState persists relaySessionId and resolveBridgeRelaySession reuses it", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-device-state-"));
  const stateFile = path.join(tempDir, "device-state.json");
  const keychainMockFile = path.join(tempDir, "keychain.json");

  const previousEnv = {
    REMODEX_DEVICE_STATE_DIR: process.env.REMODEX_DEVICE_STATE_DIR,
    REMODEX_DEVICE_STATE_FILE: process.env.REMODEX_DEVICE_STATE_FILE,
    REMODEX_DEVICE_STATE_KEYCHAIN_MOCK_FILE: process.env.REMODEX_DEVICE_STATE_KEYCHAIN_MOCK_FILE,
  };

  process.env.REMODEX_DEVICE_STATE_DIR = tempDir;
  process.env.REMODEX_DEVICE_STATE_FILE = stateFile;
  process.env.REMODEX_DEVICE_STATE_KEYCHAIN_MOCK_FILE = keychainMockFile;

  try {
    delete require.cache[require.resolve("../src/secure-device-state")];
    const {
      loadOrCreateBridgeDeviceState,
      resolveBridgeRelaySession,
    } = require("../src/secure-device-state");

    const firstState = loadOrCreateBridgeDeviceState();
    assert.match(firstState.relaySessionId, /^[0-9a-f-]{36}$/i);

    const firstSession = resolveBridgeRelaySession(firstState);
    const secondSession = resolveBridgeRelaySession(firstState);

    assert.equal(firstSession.isPersistent, true);
    assert.equal(firstSession.sessionId, firstState.relaySessionId);
    assert.equal(secondSession.sessionId, firstState.relaySessionId);

    delete require.cache[require.resolve("../src/secure-device-state")];
    const reloadedModule = require("../src/secure-device-state");
    const reloadedState = reloadedModule.loadOrCreateBridgeDeviceState();
    const reloadedSession = reloadedModule.resolveBridgeRelaySession(reloadedState);

    assert.equal(reloadedState.relaySessionId, firstState.relaySessionId);
    assert.equal(reloadedSession.sessionId, firstState.relaySessionId);
  } finally {
    restoreEnv(previousEnv);
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete require.cache[require.resolve("../src/secure-device-state")];
  }
});

function restoreEnv(previousEnv) {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value == null) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
