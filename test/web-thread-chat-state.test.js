// FILE: web-thread-chat-state.test.js
// Purpose: Verifies browser chat hydration keeps only the recent tail and restores derived chat metadata.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-chat-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("hydrateChatFromThread keeps a limited tail and marks earlier history as available", async () => {
  const { hydrateChatFromThread } = await import("../web/modules/thread-chat-state.mjs");

  const chat = {
    id: "thread-1",
    threadId: "thread-1",
    messages: [],
    title: "Thread",
  };
  const thread = {
    id: "thread-1",
    cwd: "/repo",
    gitInfo: {
      branch: "main",
      originUrl: "https://example.com/repo.git",
    },
    name: "Thread",
    preview: "recent preview",
    source: "desktop",
    turns: [
      { id: "turn-1", status: "completed", items: [{ id: "m-1", type: "agentMessage", text: "first" }] },
      { id: "turn-2", status: "completed", items: [{ id: "m-2", type: "agentMessage", text: "second" }] },
      { id: "turn-3", status: "completed", items: [{ id: "m-3", type: "agentMessage", text: "third" }] },
    ],
    updatedAt: 1,
  };

  hydrateChatFromThread(chat, thread, {
    cachedMessages: [],
    cachedWritable: true,
    messageLoadLimit: 2,
    messageOriginForChat() {
      return "desktop";
    },
    persistThreadCacheForChat() {},
    repoLabelFromThread() {
      return "Repo";
    },
    relativeTimeFromUnix() {
      return "now";
    },
  });

  assert.equal(chat.messagesLoaded, true);
  assert.equal(chat.writable, true);
  assert.equal(chat.hasEarlierMessages, true);
  assert.equal(chat.loadedMessageLimit, 2);
  assert.equal(chat.hasPendingTurn, false);
  assert.equal(chat.hasRichMessages, false);
  assert.deepEqual(
    chat.messages.map((message) => ({ text: message.text, origin: message.origin })),
    [
      { text: "second", origin: "desktop" },
      { text: "third", origin: "desktop" },
    ]
  );
});
