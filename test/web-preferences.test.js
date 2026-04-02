// FILE: web-preferences.test.js
// Purpose: Verifies browser UI preferences honor performance-oriented glass defaults without overriding saved choices.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/preferences.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("loadPreferences honors a reduced-effects glass default when nothing is stored", async () => {
  const previousLocalStorage = globalThis.localStorage;
  globalThis.localStorage = createMemoryStorage();

  try {
    const { loadPreferences } = await import(`../web/modules/preferences.mjs?case=${Date.now()}`);
    const preferences = loadPreferences({
      accessOptions: ["On-Request"],
      defaultGlass: false,
      modelOptions: ["GPT-5.4"],
      reasoningOptions: ["Extra High"],
      speedOptions: ["Normal"],
    });

    assert.equal(preferences.glass, false);
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
});

test("loadPreferences keeps an explicit saved glass preference", async () => {
  const previousLocalStorage = globalThis.localStorage;
  const storage = createMemoryStorage();
  storage.setItem("remodex-web.preferences", JSON.stringify({ glass: true }));
  globalThis.localStorage = storage;

  try {
    const { loadPreferences } = await import(`../web/modules/preferences.mjs?case=saved-${Date.now()}`);
    const preferences = loadPreferences({
      accessOptions: ["On-Request"],
      defaultGlass: false,
      modelOptions: ["GPT-5.4"],
      reasoningOptions: ["Extra High"],
      speedOptions: ["Normal"],
    });

    assert.equal(preferences.glass, true);
  } finally {
    globalThis.localStorage = previousLocalStorage;
  }
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
