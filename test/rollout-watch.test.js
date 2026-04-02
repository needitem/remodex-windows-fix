// FILE: rollout-watch.test.js
// Purpose: Verifies rollout token parsing prefers last-turn usage over cumulative session totals.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/rollout-watch

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { setTimeout: wait } = require("node:timers/promises");

const {
  contextUsageFromTokenCountPayload,
  createThreadRolloutActivityWatcher,
  readLatestContextWindowUsage,
  readLatestThreadPatch,
} = require("../src/rollout-watch");

test("contextUsageFromTokenCountPayload prefers last_token_usage totals", () => {
  const usage = contextUsageFromTokenCountPayload({
    info: {
      total_token_usage: {
        total_tokens: 123_884_753,
      },
      last_token_usage: {
        total_tokens: 200_930,
      },
      model_context_window: 258_400,
    },
  });

  assert.deepEqual(usage, {
    tokensUsed: 200_930,
    tokenLimit: 258_400,
  });
});

test("watcher falls back to the thread-scoped rollout when turn id is unavailable", async (t) => {
  const { homeDir, threadDir } = makeTemporarySessionsHome();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  writeRolloutFile(path.join(threadDir, "rollout-2026-03-05T13-23-27-thread-a.jsonl"), {
    turnId: "turn-a",
    tokensUsed: 111,
    tokenLimit: 1_000,
  });
  writeRolloutFile(path.join(threadDir, "rollout-2026-03-05T13-25-27-thread-b.jsonl"), {
    turnId: "turn-b",
    tokensUsed: 999,
    tokenLimit: 1_000,
  });

  const usages = [];
  const watcher = createThreadRolloutActivityWatcher({
    threadId: "thread-a",
    intervalMs: 5,
    lookupTimeoutMs: 100,
    idleTimeoutMs: 100,
    onUsage: ({ usage }) => usages.push(usage),
  });

  await wait(30);
  watcher.stop();

  assert.deepEqual(usages[0], {
    tokensUsed: 111,
    tokenLimit: 1_000,
  });
});

test("readLatestContextWindowUsage prefers the thread-scoped rollout over newer unrelated files", (t) => {
  const { homeDir, threadDir } = makeTemporarySessionsHome();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  writeRolloutFile(path.join(threadDir, "rollout-2026-03-05T13-23-27-thread-a.jsonl"), {
    turnId: "turn-a",
    tokensUsed: 222,
    tokenLimit: 1_000,
  });
  writeRolloutFile(path.join(threadDir, "rollout-2026-03-05T13-25-27-thread-b.jsonl"), {
    turnId: "turn-b",
    tokensUsed: 999,
    tokenLimit: 1_000,
  });

  const result = readLatestContextWindowUsage({ threadId: "thread-a" });
  assert.deepEqual(result?.usage, {
    tokensUsed: 222,
    tokenLimit: 1_000,
  });
  assert.match(result?.rolloutPath ?? "", /thread-a\.jsonl$/);
});

test("readLatestContextWindowUsage returns null when no rollout matches the requested thread", (t) => {
  const { homeDir, threadDir } = makeTemporarySessionsHome();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  writeRolloutFile(path.join(threadDir, "rollout-2026-03-05T13-25-27-thread-b.jsonl"), {
    turnId: "turn-b",
    tokensUsed: 999,
    tokenLimit: 1_000,
  });

  const result = readLatestContextWindowUsage({ threadId: "missing-thread" });
  assert.equal(result, null);
});

test("readLatestContextWindowUsage prefers the newest matching rollout when multiple files share a thread id", (t) => {
  const { homeDir, threadDir } = makeTemporarySessionsHome();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const olderFile = path.join(threadDir, "rollout-2026-03-05T13-23-27-thread-a.jsonl");
  const newerFile = path.join(threadDir, "rollout-2026-03-05T13-29-27-thread-a.jsonl");

  writeRolloutFile(olderFile, {
    turnId: "turn-a-1",
    tokensUsed: 111,
    tokenLimit: 1_000,
  });
  writeRolloutFile(newerFile, {
    turnId: "turn-a-2",
    tokensUsed: 333,
    tokenLimit: 1_000,
  });

  fs.utimesSync(olderFile, new Date("2026-03-05T13:23:27Z"), new Date("2026-03-05T13:23:27Z"));
  fs.utimesSync(newerFile, new Date("2026-03-05T13:29:27Z"), new Date("2026-03-05T13:29:27Z"));

  const result = readLatestContextWindowUsage({ threadId: "thread-a" });
  assert.deepEqual(result?.usage, {
    tokensUsed: 333,
    tokenLimit: 1_000,
  });
  assert.match(result?.rolloutPath ?? "", /13-29-27-thread-a\.jsonl$/);
});

test("readLatestThreadPatch returns the newest apply_patch payload for the requested thread", (t) => {
  const { homeDir, threadDir } = makeTemporarySessionsHome();
  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = homeDir;
  t.after(() => {
    restoreCodexHome(previousCodexHome);
    fs.rmSync(homeDir, { recursive: true, force: true });
  });

  const olderFile = path.join(threadDir, "rollout-2026-03-05T13-23-27-thread-a.jsonl");
  const newerFile = path.join(threadDir, "rollout-2026-03-05T13-29-27-thread-a.jsonl");

  writePatchRolloutFile(olderFile, {
    patch: "*** Begin Patch\n*** Add File: old.txt\n+old\n*** End Patch\n",
    turnId: "turn-a-1",
  });
  writePatchRolloutFile(newerFile, {
    patch: "*** Begin Patch\n*** Add File: new.txt\n+new\n*** End Patch\n",
    turnId: "turn-a-2",
  });

  fs.utimesSync(olderFile, new Date("2026-03-05T13:23:27Z"), new Date("2026-03-05T13:23:27Z"));
  fs.utimesSync(newerFile, new Date("2026-03-05T13:29:27Z"), new Date("2026-03-05T13:29:27Z"));

  const result = readLatestThreadPatch({ threadId: "thread-a" });
  assert.equal(result?.turnId, "turn-a-2");
  assert.match(result?.patch ?? "", /\*\*\* Add File: new\.txt/);
  assert.match(result?.displayPatch ?? "", /^diff --git a\/new\.txt b\/new\.txt/m);
  assert.match(result?.displayPatch ?? "", /^@@ -0,0 \+1 @@$/m);
  assert.match(result?.rolloutPath ?? "", /13-29-27-thread-a\.jsonl$/);
});

function makeTemporarySessionsHome() {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "rollout-watch-"));
  const threadDir = path.join(homeDir, "sessions", "2026", "03", "12");
  fs.mkdirSync(threadDir, { recursive: true });
  return { homeDir, threadDir };
}

function writeRolloutFile(filePath, { turnId, tokensUsed, tokenLimit }) {
  const lines = [
    JSON.stringify({
      timestamp: "2026-03-05T13:23:27.971Z",
      type: "event_msg",
      payload: {
        type: "task_started",
        turn_id: turnId,
        model_context_window: tokenLimit,
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-05T13:23:29.357Z",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          last_token_usage: {
            total_tokens: tokensUsed,
          },
          model_context_window: tokenLimit,
        },
      },
    }),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

function writePatchRolloutFile(filePath, { turnId, patch }) {
  const lines = [
    JSON.stringify({
      timestamp: "2026-03-05T13:23:27.971Z",
      type: "turn_context",
      payload: {
        turn_id: turnId,
      },
    }),
    JSON.stringify({
      timestamp: "2026-03-05T13:23:29.357Z",
      type: "response_item",
      payload: {
        type: "custom_tool_call",
        name: "apply_patch",
        input: patch,
      },
    }),
    "",
  ];
  fs.writeFileSync(filePath, lines.join("\n"));
}

function restoreCodexHome(previousCodexHome) {
  if (previousCodexHome == null) {
    delete process.env.CODEX_HOME;
    return;
  }
  process.env.CODEX_HOME = previousCodexHome;
}
