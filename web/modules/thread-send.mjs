export function messageOriginForThread(chat, bridgeActiveThreadId) {
  if (!chat?.threadId) {
    return "local";
  }
  if (chat.threadId === bridgeActiveThreadId) {
    return "shared";
  }
  return chat.writable ? "web" : "desktop";
}

export function shouldForkThreadForSend(chat, bridgeActiveThreadId) {
  const origin = messageOriginForThread(chat, bridgeActiveThreadId);
  return origin === "shared" || (chat?.threadId && chat.writable !== true);
}

export function buildTurnStartParams({ chat, text, preferences }) {
  const input = [{ text, type: "text" }];
  const access = chat?.access || preferences?.access;
  return {
    approvalPolicy: approvalPolicyForAccess(access),
    cwd: chat?.cwd || null,
    effort: normalizeReasoningEffort(preferences?.reasoning),
    input,
    model: chat?.model || preferences?.model,
    sandbox: sandboxForAccess(access),
    threadId: chat?.threadId || null,
  };
}

function normalizeReasoningEffort(value) {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  switch (normalized) {
    case "extra high":
    case "xhigh":
      return "xhigh";
    case "high":
      return "high";
    case "balanced":
    case "medium":
      return "medium";
    case "low":
      return "low";
    case "minimal":
      return "minimal";
    case "none":
      return "none";
    default:
      return undefined;
  }
}

export function approvalPolicyForAccess(access) {
  return access === "Workspace Write" ? "never" : "on-request";
}

export function sandboxForAccess(access) {
  return access === "Read Only" ? "read-only" : "workspace-write";
}
