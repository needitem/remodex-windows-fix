// FILE: web-thread-message-renderer.test.js
// Purpose: Verifies extracted browser message-renderer helpers summarize patches deterministically.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-message-renderer.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("patch renderer helpers summarize totals and list changed files", async () => {
  const {
    buildUnifiedDiffRows,
    buildPatchPreview,
    summarizePatchForDisplay,
  } = await import("../web/modules/thread-message-renderer.mjs");

  const patch = [
    "diff --git a/src/bridge.js b/src/bridge.js",
    "@@ -10,2 +10,3 @@",
    " const existing = true;",
    "-const ready = false;",
    "+const ready = true;",
    "+const online = true;",
    "--- a/src/bridge.js",
    "+++ b/src/bridge.js",
    "diff --git a/web/main.mjs b/web/main.mjs",
    "--- a/web/main.mjs",
    "+++ b/web/main.mjs",
    "+renderPlanCards();",
  ].join("\n");

  assert.equal(summarizePatchForDisplay(patch), "Changed 2 files | +3 -1");
  assert.equal(
    buildPatchPreview(patch),
    "- src/bridge.js\n- web/main.mjs"
  );

  assert.deepEqual(
    buildUnifiedDiffRows(patch).slice(1, 5).map((row) => ({
      newLineNumber: row.newLineNumber,
      oldLineNumber: row.oldLineNumber,
      prefix: row.prefix,
      text: row.text,
    })),
    [
      { oldLineNumber: "", newLineNumber: "", prefix: "@@", text: "@@ -10,2 +10,3 @@" },
      { oldLineNumber: "10", newLineNumber: "10", prefix: " ", text: "const existing = true;" },
      { oldLineNumber: "11", newLineNumber: "", prefix: "-", text: "const ready = false;" },
      { oldLineNumber: "", newLineNumber: "11", prefix: "+", text: "const ready = true;" },
    ]
  );
});
