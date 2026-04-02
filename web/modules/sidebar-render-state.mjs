function normalizeSearchQuery(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesSearch(chat, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }

  return [chat?.title, chat?.snippet, chat?.repo]
    .join(" ")
    .toLowerCase()
    .includes(normalizedQuery);
}

export function buildSidebarChatRenderKey(chatView = {}) {
  return JSON.stringify({
    active: chatView.active === true,
    id: chatView.id || "",
    pending: chatView.pending === true,
    snippet: chatView.snippet || "",
    timestamp: chatView.timestamp || "",
    title: chatView.title || "",
  });
}

export function buildSidebarSelectionDelta(previousSelectedChatId = "", nextSelectedChatId = "") {
  const previousId = String(previousSelectedChatId || "");
  const nextId = String(nextSelectedChatId || "");
  if (!previousId && !nextId) {
    return [];
  }

  const changes = [];
  if (previousId && previousId !== nextId) {
    changes.push({ active: false, id: previousId });
  }
  if (nextId && nextId !== previousId) {
    changes.push({ active: true, id: nextId });
  }
  return changes;
}

export function buildSidebarRenderModel({
  conversations = [],
  searchQuery = "",
  selectedChatId = "",
  isChatPending = () => false,
} = {}) {
  const normalizedQuery = normalizeSearchQuery(searchQuery);
  const groups = [];
  let allThreadCount = 0;
  let visibleThreadCount = 0;

  for (const group of conversations) {
    const chats = Array.isArray(group?.chats) ? group.chats : [];
    allThreadCount += chats.length;

    const visibleChats = chats
      .filter((chat) => matchesSearch(chat, normalizedQuery))
      .map((chat) => ({
        active: chat.id === selectedChatId,
        id: chat.id,
        pending: isChatPending(chat),
        snippet: chat.snippet || "",
        timestamp: chat.timestamp || "",
        title: chat.title || "Untitled thread",
      }));

    if (!visibleChats.length) {
      continue;
    }

    visibleThreadCount += visibleChats.length;
    groups.push({
      chats: visibleChats,
      folder: group.folder || "Workspace",
    });
  }

  const visibleWorkspaceCount = groups.length;
  const metaText = normalizedQuery
    ? `${visibleThreadCount} result${visibleThreadCount === 1 ? "" : "s"} across ${visibleWorkspaceCount} workspace${visibleWorkspaceCount === 1 ? "" : "s"}`
    : `${allThreadCount} thread${allThreadCount === 1 ? "" : "s"} across ${conversations.length} workspace${conversations.length === 1 ? "" : "s"}`;

  return {
    allThreadCount,
    groups,
    hasChats: groups.length > 0,
    normalizedQuery,
    visibleThreadCount,
    visibleWorkspaceCount,
    metaText,
  };
}
