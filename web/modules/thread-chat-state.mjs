import {
  buildMessageCollectionState,
  DEFAULT_THREAD_MESSAGE_LOAD_LIMIT,
  extractThreadMessageSnapshot,
  mergeMessagesWithCache,
  normalizeMessageOrigins,
} from "./thread-message-state.mjs";

export function threadToChat(thread, {
  defaultAccess,
  mergeChatWithCache,
  messageOriginForChat,
  messageLoadLimit = DEFAULT_THREAD_MESSAGE_LOAD_LIMIT,
  repoLabelFromThread,
  relativeTimeFromUnix,
} = {}) {
  const snapshot = extractThreadMessageSnapshot(thread, {
    limit: messageLoadLimit,
  });
  const nextChat = {
    access: defaultAccess,
    branch: thread.gitInfo?.branch || "main",
    cwd: thread.cwd,
    hasEarlierMessages: snapshot.truncated,
    id: thread.id,
    loadedMessageLimit: normalizeMessageLoadLimit(messageLoadLimit, snapshot.messages.length),
    model: null,
    messages: snapshot.messages,
    messagesLoaded: false,
    originUrl: thread.gitInfo?.originUrl || null,
    reasoning: null,
    repo: repoLabelFromThread(thread),
    snippet: thread.preview || "No preview",
    source: normalizeThreadSource(thread.source),
    threadId: thread.id,
    timestamp: relativeTimeFromUnix(thread.updatedAt),
    title: thread.name || thread.preview || "Untitled thread",
    writable: false,
  };
  Object.assign(nextChat, buildMessageCollectionState(nextChat.messages));
  const mergedChat = mergeChatWithCache(nextChat);
  mergedChat.messages = normalizeMessageOrigins(mergedChat.messages, messageOriginForChat(mergedChat));
  Object.assign(mergedChat, buildMessageCollectionState(mergedChat.messages));
  return mergedChat;
}

export function hydrateChatFromThread(chat, thread, {
  cachedMessages = [],
  cachedWritable = false,
  messageOriginForChat,
  messageLoadLimit = chat?.loadedMessageLimit || DEFAULT_THREAD_MESSAGE_LOAD_LIMIT,
  persistThreadCacheForChat,
  repoLabelFromThread,
  relativeTimeFromUnix,
} = {}) {
  const snapshot = extractThreadMessageSnapshot(thread, {
    limit: messageLoadLimit,
  });
  const resolvedMessageLoadLimit = normalizeMessageLoadLimit(messageLoadLimit, snapshot.messages.length);
  chat.branch = thread.gitInfo?.branch || chat.branch;
  chat.cwd = thread.cwd;
  chat.hasEarlierMessages = snapshot.truncated;
  chat.loadedMessageLimit = resolvedMessageLoadLimit;
  chat.writable = cachedWritable === true;
  chat.messages = normalizeMessageOrigins(
    mergeMessagesWithCache({
      threadId: thread.id,
      limit: resolvedMessageLoadLimit,
      serverMessages: snapshot.messages,
      cachedMessages,
    }),
    messageOriginForChat(chat)
  );
  if (!threadHasInProgressTurn(thread)) {
    chat.messages = chat.messages.filter((message) => !message.pending);
  }
  Object.assign(chat, buildMessageCollectionState(chat.messages));
  chat.messagesLoaded = true;
  chat.originUrl = thread.gitInfo?.originUrl || chat.originUrl || null;
  chat.repo = repoLabelFromThread(thread);
  chat.source = normalizeThreadSource(thread.source);
  chat.snippet = thread.preview || chat.snippet;
  chat.timestamp = relativeTimeFromUnix(thread.updatedAt);
  chat.title = thread.name || thread.preview || chat.title;
  persistThreadCacheForChat(chat);
}

export function adoptRemoteThreadForChat(chat, thread, {
  repoLabelFromThread,
  relativeTimeFromUnix,
  selectChat = () => {},
} = {}) {
  chat.threadId = thread.id;
  chat.id = thread.id;
  chat.cwd = thread.cwd;
  chat.originUrl = thread.gitInfo?.originUrl || chat.originUrl || null;
  chat.repo = repoLabelFromThread(thread);
  chat.branch = thread.gitInfo?.branch || chat.branch;
  chat.source = normalizeThreadSource(thread.source);
  chat.title = thread.name || thread.preview || chat.title;
  chat.timestamp = relativeTimeFromUnix(thread.updatedAt);
  selectChat(chat.id);
}

export function mergeChatWithCache(chat, cached = null) {
  if (!cached) {
    return chat;
  }

  return {
    ...chat,
    access: cached.access || chat.access,
    branch: cached.branch || chat.branch,
    cwd: cached.cwd || chat.cwd,
    hasEarlierMessages: cached.hasEarlierMessages === true || chat.hasEarlierMessages === true,
    hasPendingTurn: typeof cached.hasPendingTurn === "boolean" ? cached.hasPendingTurn : chat.hasPendingTurn === true,
    hasRichMessages: typeof cached.hasRichMessages === "boolean" ? cached.hasRichMessages : chat.hasRichMessages === true,
    loadedMessageLimit: normalizeMessageLoadLimit(cached.loadedMessageLimit, chat.loadedMessageLimit),
    model: cached.model || chat.model || null,
    messages: Array.isArray(cached.messages) && cached.messages.length ? cached.messages : chat.messages,
    originUrl: cached.originUrl || chat.originUrl || null,
    reasoning: cached.reasoning || chat.reasoning || null,
    repo: cached.repo || chat.repo,
    snippet: cached.snippet || chat.snippet,
    title: cached.title || chat.title,
    writable: cached.writable === true,
  };
}

export function normalizeThreadSource(source) {
  if (typeof source === "string") {
    return source;
  }
  if (source && typeof source === "object" && source.subAgent) {
    return "subAgent";
  }
  return "unknown";
}

export function threadHasInProgressTurn(thread) {
  return Boolean((thread?.turns || []).some((turn) => turn?.status === "inProgress"));
}

function normalizeMessageLoadLimit(value, fallbackValue) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.max(1, Math.trunc(numeric));
  }

  const fallbackNumeric = Number(fallbackValue);
  if (Number.isFinite(fallbackNumeric) && fallbackNumeric > 0) {
    return Math.max(1, Math.trunc(fallbackNumeric));
  }

  return DEFAULT_THREAD_MESSAGE_LOAD_LIMIT;
}
