// FILE: web-sidebar-render-state.test.js
// Purpose: Verifies sidebar render helpers filter threads and preserve stable render keys.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/sidebar-render-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("buildSidebarRenderModel filters chats and reports summary counts", async () => {
  const { buildSidebarRenderModel } = await import("../web/modules/sidebar-render-state.mjs");

  const conversations = [
    {
      folder: "repo-a",
      chats: [
        { id: "thread-1", repo: "repo-a", snippet: "review auth flow", timestamp: "now", title: "Auth" },
        { id: "thread-2", repo: "repo-a", snippet: "fix cache invalidation", timestamp: "later", title: "Cache" },
      ],
    },
    {
      folder: "repo-b",
      chats: [
        { id: "thread-3", repo: "repo-b", snippet: "worker deploy", timestamp: "soon", title: "Deploy" },
      ],
    },
  ];

  const result = buildSidebarRenderModel({
    conversations,
    isChatPending: (chat) => chat.id === "thread-2",
    searchQuery: "cache",
    selectedChatId: "thread-2",
  });

  assert.equal(result.hasChats, true);
  assert.equal(result.visibleThreadCount, 1);
  assert.equal(result.visibleWorkspaceCount, 1);
  assert.equal(result.metaText, "1 result across 1 workspace");
  assert.deepEqual(result.groups, [
    {
      folder: "repo-a",
      chats: [
        {
          active: true,
          id: "thread-2",
          pending: true,
          snippet: "fix cache invalidation",
          timestamp: "later",
          title: "Cache",
        },
      ],
    },
  ]);
});

test("buildSidebarChatRenderKey changes when visible chat state changes", async () => {
  const { buildSidebarChatRenderKey } = await import("../web/modules/sidebar-render-state.mjs");

  const first = buildSidebarChatRenderKey({
    active: false,
    id: "thread-1",
    pending: false,
    snippet: "review auth flow",
    timestamp: "now",
    title: "Auth",
  });
  const second = buildSidebarChatRenderKey({
    active: true,
    id: "thread-1",
    pending: false,
    snippet: "review auth flow",
    timestamp: "now",
    title: "Auth",
  });

  assert.notEqual(first, second);
});

test("buildSidebarSelectionDelta only patches the previous and next selected chats", async () => {
  const { buildSidebarSelectionDelta } = await import("../web/modules/sidebar-render-state.mjs");

  assert.deepEqual(
    buildSidebarSelectionDelta("thread-1", "thread-2"),
    [
      { active: false, id: "thread-1" },
      { active: true, id: "thread-2" },
    ]
  );

  assert.deepEqual(buildSidebarSelectionDelta("thread-1", "thread-1"), []);
  assert.deepEqual(buildSidebarSelectionDelta("", "thread-2"), [{ active: true, id: "thread-2" }]);
});
