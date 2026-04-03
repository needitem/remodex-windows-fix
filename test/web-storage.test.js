// FILE: web-storage.test.js
// Purpose: Verifies browser storage helpers compact oversized thread caches on load.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/storage.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("loadStoredThreadCache trims oversized message tails and restores derived flags", async () => {
  const originalLocalStorage = globalThis.localStorage;
  const storage = new Map();

  globalThis.localStorage = {
    getItem(key) {
      return storage.has(key) ? storage.get(key) : null;
    },
    setItem(key, value) {
      storage.set(key, String(value));
    },
    removeItem(key) {
      storage.delete(key);
    },
  };

  try {
    const oversizedMessages = Array.from({ length: 24 }, (_, index) => ({
      id: `msg-${index + 1}`,
      text: `message-${index + 1}`,
    }));
    storage.set(
      "remodex-web-deck.thread-cache",
      JSON.stringify({
        "thread-1": {
          loadedMessageLimit: 24,
          messages: oversizedMessages,
        },
      })
    );

    const { loadStoredThreadCache } = await import("../web/modules/storage.mjs");
    const cache = loadStoredThreadCache();

    assert.equal(cache["thread-1"].messages.length, 20);
    assert.equal(cache["thread-1"].messages[0].id, "msg-5");
    assert.equal(cache["thread-1"].hasEarlierMessages, true);
    assert.equal(cache["thread-1"].hasPendingTurn, false);
    assert.equal(cache["thread-1"].hasRichMessages, false);
    assert.equal(cache["thread-1"].loadedMessageLimit, 24);
  } finally {
    globalThis.localStorage = originalLocalStorage;
  }
});
