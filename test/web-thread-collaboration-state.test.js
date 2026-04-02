// FILE: web-thread-collaboration-state.test.js
// Purpose: Verifies extracted browser collaboration-state helpers mutate chats deterministically.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../web/modules/thread-collaboration-state.mjs

const test = require("node:test");
const assert = require("node:assert/strict");

test("upsertStructuredUserInputRequest adds a request card and resolveServerRequestInChats clears it", async () => {
  const {
    resolveServerRequestInChats,
    upsertStructuredUserInputRequest,
  } = await import("../web/modules/thread-collaboration-state.mjs");

  const chat = { id: "thread-1", messages: [] };
  const threadIdByTurnId = {};
  const findChatByThreadId = (threadId) => (threadId === "thread-1" ? chat : null);

  const update = upsertStructuredUserInputRequest({
    findChatByThreadId,
    messageOriginForChat: () => "web",
    params: {
      questions: [
        {
          header: "Direction",
          id: "direction",
          options: [
            { description: "Move immediately", label: "Ship now" },
          ],
          question: "Which path should we take?",
        },
      ],
      threadId: "thread-1",
      turnId: "turn-1",
    },
    requestId: "request-1",
    threadIdByTurnId,
  });

  assert.equal(update.chat, chat);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].kind, "structured-input");
  assert.equal(chat.messages[0].origin, "web");
  assert.equal(threadIdByTurnId["turn-1"], "thread-1");

  const resolved = resolveServerRequestInChats({
    findChatByThreadId,
    flattenChats: () => [chat],
    params: {
      requestId: "request-1",
      threadId: "thread-1",
    },
    threadIdByTurnId,
  });

  assert.equal(resolved.chat, chat);
  assert.equal(chat.messages.length, 0);
});

test("applyTurnPlanUpdated and applyPlanDelta reuse the same plan message", async () => {
  const {
    applyPlanDelta,
    applyTurnPlanUpdated,
    finalizePlanMessages,
  } = await import("../web/modules/thread-collaboration-state.mjs");

  const chat = { id: "thread-1", messages: [] };
  const threadIdByTurnId = {};
  const findChatByThreadId = (threadId) => (threadId === "thread-1" ? chat : null);
  const messageOriginForChat = () => "shared";

  const updated = applyTurnPlanUpdated({
    findChatByThreadId,
    messageOriginForChat,
    params: {
      explanation: "Ship the smallest safe slice first.",
      plan: [
        { status: "pending", step: "Audit the current web flow" },
      ],
      threadId: "thread-1",
      turnId: "turn-1",
    },
    threadIdByTurnId,
  });

  assert.equal(updated.chat, chat);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].kind, "plan");
  assert.equal(chat.messages[0].origin, "shared");
  assert.equal(chat.messages[0].planState.explanation, "Ship the smallest safe slice first.");

  const delta = applyPlanDelta({
    findChatByThreadId,
    messageOriginForChat,
    params: {
      delta: "Add notification settings and request cards.",
      itemId: "plan-item-1",
      threadId: "thread-1",
      turnId: "turn-1",
    },
    threadIdByTurnId,
  });

  assert.equal(delta.chat, chat);
  assert.equal(chat.messages.length, 1);
  assert.equal(chat.messages[0].itemId, "plan-item-1");
  assert.equal(chat.messages[0].text, "Add notification settings and request cards.");
  assert.equal(chat.messages[0].planState.presentation, "result_streaming");

  finalizePlanMessages(chat, "turn-1");
  assert.equal(chat.messages[0].time, "completed");
  assert.deepEqual(chat.messages[0].planState.steps, [
    { status: "completed", step: "Audit the current web flow" },
  ]);
});
