// FILE: web-thread-message-state.test.js
// Purpose: Verifies browser thread message helpers extract and merge thread content deterministically.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-message-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("extractMessagesFromThread builds command previews and idle fallback", async () => {
  const { extractMessagesFromThread } = await import("../web/modules/thread-message-state.mjs");

  const thread = {
    id: "thread-1",
    turns: [
      {
        id: "turn-1",
        status: "completed",
        items: [
          {
            id: "user-1",
            type: "userMessage",
            content: [{ type: "text", text: "hello" }],
          },
          {
            id: "cmd-1",
            type: "commandExecution",
            command: "git status",
            output: "Output:\nOn branch main\nnothing to commit\nExit code: 0",
            status: "completed",
          },
        ],
      },
    ],
  };

  const messages = extractMessagesFromThread(thread);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, "hello");
  assert.equal(messages[1].summary, "Run git");
  assert.match(messages[1].preview, /On branch main/);
});

test("mergeMessagesWithCache preserves cached origin while updating server command content", async () => {
  const { mergeMessagesWithCache } = await import("../web/modules/thread-message-state.mjs");

  const merged = mergeMessagesWithCache({
    threadId: "thread-1",
    cachedMessages: [
      {
        id: "cmd-1",
        kind: "command",
        origin: "web",
        command: "git status",
        rawOutput: "Running",
        preview: "Running...",
      },
    ],
    serverMessages: [
      {
        id: "cmd-1",
        kind: "command",
        command: "git status",
        rawOutput: "On branch main",
        preview: "On branch main",
      },
    ],
  });

  assert.equal(merged.length, 1);
  assert.equal(merged[0].origin, "web");
  assert.equal(merged[0].rawOutput, "On branch main");
  assert.equal(merged[0].preview, "On branch main");
});

test("extractMessagesFromThread restores plan messages with normalized step status", async () => {
  const { extractMessagesFromThread } = await import("../web/modules/thread-message-state.mjs");

  const thread = {
    id: "thread-plan",
    turns: [
      {
        id: "turn-plan",
        status: "completed",
        items: [
          {
            id: "plan-1",
            type: "plan",
            explanation: "Ship the safest slice first.",
            plan: [
              { step: "Audit the current flow", status: "completed" },
              { step: "Implement the web prompt cards", status: "in_progress" },
            ],
            content: [
              { type: "text", text: "1. Audit\n2. Implement" },
            ],
          },
        ],
      },
    ],
  };

  const messages = extractMessagesFromThread(thread);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].kind, "plan");
  assert.equal(messages[0].text, "1. Audit\n2. Implement");
  assert.equal(messages[0].planState.explanation, "Ship the safest slice first.");
  assert.deepEqual(
    messages[0].planState.steps,
    [
      { step: "Audit the current flow", status: "completed" },
      { step: "Implement the web prompt cards", status: "completed" },
    ]
  );
});
