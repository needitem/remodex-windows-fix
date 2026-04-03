export const DEFAULT_VISIBLE_MESSAGE_COUNT = 10;
export const MESSAGE_WINDOW_EXPAND_STEP = 10;

export function resolveConversationWindowState({
  defaultVisibleCount = DEFAULT_VISIBLE_MESSAGE_COUNT,
  requestedStartIndex = null,
  totalMessages = 0,
} = {}) {
  const normalizedTotalMessages = normalizePositiveInteger(totalMessages, 0);
  const normalizedDefaultVisibleCount = Math.max(1, normalizePositiveInteger(defaultVisibleCount, DEFAULT_VISIBLE_MESSAGE_COUNT));
  const tailStartIndex = Math.max(0, normalizedTotalMessages - normalizedDefaultVisibleCount);
  const normalizedRequestedStartIndex = Number.isInteger(requestedStartIndex)
    ? clamp(requestedStartIndex, 0, normalizedTotalMessages)
    : null;

  if (normalizedRequestedStartIndex == null || normalizedRequestedStartIndex >= tailStartIndex) {
    return buildConversationWindow("tail", tailStartIndex, normalizedTotalMessages);
  }

  return buildConversationWindow("anchored", normalizedRequestedStartIndex, normalizedTotalMessages);
}

export function expandConversationWindow({
  defaultVisibleCount = DEFAULT_VISIBLE_MESSAGE_COUNT,
  expandStep = MESSAGE_WINDOW_EXPAND_STEP,
  requestedStartIndex = null,
  totalMessages = 0,
} = {}) {
  const conversationWindow = resolveConversationWindowState({
    defaultVisibleCount,
    requestedStartIndex,
    totalMessages,
  });

  if (!conversationWindow.hiddenCount) {
    return conversationWindow.startIndex;
  }

  return Math.max(0, conversationWindow.startIndex - Math.max(1, normalizePositiveInteger(expandStep, MESSAGE_WINDOW_EXPAND_STEP)));
}

function buildConversationWindow(mode, startIndex, totalMessages) {
  return {
    endIndex: totalMessages,
    hiddenCount: startIndex,
    mode,
    startIndex,
    totalMessages,
    visibleCount: Math.max(0, totalMessages - startIndex),
  };
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizePositiveInteger(value, fallback) {
  const normalizedValue = Number.parseInt(value, 10);
  return Number.isFinite(normalizedValue) && normalizedValue >= 0
    ? normalizedValue
    : fallback;
}
