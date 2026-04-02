const DEFAULT_NEAR_BOTTOM_THRESHOLD_PX = 96;

export function buildMessageRenderKey(message = {}) {
  return hashRenderSnapshot(JSON.stringify({
    approval: message.approval || null,
    author: message.author || "",
    command: message.command || "",
    draftAnswers: message.draftAnswers || null,
    error: message.error || "",
    id: message.id || "",
    kind: message.kind || "",
    origin: message.origin || "",
    patch: message.patch || "",
    pending: message.pending === true,
    planState: message.planState || null,
    preview: message.preview || "",
    rawOutput: message.rawOutput || "",
    requestId: message.requestId || "",
    resolving: message.resolving === true,
    role: message.role || "",
    structuredInput: message.structuredInput || null,
    summary: message.summary || "",
    text: message.text || "",
    time: message.time || "",
  }));
}

export function isScrolledNearBottom(containerLike, {
  thresholdPx = DEFAULT_NEAR_BOTTOM_THRESHOLD_PX,
} = {}) {
  const clientHeight = Number(containerLike?.clientHeight) || 0;
  const scrollHeight = Number(containerLike?.scrollHeight) || 0;
  const scrollTop = Number(containerLike?.scrollTop) || 0;

  if (!clientHeight || !scrollHeight) {
    return true;
  }

  return scrollHeight - (scrollTop + clientHeight) <= thresholdPx;
}

export function shouldAutoScrollMessageList({
  nextLastMessageId = "",
  nextLastRenderKey = "",
  nextMessageCount = 0,
  previousLastMessageId = "",
  previousLastRenderKey = "",
  previousMessageCount = 0,
  selectedChatChanged = false,
  wasNearBottom = false,
} = {}) {
  if (selectedChatChanged) {
    return true;
  }

  if (!wasNearBottom) {
    return false;
  }

  return previousMessageCount !== nextMessageCount
    || previousLastMessageId !== nextLastMessageId
    || previousLastRenderKey !== nextLastRenderKey;
}

function hashRenderSnapshot(value) {
  let hash = 0;
  const normalized = String(value || "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
