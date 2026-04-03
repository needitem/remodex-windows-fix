export const DEFAULT_THREAD_MESSAGE_LOAD_LIMIT = 40;
export const THREAD_MESSAGE_LOAD_INCREMENT = 40;
export const DEFAULT_THREAD_CACHE_MESSAGE_LIMIT = 20;

export function extractMessagesFromThread(thread, options = {}) {
  return extractThreadMessageSnapshot(thread, options).messages;
}

export function extractThreadMessageSnapshot(thread, { limit } = {}) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const normalizedLimit = normalizeMessageLimit(limit);
  const messages = [];

  for (let turnIndex = turns.length - 1; turnIndex >= 0; turnIndex -= 1) {
    const turn = turns[turnIndex];
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (let itemIndex = items.length - 1; itemIndex >= 0; itemIndex -= 1) {
      const message = buildThreadItemMessage(items[itemIndex], turn, {
        itemIndex,
        turnIndex,
      });
      if (!message) {
        continue;
      }

      messages.push(message);
      if (messages.length >= normalizedLimit) {
        return {
          messages: messages.slice().reverse(),
          truncated: turnIndex > 0 || itemIndex > 0,
        };
      }
    }
  }

  return {
    messages: messages.length ? messages.reverse() : [buildIdleThreadMessage(thread)],
    truncated: false,
  };
}

export function trimMessagesToRecentWindow(messages, { limit = DEFAULT_THREAD_CACHE_MESSAGE_LIMIT } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const normalizedLimit = normalizeMessageLimit(limit);
  if (!Number.isFinite(normalizedLimit) || list.length <= normalizedLimit) {
    return list;
  }
  return list.slice(-normalizedLimit);
}

export function messageRequiresRichRenderer(message) {
  return message?.kind === "plan"
    || message?.kind === "structured-input"
    || message?.kind === "approval";
}

export function buildMessageCollectionState(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let hasPendingTurn = false;
  let hasRichMessages = false;

  for (const message of list) {
    if (!hasPendingTurn && message?.pending === true) {
      hasPendingTurn = true;
    }
    if (!hasRichMessages && messageRequiresRichRenderer(message)) {
      hasRichMessages = true;
    }
    if (hasPendingTurn && hasRichMessages) {
      break;
    }
  }

  return {
    hasPendingTurn,
    hasRichMessages,
  };
}

export function mergeMessagesWithCache({
  threadId,
  serverMessages,
  cachedMessages = [],
  limit,
}) {
  if (!cachedMessages.length) {
    return trimMessagesToRecentWindow(serverMessages, { limit });
  }
  if (!serverMessages.length) {
    return trimMessagesToRecentWindow(cachedMessages, { limit });
  }

  const merged = cachedMessages.map((message) => ({ ...message }));
  const indexesById = new Map();
  const indexesBySemanticKey = new Map();

  for (let index = 0; index < merged.length; index += 1) {
    const message = merged[index];
    if (message?.id) {
      indexesById.set(`id:${message.id}`, index);
    }
    const semanticKey = messageSemanticKey(message);
    if (semanticKey && !indexesBySemanticKey.has(semanticKey)) {
      indexesBySemanticKey.set(semanticKey, index);
    }
  }

  for (const serverMessage of serverMessages) {
    const byIdKey = serverMessage?.id ? `id:${serverMessage.id}` : "";
    const semanticKey = messageSemanticKey(serverMessage);
    const matchedIndex = indexesById.get(byIdKey) ?? indexesBySemanticKey.get(semanticKey);
    if (matchedIndex == null) {
      merged.push(serverMessage);
      const nextIndex = merged.length - 1;
      if (serverMessage?.id) {
        indexesById.set(`id:${serverMessage.id}`, nextIndex);
      }
      if (semanticKey && !indexesBySemanticKey.has(semanticKey)) {
        indexesBySemanticKey.set(semanticKey, nextIndex);
      }
      continue;
    }

    merged[matchedIndex] = mergeCachedMessage(merged[matchedIndex], serverMessage);
    if (serverMessage?.id) {
      indexesById.set(`id:${serverMessage.id}`, matchedIndex);
    }
  }

  return trimMessagesToRecentWindow(merged, { limit });
}

export function threadHasInProgressTurn(thread) {
  return Boolean((thread?.turns || []).some((turn) => turn?.status === "inProgress"));
}

export function normalizeMessageOrigins(messages, origin) {
  return (messages || []).map((message) => ({
    ...message,
    origin: message.origin || origin,
  }));
}

export function summarizeCommandForDisplay(command) {
  const normalized = String(command || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "Command";
  }
  if (normalized.startsWith("Get-ChildItem") && normalized.includes("Select-String")) {
    return "Search files";
  }
  if (normalized.startsWith("Get-Content")) {
    return "Read file";
  }
  if (normalized.startsWith("git ")) {
    return "Run git";
  }
  if (normalized.startsWith("if (Test-Path")) {
    return "Check file";
  }
  return truncate(normalized, 88);
}

export function normalizeCommandOutput(value) {
  const lines = String(value || "").replace(/\r\n/g, "\n").split("\n");
  const filtered = [];
  for (const line of lines) {
    if (/^Exit code:/i.test(line)) {
      continue;
    }
    if (/^Wall time:/i.test(line)) {
      continue;
    }
    if (/^Total output lines:/i.test(line)) {
      continue;
    }
    if (/^Output:$/i.test(line.trim())) {
      continue;
    }
    filtered.push(line);
  }
  return filtered.join("\n").trim();
}

export function buildCommandPreview(rawOutput) {
  const normalized = normalizeCommandOutput(rawOutput);
  if (!normalized) {
    return "Running...";
  }
  const lines = normalized.split("\n").filter(Boolean);
  return truncate(lines.slice(0, 4).join("\n"), 260);
}

function buildThreadItemMessage(item, turn, { turnIndex = 0, itemIndex = 0 } = {}) {
  if (!item || typeof item !== "object") {
    return null;
  }

  if (item.type === "userMessage") {
    const text = (item.content || [])
      .filter((entry) => entry.type === "text")
      .map((entry) => entry.text)
      .join("\n\n");
    if (!text) {
      return null;
    }
    return {
      id: item.id || fallbackThreadMessageId("user", turn, turnIndex, itemIndex),
      role: "user",
      author: "You",
      time: turn?.status,
      text,
    };
  }

  if (item.type === "agentMessage") {
    return {
      id: item.id || fallbackThreadMessageId("assistant", turn, turnIndex, itemIndex),
      role: "assistant",
      author: "Codex",
      time: item.phase || turn?.status,
      text: item.text,
    };
  }

  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "";
    const rawOutput = normalizeCommandOutput(item.output || item.rawOutput || item.text || "");
    return {
      id: item.id || fallbackThreadMessageId("command", turn, turnIndex, itemIndex),
      role: "assistant",
      author: "Shell",
      kind: "command",
      time: item.status || turn?.status,
      command,
      summary: summarizeCommandForDisplay(command || "Command"),
      preview: buildCommandPreview(rawOutput),
      rawOutput,
      text: "",
    };
  }

  if (item.type === "plan") {
    const text = normalizePlanText(item);
    return {
      author: "Plan",
      id: item.id || fallbackThreadMessageId("plan", turn, turnIndex, itemIndex),
      kind: "plan",
      planState: {
        explanation: normalizePlanExplanation(item.explanation),
        steps: normalizePlanSteps(item.plan, turn?.status),
      },
      role: "assistant",
      text,
      time: turn?.status === "completed" ? "completed" : "running",
    };
  }

  if (item.type === "reasoning" && item.summary?.length) {
    return {
      id: item.id || fallbackThreadMessageId("reasoning", turn, turnIndex, itemIndex),
      role: "assistant",
      author: "Reasoning",
      time: turn?.status,
      text: item.summary.join("\n"),
    };
  }

  return null;
}

function buildIdleThreadMessage(thread) {
  return {
    id: `idle:${thread?.id || "thread"}`,
    role: "assistant",
    author: "Codex",
    time: "idle",
    text: "This thread has no materialized turns yet.",
  };
}

function fallbackThreadMessageId(kind, turn, turnIndex, itemIndex) {
  const turnKey = turn?.id || turn?.turnId || `turn-${turnIndex}`;
  return `${kind}:${turnKey}:${turnIndex}:${itemIndex}`;
}

function normalizeMessageLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.max(1, Math.trunc(numeric));
}

function messageSemanticKey(message) {
  if (!message || typeof message !== "object") {
    return "";
  }

  if (message.kind === "command") {
    return [
      "command",
      String(message.command || "").trim(),
      normalizeCommandOutput(message.rawOutput || ""),
    ].join("|");
  }

  const text = String(message.text || "").trim();
  if (!text) {
    return "";
  }

  return [
    message.kind || "text",
    message.role || "",
    message.author || "",
    text,
  ].join("|");
}

function mergeCachedMessage(cachedMessage, serverMessage) {
  const merged = {
    ...cachedMessage,
    ...serverMessage,
    origin: cachedMessage.origin || serverMessage.origin,
    text: String(serverMessage.text || "") || String(cachedMessage.text || ""),
    time: preferredMessageTime(cachedMessage.time, serverMessage.time),
  };

  if (merged.kind === "command") {
    merged.command = serverMessage.command || cachedMessage.command || "";
    merged.rawOutput = serverMessage.rawOutput || cachedMessage.rawOutput || "";
    merged.summary = serverMessage.summary || cachedMessage.summary || summarizeCommandForDisplay(merged.command || "Command");
    merged.preview = serverMessage.preview || cachedMessage.preview || buildCommandPreview(merged.rawOutput);
  }

  return merged;
}

function preferredMessageTime(cachedTime, serverTime) {
  if (!serverTime) {
    return cachedTime;
  }
  if (!cachedTime) {
    return serverTime;
  }
  return messageTimeRank(cachedTime) > messageTimeRank(serverTime) ? cachedTime : serverTime;
}

function messageTimeRank(value) {
  switch (value) {
    case "final_answer":
      return 7;
    case "commentary":
      return 6;
    case "completed":
      return 5;
    case "running":
      return 4;
    case "streaming":
      return 3;
    case "thinking":
      return 2;
    case "started":
      return 1;
    default:
      return 0;
  }
}

function normalizePlanText(item) {
  const contentItems = Array.isArray(item?.content) ? item.content : [];
  const textParts = contentItems
    .filter((entry) => entry?.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text.trim())
    .filter(Boolean);
  if (textParts.length) {
    return textParts.join("\n\n");
  }
  return normalizePlanExplanation(item?.explanation) || "Plan updated.";
}

function normalizePlanExplanation(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || "";
}

function normalizePlanSteps(value, turnStatus) {
  const items = Array.isArray(value) ? value : [];
  const steps = items
    .map((entry) => ({
      status: normalizePlanStepStatus(entry?.status, turnStatus),
      step: typeof entry?.step === "string" ? entry.step.trim() : "",
    }))
    .filter((entry) => entry.step);

  if (turnStatus === "completed") {
    return steps.map((entry) => ({
      ...entry,
      status: "completed",
    }));
  }

  return steps;
}

function normalizePlanStepStatus(value, turnStatus) {
  const normalized = String(value || "").trim().toLowerCase();
  if (turnStatus === "completed") {
    return "completed";
  }
  switch (normalized) {
    case "completed":
    case "done":
      return "completed";
    case "inprogress":
    case "in_progress":
    case "running":
      return "in_progress";
    default:
      return "pending";
  }
}

function truncate(value, maxLength) {
  const normalized = String(value || "");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}
