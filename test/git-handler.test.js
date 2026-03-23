// FILE: git-handler.test.js
// Purpose: Verifies worktree helper behavior added to the bridge git handler.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, node:fs, node:os, node:path, ../src/git-handler

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  __test: {
    normalizeCreatedBranchName,
    parseWorktreePathByBranch,
    resolveBaseBranchName,
    resolveWorktreeChangeTransfer,
  },
} = require("../src/git-handler");

test("normalizeCreatedBranchName prefixes remodex and sanitizes whitespace", () => {
  assert.equal(normalizeCreatedBranchName("feature / add chat panel"), "remodex/feature/add-chat-panel");
  assert.equal(normalizeCreatedBranchName("remodex/existing-branch"), "remodex/existing-branch");
});

test("resolveBaseBranchName and resolveWorktreeChangeTransfer use safe defaults", () => {
  assert.equal(resolveBaseBranchName("", "main"), "main");
  assert.equal(resolveBaseBranchName("develop", "main"), "develop");
  assert.equal(resolveWorktreeChangeTransfer("copy"), "copy");
  assert.equal(resolveWorktreeChangeTransfer("MOVE"), "move");
  assert.equal(resolveWorktreeChangeTransfer(""), "move");
});

test("parseWorktreePathByBranch scopes returned worktree paths to the active package path", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-worktree-map-"));
  const worktreeRoot = path.join(tempRoot, "abcd", "repo");
  const nestedPath = path.join(worktreeRoot, "packages", "app");
  fs.mkdirSync(nestedPath, { recursive: true });

  try {
    const parsed = parseWorktreePathByBranch(
      [
        `worktree ${worktreeRoot}`,
        "HEAD 0123456789abcdef",
        "branch refs/heads/remodex/feature-branch",
        "",
      ].join("\n"),
      {
        projectRelativePath: path.join("packages", "app"),
      }
    );

    assert.deepEqual(parsed, {
      "remodex/feature-branch": nestedPath,
    });
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
