export function extractMessagesFromThread(thread) {
  const messages = [];
  for (const turn of thread.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = (item.content || [])
          .filter((entry) => entry.type === "text")
          .map((entry) => entry.text)
          .join("\n\n");
        if (text) {
          messages.push({
            id: item.id || `user:${turn.id || turn.turnId || messages.length}:${messages.length}`,
            role: "user",
            author: "You",
            time: turn.status,
            text,
          });
        }
      } else if (item.type === "agentMessage") {
        messages.push({
          id: item.id || `assistant:${turn.id || turn.turnId || messages.length}:${messages.length}`,
          role: "assistant",
          author: "Codex",
          time: item.phase || turn.status,
          text: item.text,
        });
      } else if (item.type === "commandExecution") {
        const command = typeof item.command === "string" ? item.command : "";
        const rawOutput = normalizeCommandOutput(item.output || item.rawOutput || item.text || "");
        messages.push({
          id: item.id || `command:${turn.id || turn.turnId || messages.length}:${messages.length}`,
          role: "assistant",
          author: "Shell",
          kind: "command",
          time: item.status || turn.status,
          command,
          summary: summarizeCommandForDisplay(command || "Command"),
          preview: buildCommandPreview(rawOutput),
          rawOutput,
          text: "",
        });
      } else if (item.type === "plan") {
        const text = normalizePlanText(item);
        messages.push({
          author: "Plan",
          id: item.id || `plan:${turn.id || turn.turnId || messages.length}:${messages.length}`,
          kind: "plan",
          planState: {
            explanation: normalizePlanExplanation(item.explanation),
            steps: normalizePlanSteps(item.plan, turn.status),
          },
          role: "assistant",
          text,
          time: turn.status === "completed" ? "completed" : "running",
        });
      } else if (item.type === "reasoning" && item.summary?.length) {
        messages.push({
          id: item.id || `reasoning:${turn.id || turn.turnId || messages.length}:${messages.length}`,
          role: "assistant",
          author: "Reasoning",
          time: turn.status,
          text: item.summary.join("\n"),
        });
      }
    }
  }
  return messages.length ? messages : [{
    id: `idle:${thread.id || "thread"}`,
    role: "assistant",
    author: "Codex",
    time: "idle",
    text: "This thread has no materialized turns yet.",
  }];
}

export function mergeMessagesWithCache({ threadId, serverMessages, cachedMessages = [] }) {
  if (!cachedMessages.length) {
    return serverMessages;
  }
  if (!serverMessages.length) {
    return cachedMessages;
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

  return merged;
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
