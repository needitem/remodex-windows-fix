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
  sanitizeThreadHistoryImagesForRelay,
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

test("sanitizeThreadHistoryImagesForRelay replaces inline history images with lightweight references", () => {
  const rawMessage = JSON.stringify({
    id: "req-thread-read",
    result: {
      thread: {
        id: "thread-images",
        turns: [
          {
            id: "turn-1",
            items: [
              {
                id: "item-user",
                type: "user_message",
                content: [
                  {
                    type: "input_text",
                    text: "Look at this screenshot",
                  },
                  {
                    type: "image",
                    image_url: "data:image/png;base64,AAAA",
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  });

  const sanitized = JSON.parse(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "thread/read")
  );
  const content = sanitized.result.thread.turns[0].items[0].content;

  assert.deepEqual(content[0], {
    type: "input_text",
    text: "Look at this screenshot",
  });
  assert.deepEqual(content[1], {
    type: "image",
    url: "remodex://history-image-elided",
  });
});

test("sanitizeThreadHistoryImagesForRelay leaves unrelated RPC payloads unchanged", () => {
  const rawMessage = JSON.stringify({
    id: "req-other",
    result: {
      ok: true,
    },
  });

  assert.equal(
    sanitizeThreadHistoryImagesForRelay(rawMessage, "turn/start"),
    rawMessage
  );
});
