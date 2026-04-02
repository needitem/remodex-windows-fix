// FILE: apply-patch-display.test.js
// Purpose: Verifies apply_patch payloads can be rendered as numbered diffs for the web client.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, node:fs, node:os, node:path, ../src/apply-patch-display

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDisplayPatchFromApplyPatch } = require("../src/apply-patch-display");

test("buildDisplayPatchFromApplyPatch converts updated files into numbered unified hunks", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "apply-patch-display-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const filePath = path.join(tempDir, "notes.txt");
  fs.writeFileSync(filePath, ["one", "TWO", "three", "three point five", "four", ""].join("\n"));

  const patch = [
    "*** Begin Patch",
    `*** Update File: ${filePath}`,
    "@@",
    " one",
    "-two",
    "+TWO",
    " three",
    "+three point five",
    "*** End Patch",
    "",
  ].join("\n");

  const rendered = buildDisplayPatchFromApplyPatch(patch, {
    cwd: tempDir,
    fsModule: fs,
  });

  assert.equal(
    rendered,
    [
      "diff --git a/notes.txt b/notes.txt",
      "--- a/notes.txt",
      "+++ b/notes.txt",
      "@@ -1,3 +1,4 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      "+three point five",
    ].join("\n")
  );
});

test("buildDisplayPatchFromApplyPatch converts added files into a numbered diff", () => {
  const patch = [
    "*** Begin Patch",
    "*** Add File: web/modules/example.mjs",
    "+export const answer = 42;",
    "+",
    "*** End Patch",
    "",
  ].join("\n");

  const rendered = buildDisplayPatchFromApplyPatch(patch, {
    cwd: "D:/my/remodex-windows-fix",
    fsModule: fs,
  });

  assert.equal(
    rendered,
    [
      "diff --git a/web/modules/example.mjs b/web/modules/example.mjs",
      "--- /dev/null",
      "+++ b/web/modules/example.mjs",
      "@@ -0,0 +1,2 @@",
      "+export const answer = 42;",
      "+",
    ].join("\n")
  );
});
