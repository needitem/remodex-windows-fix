// FILE: web-thread-message-renderer.test.js
// Purpose: Verifies extracted browser message-renderer helpers summarize patches deterministically.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-message-renderer.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("patch renderer helpers summarize totals and list changed files", async () => {
  const {
    buildPatchPreview,
    summarizePatchForDisplay,
  } = await import("../web/modules/thread-message-renderer.mjs");

  const patch = [
    "diff --git a/src/bridge.js b/src/bridge.js",
    "--- a/src/bridge.js",
    "+++ b/src/bridge.js",
    "+const ready = true;",
    "-const ready = false;",
    "diff --git a/web/main.mjs b/web/main.mjs",
    "--- a/web/main.mjs",
    "+++ b/web/main.mjs",
    "+renderPlanCards();",
  ].join("\n");

  assert.equal(summarizePatchForDisplay(patch), "Changed 2 files | +2 -1");
  assert.equal(
    buildPatchPreview(patch),
    "- src/bridge.js\n- web/main.mjs"
  );
});
