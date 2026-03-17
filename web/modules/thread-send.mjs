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
    effort: preferences?.reasoning || undefined,
    input,
    model: chat?.model || preferences?.model,
    sandbox: sandboxForAccess(access),
    threadId: chat?.threadId || null,
  };
}

export function approvalPolicyForAccess(access) {
  return access === "Workspace Write" ? "never" : "on-request";
}

export function sandboxForAccess(access) {
  return access === "Read Only" ? "read-only" : "workspace-write";
}
