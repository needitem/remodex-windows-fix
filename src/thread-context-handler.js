// FILE: thread-context-handler.js
// Purpose: Serves on-demand thread context-window usage reads from local Codex rollout files.
// Layer: Bridge handler
// Exports: handleThreadContextRequest
// Depends on: ./rollout-watch

const fs = require("fs");
const {
  findRecentRolloutFileForContextRead,
  readLatestContextWindowUsage,
  resolveSessionsRoot,
} = require("./rollout-watch");
const { readLastActiveThread } = require("./session-state");

function handleThreadContextRequest(rawMessage, sendResponse) {
  let parsed;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return false;
  }

  const method = typeof parsed?.method === "string" ? parsed.method.trim() : "";
  if (
    method !== "thread/contextWindow/read"
    && method !== "thread/active/read"
    && method !== "thread/runtime/read"
  ) {
    return false;
  }

  const id = parsed.id;
  const params = parsed.params || {};

  const handler = method === "thread/active/read"
    ? handleActiveThreadRead
    : method === "thread/runtime/read"
      ? () => handleThreadRuntimeRead(params)
    : () => handleThreadContextRead(params);

  handler()
    .then((result) => {
      sendResponse(JSON.stringify({ id, result }));
    })
    .catch((err) => {
      const errorCode = err.errorCode || "thread_context_error";
      const message = err.userMessage || err.message || "Unknown thread context error";
      sendResponse(
        JSON.stringify({
          id,
          error: {
            code: -32000,
            message,
            data: { errorCode },
          },
        })
      );
    });

  return true;
}

async function handleActiveThreadRead() {
  const activeThread = readLastActiveThread();
  return {
    thread: activeThread || null,
  };
}

// Reads the newest rollout-backed usage snapshot and returns it in the app-facing shape.
async function handleThreadContextRead(params) {
  const threadId = readString(params.threadId) || readString(params.thread_id);
  if (!threadId) {
    throw threadContextError("missing_thread_id", "thread/contextWindow/read requires a threadId.");
  }

  const turnId = readString(params.turnId) || readString(params.turn_id);
  const result = readLatestContextWindowUsage({
    threadId,
    turnId,
  });

  return {
    threadId,
    usage: result?.usage ?? null,
    rolloutPath: result?.rolloutPath ?? null,
  };
}

async function handleThreadRuntimeRead(params) {
  const threadId = readString(params.threadId) || readString(params.thread_id);
  if (!threadId) {
    throw threadContextError("missing_thread_id", "thread/runtime/read requires a threadId.");
  }

  const turnId = readString(params.turnId) || readString(params.turn_id);
  const rolloutPath = findRecentRolloutFileForContextRead(resolveSessionsRoot(), {
    threadId,
    turnId,
    fsModule: fs,
  });

  return {
    threadId,
    rolloutPath: rolloutPath || null,
    runtime: rolloutPath ? readLatestThreadRuntimeFromRollout(rolloutPath, turnId) : null,
  };
}

function readLatestThreadRuntimeFromRollout(rolloutPath, turnId = "") {
  const contents = fs.readFileSync(rolloutPath, "utf8");
  const lines = contents.split(/\r?\n/);
  let latestRuntime = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }

    if (parsed?.type !== "turn_context" || !parsed.payload || typeof parsed.payload !== "object") {
      continue;
    }

    if (turnId) {
      const payloadTurnId = readString(parsed.payload.turn_id) || readString(parsed.payload.turnId);
      if (payloadTurnId && payloadTurnId !== turnId) {
        continue;
      }
    }

    latestRuntime = {
      approvalPolicy: readString(parsed.payload.approval_policy),
      effort: readString(parsed.payload.effort)
        || readString(parsed.payload?.collaboration_mode?.settings?.reasoning_effort),
      model: readString(parsed.payload.model)
        || readString(parsed.payload?.collaboration_mode?.settings?.model),
      sandboxType: readString(parsed.payload?.sandbox_policy?.type),
      turnId: readString(parsed.payload.turn_id) || readString(parsed.payload.turnId) || null,
    };
  }

  return latestRuntime;
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function threadContextError(errorCode, userMessage) {
  const error = new Error(userMessage);
  error.errorCode = errorCode;
  error.userMessage = userMessage;
  return error;
}

module.exports = {
  handleThreadContextRequest,
};
