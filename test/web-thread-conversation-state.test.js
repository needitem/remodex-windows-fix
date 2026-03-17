// FILE: web-thread-conversation-state.test.js
// Purpose: Verifies browser conversation collection helpers group and merge chats predictably.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-conversation-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("groupRemoteThreads groups chats by repository label", async () => {
  const { groupRemoteThreads } = await import("../web/modules/thread-conversation-state.mjs");

  const groups = groupRemoteThreads({
    threads: [{ id: "thread-1", repo: "Repo A" }, { id: "thread-2", repo: "Repo B" }],
    repoLabelFromThread(thread) {
      return thread.repo;
    },
    threadToChat(thread) {
      return { id: thread.id, threadId: thread.id, repo: thread.repo };
    },
  });

  assert.equal(groups.length, 2);
  assert.equal(groups[0].folder, "Repo A");
  assert.equal(groups[1].folder, "Repo B");
});

test("mergeConversations preserves local-only chats not present in remote data", async () => {
  const {
    flattenChats,
    mergeConversations,
    upsertChatIntoConversations,
  } = await import("../web/modules/thread-conversation-state.mjs");

  const merged = mergeConversations({
    remoteConversations: [{ folder: "Repo", chats: [{ id: "thread-1", threadId: "thread-1", repo: "Repo" }] }],
    existingChats: [{ id: "draft-1", repo: "Repo", title: "Draft" }],
    cloneConversations(value) {
      return JSON.parse(JSON.stringify(value));
    },
    flattenChats,
    upsertChatIntoConversations(conversations, chat) {
      return upsertChatIntoConversations({
        conversations,
        chat,
        mergeChatWithCache(nextChat) {
          return nextChat;
        },
      });
    },
  });

  const chats = flattenChats(merged);
  assert.equal(chats.length, 2);
  assert.ok(chats.find((chat) => chat.id === "draft-1"));
  assert.ok(chats.find((chat) => chat.id === "thread-1"));
});

test("representativeThreadInfo returns the first usable repo context snapshot", async () => {
  const { representativeThreadInfo } = await import("../web/modules/thread-conversation-state.mjs");

  const info = representativeThreadInfo([
    {
      folder: "Repo",
      chats: [
        { repo: "Repo", branch: "main", cwd: "/repo", originUrl: "https://example.com/repo.git" },
      ],
    },
  ], "Repo");

  assert.deepEqual(info, {
    branch: "main",
    cwd: "/repo",
    originUrl: "https://example.com/repo.git",
  });
});
