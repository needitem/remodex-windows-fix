// FILE: web-thread-command-state.test.js
// Purpose: Verifies browser command-message helpers keep command thread state consistent.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-command-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("applyExecCommandBegin creates a running command message once", async () => {
  const { applyExecCommandBegin } = await import("../web/modules/thread-command-state.mjs");
  const chat = { messages: [] };

  assert.equal(applyExecCommandBegin(chat, {
    call_id: "call-1",
    command: "git status",
  }, {
    messageOrigin: "web",
  }), true);

  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].summary, "Run git");
  assert.equal(chat.messages[0].origin, "web");

  applyExecCommandBegin(chat, {
    call_id: "call-1",
    command: "git status",
  }, {
    messageOrigin: "web",
  });

  assert.equal(chat.messages.length, 1);
});

test("applyExecCommandOutput and applyExecCommandEnd accumulate and normalize output", async () => {
  const {
    applyExecCommandOutput,
    applyExecCommandEnd,
    buildCommandRawContent,
  } = await import("../web/modules/thread-command-state.mjs");
  const chat = { messages: [] };

  assert.equal(applyExecCommandOutput(chat, {
    call_id: "call-2",
    command: "git status",
    chunk: "On branch main",
  }, {
    messageOrigin: "desktop",
  }), true);

  assert.equal(chat.messages.length, 1);
  assert.match(chat.messages[0].preview, /On branch main/);

  assert.equal(applyExecCommandEnd(chat, {
    call_id: "call-2",
    command: "git status",
    output: "Output:\nOn branch main\nnothing to commit\nExit code: 0",
  }, {
    messageOrigin: "desktop",
  }), true);

  assert.equal(chat.messages[0].time, "completed");
  assert.match(chat.messages[0].rawOutput, /nothing to commit/);
  assert.match(buildCommandRawContent(chat.messages[0]), /git status/);
});
