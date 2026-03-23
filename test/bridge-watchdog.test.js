// FILE: bridge-watchdog.test.js
// Purpose: Verifies relay stale-connection helpers exposed by the bridge.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/bridge

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  buildHeartbeatBridgeStatus,
  hasRelayConnectionGoneStale,
} = require("../src/bridge");

test("hasRelayConnectionGoneStale returns true only after the configured stale window", () => {
  assert.equal(
    hasRelayConnectionGoneStale(1_000, { now: 25_999, staleAfterMs: 25_000 }),
    false
  );
  assert.equal(
    hasRelayConnectionGoneStale(1_000, { now: 26_000, staleAfterMs: 25_000 }),
    true
  );
});

test("buildHeartbeatBridgeStatus downgrades stale connected snapshots", () => {
  const status = buildHeartbeatBridgeStatus(
    {
      state: "running",
      connectionStatus: "connected",
      lastError: "",
    },
    1_000,
    {
      now: 30_000,
      staleAfterMs: 25_000,
      staleMessage: "stale relay",
    }
  );

  assert.deepEqual(status, {
    state: "running",
    connectionStatus: "disconnected",
    lastError: "stale relay",
  });
});

test("buildHeartbeatBridgeStatus leaves non-connected snapshots untouched", () => {
  const status = {
    state: "running",
    connectionStatus: "connecting",
    lastError: "",
  };

  assert.equal(buildHeartbeatBridgeStatus(status, 0, { now: 30_000 }), status);
});
