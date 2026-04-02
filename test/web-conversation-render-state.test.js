// FILE: web-conversation-render-state.test.js
// Purpose: Verifies scroll heuristics and render-key generation for the web conversation view.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/conversation-render-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("buildMessageRenderKey changes when visible message content changes", async () => {
  const { buildMessageRenderKey } = await import("../web/modules/conversation-render-state.mjs");

  const baseMessage = {
    author: "Codex",
    id: "msg-1",
    role: "assistant",
    text: "First answer",
    time: "completed",
  };

  assert.notEqual(
    buildMessageRenderKey(baseMessage),
    buildMessageRenderKey({ ...baseMessage, text: "Updated answer" })
  );
});

test("isScrolledNearBottom only returns true near the bottom edge", async () => {
  const { isScrolledNearBottom } = await import("../web/modules/conversation-render-state.mjs");

  assert.equal(isScrolledNearBottom({
    clientHeight: 600,
    scrollHeight: 1_200,
    scrollTop: 540,
  }), true);

  assert.equal(isScrolledNearBottom({
    clientHeight: 600,
    scrollHeight: 1_200,
    scrollTop: 320,
  }), false);
});

test("shouldAutoScrollMessageList respects viewport position and selected thread changes", async () => {
  const { shouldAutoScrollMessageList } = await import("../web/modules/conversation-render-state.mjs");

  assert.equal(shouldAutoScrollMessageList({
    nextLastMessageId: "msg-2",
    nextLastRenderKey: "b",
    nextMessageCount: 2,
    previousLastMessageId: "msg-1",
    previousLastRenderKey: "a",
    previousMessageCount: 1,
    selectedChatChanged: true,
    wasNearBottom: false,
  }), true);

  assert.equal(shouldAutoScrollMessageList({
    nextLastMessageId: "msg-2",
    nextLastRenderKey: "b",
    nextMessageCount: 2,
    previousLastMessageId: "msg-1",
    previousLastRenderKey: "a",
    previousMessageCount: 1,
    selectedChatChanged: false,
    wasNearBottom: false,
  }), false);

  assert.equal(shouldAutoScrollMessageList({
    nextLastMessageId: "msg-1",
    nextLastRenderKey: "b",
    nextMessageCount: 1,
    previousLastMessageId: "msg-1",
    previousLastRenderKey: "a",
    previousMessageCount: 1,
    selectedChatChanged: false,
    wasNearBottom: true,
  }), true);
});
