// FILE: web-thread-send.test.js
// Purpose: Verifies browser thread send helpers fork shared threads and keep runtime params on follow-up turns.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-send.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("shared thread sends should fork even if cached writable is true", async () => {
  const { shouldForkThreadForSend } = await import("../web/modules/thread-send.mjs");

  assert.equal(
    shouldForkThreadForSend(
      {
        threadId: "thread-1",
        writable: true,
      },
      "thread-1"
    ),
    true
  );
});

test("existing thread follow-up keeps runtime params instead of sending only threadId", async () => {
  const { buildTurnStartParams } = await import("../web/modules/thread-send.mjs");

  const params = buildTurnStartParams({
    chat: {
      access: "Workspace Write",
      cwd: "/repo",
      model: "gpt-5-codex",
      threadId: "thread-2",
    },
    text: "hello",
    preferences: {
      access: "Workspace Write",
      model: "gpt-5-codex",
      reasoning: "high",
    },
  });

  assert.deepEqual(params, {
    approvalPolicy: "never",
    cwd: "/repo",
    effort: "high",
    input: [{ text: "hello", type: "text" }],
    model: "gpt-5-codex",
    sandbox: "workspace-write",
    threadId: "thread-2",
  });
});
