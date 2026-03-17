export function groupRemoteThreads({ threads, repoLabelFromThread, threadToChat }) {
  const groups = new Map();
  for (const thread of threads) {
    const repo = repoLabelFromThread(thread);
    if (!groups.has(repo)) {
      groups.set(repo, []);
    }
    groups.get(repo).push(threadToChat(thread));
  }
  return Array.from(groups.entries()).map(([folder, chats]) => ({ folder, chats }));
}

export function mergeConversations({
  remoteConversations,
  existingChats,
  cloneConversations,
  flattenChats,
  upsertChatIntoConversations,
}) {
  const merged = cloneConversations(remoteConversations);
  const seenThreadIds = new Set(flattenChats(merged).map((chat) => chat.threadId || chat.id));
  for (const existingChat of existingChats) {
    const threadId = existingChat.threadId || existingChat.id;
    if (!threadId || seenThreadIds.has(threadId)) {
      continue;
    }
    upsertChatIntoConversations(merged, existingChat);
    seenThreadIds.add(threadId);
  }
  return merged;
}

export function findChatByThreadId(conversations, threadId) {
  for (const group of conversations) {
    const chat = group.chats.find((candidate) => candidate.threadId === threadId || candidate.id === threadId);
    if (chat) {
      return chat;
    }
  }
  return null;
}

export function upsertChatIntoConversations({ conversations, chat, mergeChatWithCache }) {
  const existing = findChatInCollections(conversations, chat.threadId || chat.id);
  if (existing) {
    Object.assign(existing, mergeChatWithCache(chat));
    return existing;
  }

  const folder = chat.repo || "Workspace";
  let group = conversations.find((candidate) => candidate.folder === folder);
  if (!group) {
    group = { folder, chats: [] };
    conversations.unshift(group);
  }
  group.chats.unshift(mergeChatWithCache(chat));
  return group.chats[0];
}

export function findChatInCollections(conversations, threadId) {
  for (const group of conversations) {
    const chat = group.chats.find((candidate) => candidate.threadId === threadId || candidate.id === threadId);
    if (chat) {
      return chat;
    }
  }
  return null;
}

export function flattenChats(conversations) {
  return conversations.flatMap((group) => group.chats || []);
}

export function representativeThreadInfo(conversations, repo) {
  for (const group of conversations) {
    for (const chat of group.chats) {
      if (chat.repo === repo && (chat.cwd || chat.originUrl || chat.branch)) {
        return {
          branch: chat.branch,
          cwd: chat.cwd || null,
          originUrl: chat.originUrl || null,
        };
      }
    }
  }
  return null;
}
