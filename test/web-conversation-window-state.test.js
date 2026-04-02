// FILE: web-conversation-window-state.test.js
// Purpose: Verifies long conversation windowing keeps the default view focused on recent messages and expands older history in chunks.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/conversation-window-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("resolveConversationWindowState defaults to the latest message slice for long threads", async () => {
  const {
    DEFAULT_VISIBLE_MESSAGE_COUNT,
    resolveConversationWindowState,
  } = await import("../web/modules/conversation-window-state.mjs");

  const windowState = resolveConversationWindowState({
    totalMessages: DEFAULT_VISIBLE_MESSAGE_COUNT + 35,
  });

  assert.equal(windowState.mode, "tail");
  assert.equal(windowState.hiddenCount, 35);
  assert.equal(windowState.visibleCount, DEFAULT_VISIBLE_MESSAGE_COUNT);
});

test("resolveConversationWindowState honors an anchored older-message start index", async () => {
  const { resolveConversationWindowState } = await import("../web/modules/conversation-window-state.mjs");

  const windowState = resolveConversationWindowState({
    requestedStartIndex: 40,
    totalMessages: 210,
  });

  assert.equal(windowState.mode, "anchored");
  assert.equal(windowState.startIndex, 40);
  assert.equal(windowState.hiddenCount, 40);
  assert.equal(windowState.visibleCount, 170);
});

test("expandConversationWindow reveals older messages in fixed-size chunks", async () => {
  const {
    DEFAULT_VISIBLE_MESSAGE_COUNT,
    MESSAGE_WINDOW_EXPAND_STEP,
    expandConversationWindow,
  } = await import("../web/modules/conversation-window-state.mjs");

  const nextStartIndex = expandConversationWindow({
    totalMessages: DEFAULT_VISIBLE_MESSAGE_COUNT + MESSAGE_WINDOW_EXPAND_STEP + 25,
  });

  assert.equal(nextStartIndex, 25);
});

test("expandConversationWindow stops at the beginning of the thread", async () => {
  const { expandConversationWindow } = await import("../web/modules/conversation-window-state.mjs");

  const nextStartIndex = expandConversationWindow({
    requestedStartIndex: 30,
    totalMessages: 120,
  });

  assert.equal(nextStartIndex, 0);
});
