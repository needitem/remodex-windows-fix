import { inferRelayBaseUrl } from "./modules/browser-relay-client.mjs";
import { createBrowserBridgeClient } from "./modules/browser-bridge-client.mjs";
import { collectBrowserCapabilities } from "./modules/capabilities.mjs";
import { decodePairingPayloadFromFile, describePairingPayload, parsePairingPayload } from "./modules/pairing.mjs";
import {
  clearStoredPairingPayload,
  loadStoredLastThreadId,
  loadStoredPairingPayload,
  loadStoredRelayOverride,
  loadStoredThreadCache,
  saveStoredLastThreadId,
  saveStoredPairingPayload,
  saveStoredRelayOverride,
  saveStoredThreadCache,
} from "./modules/storage.mjs";
import { ACCESS_OPTIONS, MODEL_OPTIONS, REASONING_OPTIONS, REPOSITORY_BRANCHES, SPEED_OPTIONS } from "./modules/mock-data.mjs";
import { loadPreferences, savePreferences } from "./modules/preferences.mjs";
import { createScannerController } from "./modules/scanner-controller.mjs";
import {
  approvalPolicyForAccess,
  buildTurnStartParams,
  messageOriginForThread,
  sandboxForAccess,
  shouldForkThreadForSend,
} from "./modules/thread-send.mjs";
import {
  buildCommandPreview,
  mergeMessagesWithCache,
  normalizeCommandOutput,
  summarizeCommandForDisplay,
} from "./modules/thread-message-state.mjs";
import {
  applyExecCommandBegin,
  applyExecCommandEnd,
  applyExecCommandOutput,
  buildCommandRawContent,
} from "./modules/thread-command-state.mjs";
import {
  adoptRemoteThreadForChat as adoptRemoteThreadForChatModel,
  hydrateChatFromThread as hydrateChatFromThreadModel,
  mergeChatWithCache as mergeChatWithCacheModel,
  normalizeThreadSource,
  threadToChat as threadToChatModel,
} from "./modules/thread-chat-state.mjs";
import {
  findChatByThreadId as findChatByThreadIdInCollections,
  flattenChats as flattenChatsFromCollections,
  groupRemoteThreads as groupRemoteThreadsModel,
  mergeConversations as mergeConversationsModel,
  representativeThreadInfo as representativeThreadInfoFromCollections,
  upsertChatIntoConversations as upsertChatIntoCollections,
} from "./modules/thread-conversation-state.mjs";

const state = {
  accountSummary: "Account: Unknown",
  branchCatalog: [],
  bridgeActiveThreadId: null,
  capabilities: collectBrowserCapabilities(window, navigator),
  client: null,
  connection: { detail: "Load a QR or pairing JSON to connect the browser client.", label: "Waiting for pairing", status: "warning" },
  conversations: [],
  logs: [],
  modelCatalog: MODEL_OPTIONS.map((value) => ({
    defaultReasoningEffort: "medium",
    displayName: value,
    isDefault: false,
    model: value,
    supportedReasoningEfforts: [
      { description: "Balanced", reasoningEffort: "medium" },
    ],
  })),
  pairingPayload: loadStoredPairingPayload(),
  preferences: loadPreferences({ accessOptions: ACCESS_OPTIONS, modelOptions: MODEL_OPTIONS, reasoningOptions: REASONING_OPTIONS, speedOptions: SPEED_OPTIONS }),
  rateLimitSummary: "Usage: Unknown",
  relayOverride: loadStoredRelayOverride(),
  searchQuery: "",
  selectedChatId: loadStoredLastThreadId(),
  sidebarOpen: false,
  threadCache: loadStoredThreadCache(),
  mobileThreadOpen: false,
};

const elements = mapElements();
const scanner = createScannerController({ videoElement: elements.scannerVideo });
let refreshTimer = 0;

void init();

async function init() {
  if (await cleanupLegacyAppShell()) {
    return;
  }
  seedLogs();
  wireEvents();
  renderAll();
  if (state.pairingPayload) {
    void connectRelay({ restoreThread: true });
  }
}

function mapElements() {
  return {
    accessSelect: document.querySelector("#access-select"),
    activeTurnCount: document.querySelector("#active-turn-count"),
    deckSummaryCopy: document.querySelector("#deck-summary-copy"),
    deckSummaryStatus: document.querySelector("#deck-summary-status"),
    deckSummaryTitle: document.querySelector("#deck-summary-title"),
    body: document.body,
    branchSelect: document.querySelector("#branch-select"),
    cameraCaptureInput: document.querySelector("#camera-capture-input"),
    clearPairingButton: document.querySelector("#clear-pairing-button"),
    closeScannerButton: document.querySelector("#close-scanner-button"),
    closeSettingsButton: document.querySelector("#close-settings-button"),
    composerInput: document.querySelector("#composer-input"),
    composerStatus: document.querySelector("#composer-status"),
    connectButton: document.querySelector("#connect-button"),
    connectionDot: document.querySelector("#connection-dot"),
    connectionLabel: document.querySelector("#connection-label"),
    connectionMeta: document.querySelector("#connection-meta"),
    createBranchButton: document.querySelector("#create-branch-button"),
    disconnectButton: document.querySelector("#disconnect-button"),
    folderList: document.querySelector("#folder-list"),
    fontSelect: document.querySelector("#font-select"),
    glassToggle: document.querySelector("#glass-toggle"),
    headerScanButton: document.querySelector("#header-scan-button"),
    headerSettingsButton: document.querySelector("#header-settings-button"),
    importFileButton: document.querySelector("#import-file-button"),
    loadPairingButton: document.querySelector("#load-pairing-button"),
    logList: document.querySelector("#log-list"),
    messageList: document.querySelector("#message-list"),
    modelSelect: document.querySelector("#model-select"),
    mobileBackButton: document.querySelector("#mobile-back-button"),
    newChatButton: document.querySelector("#new-chat-button"),
    openScannerButton: document.querySelector("#open-scanner-button"),
    openSettingsButton: document.querySelector("#open-settings-button"),
    pairingFileInput: document.querySelector("#pairing-file-input"),
    pairingJsonInput: document.querySelector("#pairing-json-input"),
    accountChip: document.querySelector("#account-chip"),
    pushStatusLabel: document.querySelector("#push-status-label"),
    rateLimitChip: document.querySelector("#rate-limit-chip"),
    reasoningSelect: document.querySelector("#reasoning-select"),
    relayUrlInput: document.querySelector("#relay-url-input"),
    repoLocationChip: document.querySelector("#repo-location-chip"),
    repoSelect: document.querySelector("#repo-select"),
    scannerImportButton: document.querySelector("#scanner-import-button"),
    scannerModal: document.querySelector("#scanner-modal"),
    scannerStartButton: document.querySelector("#scanner-start-button"),
    scannerStatus: document.querySelector("#scanner-status"),
    scannerVideo: document.querySelector("#scanner-video"),
    searchMeta: document.querySelector("#search-meta"),
    searchInput: document.querySelector("#search-input"),
    sendButton: document.querySelector("#send-button"),
    stageConnectionPill: document.querySelector("#stage-connection-pill"),
    settingsAccessSelect: document.querySelector("#settings-access-select"),
    settingsModelSelect: document.querySelector("#settings-model-select"),
    settingsPanel: document.querySelector("#settings-sheet"),
    settingsReasoningSelect: document.querySelector("#settings-reasoning-select"),
    settingsSpeedSelect: document.querySelector("#settings-speed-select"),
    speedSelect: document.querySelector("#speed-select"),
    summaryDevice: document.querySelector("#summary-device"),
    summaryExpiry: document.querySelector("#summary-expiry"),
    summaryRelay: document.querySelector("#summary-relay"),
    summarySession: document.querySelector("#summary-session"),
    threadAccessValue: document.querySelector("#thread-access-value"),
    threadBranchValue: document.querySelector("#thread-branch-value"),
    threadCount: document.querySelector("#thread-count"),
    threadMessageCount: document.querySelector("#thread-message-count"),
    threadModePill: document.querySelector("#thread-mode-pill"),
    threadRepoLabel: document.querySelector("#thread-repo-label"),
    threadModeChip: document.querySelector("#thread-mode-chip"),
    threadRuntimePill: document.querySelector("#thread-runtime-pill"),
    threadSpotlightCopy: document.querySelector("#thread-spotlight-copy"),
    threadSpotlightKicker: document.querySelector("#thread-spotlight-kicker"),
    threadSpotlightTitle: document.querySelector("#thread-spotlight-title"),
    threadSubtitle: document.querySelector("#thread-subtitle"),
    threadSyncValue: document.querySelector("#thread-sync-value"),
    threadTitle: document.querySelector("#thread-title"),
    workspaceCount: document.querySelector("#workspace-count"),
  };
}

function wireEvents() {
  elements.searchInput.addEventListener("input", (event) => { state.searchQuery = event.target.value.trim().toLowerCase(); renderSidebar(); });
  elements.newChatButton.addEventListener("click", () => { void createChat(); });
  elements.createBranchButton.addEventListener("click", createBranch);
  elements.sendButton.addEventListener("click", sendMessage);
  elements.composerInput.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void sendMessage(); } });
  elements.repoSelect.addEventListener("change", (event) => mutateSelectedChat(async (chat) => {
    const nextRepo = event.target.value;
    const repoInfo = representativeThreadInfo(nextRepo);
    chat.repo = nextRepo;
    chat.branch = repoInfo?.branch || (REPOSITORY_BRANCHES[nextRepo] || ["main"])[0];
    chat.cwd = repoInfo?.cwd || chat.cwd || null;
    chat.originUrl = repoInfo?.originUrl || chat.originUrl || null;
    await syncThreadMetadata(chat);
    await refreshBranchCatalog(chat);
  }));
  elements.branchSelect.addEventListener("change", (event) => mutateSelectedChat(async (chat) => {
    chat.branch = event.target.value;
    await switchGitBranch(chat, event.target.value);
    await syncThreadMetadata(chat);
  }));
  elements.accessSelect.addEventListener("change", (event) => mutateSelectedChat((chat) => { chat.access = event.target.value; state.preferences.access = event.target.value; persistPreferences(); }));
  bindPreferenceSelect(elements.modelSelect, "model");
  bindPreferenceSelect(elements.reasoningSelect, "reasoning");
  bindPreferenceSelect(elements.speedSelect, "speed");
  bindPreferenceSelect(elements.settingsModelSelect, "model");
  bindPreferenceSelect(elements.settingsReasoningSelect, "reasoning");
  bindPreferenceSelect(elements.settingsSpeedSelect, "speed");
  bindPreferenceSelect(elements.settingsAccessSelect, "access");
  elements.fontSelect.addEventListener("change", (event) => updatePreference("font", event.target.value));
  elements.glassToggle.addEventListener("change", (event) => updatePreference("glass", event.target.checked));
  elements.openSettingsButton.addEventListener("click", openSettings);
  elements.headerSettingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.settingsPanel.addEventListener("click", (event) => { if (event.target === elements.settingsPanel) { closeSettings(); } });
  elements.openScannerButton.addEventListener("click", openScanner);
  elements.headerScanButton.addEventListener("click", openScanner);
  elements.closeScannerButton.addEventListener("click", closeScanner);
  elements.scannerModal.addEventListener("click", (event) => { if (event.target === elements.scannerModal) { closeScanner(); } });
  elements.scannerStartButton.addEventListener("click", startScanner);
  elements.scannerImportButton.addEventListener("click", () => elements.pairingFileInput.click());
  elements.cameraCaptureInput.addEventListener("change", importPairingFile);
  elements.importFileButton.addEventListener("click", () => elements.pairingFileInput.click());
  elements.pairingFileInput.addEventListener("change", importPairingFile);
  elements.loadPairingButton.addEventListener("click", loadPairingFromTextarea);
  elements.clearPairingButton.addEventListener("click", clearPairing);
  elements.relayUrlInput.addEventListener("change", (event) => { state.relayOverride = event.target.value.trim(); saveStoredRelayOverride(state.relayOverride); addLog("info", "Updated relay base URL.", state.relayOverride || "inferred"); renderConnection(); });
  elements.connectButton.addEventListener("click", connectRelay);
  elements.disconnectButton.addEventListener("click", () => void disconnectRelay(false));
  elements.mobileBackButton.addEventListener("click", () => {
    state.mobileThreadOpen = false;
    renderBody();
  });
}

function renderAll() {
  renderBody();
  renderSelects();
  renderSidebar();
  renderDeckSummary();
  renderConversation();
  renderPairing();
  renderConnection();
  renderRuntimeStrip();
  renderSettings();
  renderLogs();
}

function renderBody() {
  elements.body.classList.toggle("sidebar-open", state.sidebarOpen);
  elements.body.classList.toggle("mobile-thread-open", state.mobileThreadOpen && isNarrowViewport());
  elements.body.classList.toggle("font-rounded", state.preferences.font === "rounded");
  elements.body.classList.toggle("no-glass", state.preferences.glass === false);
}

function renderSelects() {
  const activeChat = selectedChat();
  const modelEntries = modelCatalogWithThreadRuntime(activeChat);
  const modelOptions = modelEntries.map((entry) => ({
    label: entry.displayName,
    value: entry.model,
  }));
  const reasoningOptions = currentReasoningOptions(activeChat, modelEntries);

  setOptionEntries(elements.modelSelect, modelOptions, state.preferences.model);
  setOptionEntries(elements.reasoningSelect, reasoningOptions, state.preferences.reasoning);
  setOptions(elements.speedSelect, SPEED_OPTIONS, state.preferences.speed);
  setOptionEntries(elements.settingsModelSelect, modelOptions, state.preferences.model);
  setOptionEntries(elements.settingsReasoningSelect, reasoningOptions, state.preferences.reasoning);
  setOptions(elements.settingsSpeedSelect, SPEED_OPTIONS, state.preferences.speed);
  setOptions(elements.settingsAccessSelect, ACCESS_OPTIONS, state.preferences.access);
  setOptions(elements.repoSelect, state.conversations.map((group) => group.folder));
}

function renderSidebar() {
  const fragment = document.createDocumentFragment();
  const allChats = flattenChats(state.conversations);
  let visibleThreadCount = 0;
  let visibleWorkspaceCount = 0;
  let hasChats = false;
  for (const group of state.conversations) {
    const chats = group.chats.filter((chat) => [chat.title, chat.snippet, chat.repo].join(" ").toLowerCase().includes(state.searchQuery));
    if (!chats.length) {
      continue;
    }
    hasChats = true;
    visibleThreadCount += chats.length;
    visibleWorkspaceCount += 1;
    const section = document.createElement("section");
    section.className = "folder-section";
    section.innerHTML = '<div class="folder-heading"><div class="folder-label"><span class="folder-icon" aria-hidden="true"></span><span></span></div><button class="folder-plus" type="button">+ Thread</button></div><div class="chat-list"></div>';
    section.querySelector(".folder-label span:last-child").textContent = group.folder;
    section.querySelector(".folder-plus").addEventListener("click", () => { void createChat(group.folder); });
    const list = section.querySelector(".chat-list");
    for (const chat of chats) {
      const button = document.createElement("button");
      button.type = "button";
      const isActive = chat.id === state.selectedChatId;
      const isPending = chatHasPendingTurn(chat);
      button.className = `chat-item${isActive ? " is-active" : ""}${isPending ? " is-pending" : ""}`;
      button.innerHTML = `
        <div class="chat-item-head">
          <span class="chat-item-title">${escapeHTML(chat.title)}</span>
          <span class="chat-item-timestamp">${escapeHTML(chat.timestamp)}</span>
        </div>
        <div class="chat-item-meta">
          <span class="chat-item-snippet">${escapeHTML(chat.snippet)}</span>
          <span class="chat-item-dot${isPending ? " chat-item-dot-live" : ""}"${isActive || isPending ? "" : " hidden"}></span>
        </div>
        <div class="chat-item-tags">
          <span class="chat-item-tag">${escapeHTML(chat.branch || "main")}</span>
          <span class="chat-item-tag">${escapeHTML(sidebarModeLabel(chat))}</span>
          ${isPending ? '<span class="chat-item-tag chat-item-tag-live">Running</span>' : ""}
        </div>
      `;
      button.addEventListener("click", () => {
        state.selectedChatId = chat.id;
        applyThreadRuntimeToPreferences(chat);
        state.sidebarOpen = false;
        if (isNarrowViewport()) {
          state.mobileThreadOpen = true;
        }
        renderAll();
        if (chat.threadId && !chat.messagesLoaded) {
          void readRemoteThread(chat.threadId);
        }
      });
      list.append(button);
    }
    fragment.append(section);
  }
  if (!hasChats) {
    const emptyState = document.createElement("section");
    emptyState.className = "empty-panel";
    emptyState.innerHTML = `
      <p class="empty-kicker">${state.searchQuery ? "No Matches" : "No Chats Yet"}</p>
      <h3>${state.searchQuery ? "Try a broader search term" : "Connect the bridge to load your real threads"}</h3>
      <p>${state.searchQuery
    ? `No threads matched "${state.searchQuery}". Search by repo, thread title, or the latest snippet.`
    : "Pair the browser client, then your actual Remodex thread list will appear here instead of demo content."}</p>
    `;
    fragment.append(emptyState);
  }
  elements.folderList.replaceChildren(fragment);
  elements.searchMeta.textContent = state.searchQuery
    ? `${visibleThreadCount} result${visibleThreadCount === 1 ? "" : "s"} across ${visibleWorkspaceCount} workspace${visibleWorkspaceCount === 1 ? "" : "s"}`
    : `${allChats.length} thread${allChats.length === 1 ? "" : "s"} across ${state.conversations.length} workspace${state.conversations.length === 1 ? "" : "s"}`;
}

function renderConversation() {
  const chat = selectedChat();
  renderComposerState(chat);
  elements.messageList.setAttribute("aria-busy", chatHasPendingTurn(chat) ? "true" : "false");
  if (!chat) {
    elements.threadRepoLabel.textContent = "Remodex";
    elements.threadTitle.textContent = "No thread selected";
    elements.threadSubtitle.textContent = "Connect the relay and pick a real thread from the chat list.";
    renderThreadModeChip(null);
    renderThreadSpotlight(null);
    elements.messageList.innerHTML = `
      <section class="empty-panel empty-panel-conversation">
        <p class="empty-kicker">Conversation</p>
        <h3>Real threads show up here</h3>
        <p>Once the browser client connects and loads your thread list, the latest thread opens here by default.</p>
      </section>
    `;
    return;
  }
  elements.threadRepoLabel.textContent = chat.repo;
  elements.threadTitle.textContent = chat.title;
  elements.threadSubtitle.textContent = `${describeThreadMode(chat)} | Branch ${chat.branch} | ${chat.access} | ${state.connection.label}`;
  renderThreadModeChip(chat);
  renderThreadSpotlight(chat);
  const branchOptions = state.branchCatalog.length ? state.branchCatalog : (REPOSITORY_BRANCHES[chat.repo] || [chat.branch || "main"]);
  setOptions(elements.branchSelect, branchOptions, chat.branch);
  elements.repoSelect.value = chat.repo;
  elements.accessSelect.value = chat.access;
  persistLastThreadId(chat.id);

  const fragment = document.createDocumentFragment();
  for (const message of chat.messages) {
    const card = document.createElement("article");
    const originClass = `message-origin-${message.origin || "unknown"}`;
    const kindClass = message.kind ? `message-kind-${message.kind}` : "";
    const pendingClass = message.pending ? "is-pending" : "";
    card.className = `message-card ${message.role === "user" ? "user" : "assistant"} ${originClass} ${kindClass} ${pendingClass}`.trim();
    card.innerHTML = `<div class="message-meta"><span>${escapeHTML(message.author)}</span><span>|</span><span>${escapeHTML(message.time)}</span><span class="message-origin-badge ${originBadgeClass(message.origin)}">${escapeHTML(originBadgeLabel(message.origin))}</span></div><div class="message-bubble"></div>`;
    renderMessageBubble(card.querySelector(".message-bubble"), message);
    fragment.append(card);
  }
  elements.messageList.replaceChildren(fragment);
  scrollConversationToBottom();
}

function renderPairing() {
  elements.pairingJsonInput.value = state.pairingPayload ? JSON.stringify(state.pairingPayload, null, 2) : "";
  elements.relayUrlInput.value = state.relayOverride || state.pairingPayload?.relay || inferRelayBaseUrl(window.location);
  if (!state.pairingPayload) {
    elements.summarySession.textContent = "Not loaded";
    elements.summaryRelay.textContent = "Not loaded";
    elements.summaryDevice.textContent = "Not loaded";
    elements.summaryExpiry.textContent = "Not loaded";
    return;
  }
  const summary = describePairingPayload(state.pairingPayload);
  elements.summarySession.textContent = summary.session;
  elements.summaryRelay.textContent = summary.relay;
  elements.summaryDevice.textContent = summary.macDeviceId;
  elements.summaryExpiry.textContent = summary.expiresAt;
}

function renderConnection() {
  elements.connectionLabel.textContent = state.connection.label;
  elements.connectionMeta.textContent = state.pairingPayload
    ? `${state.connection.detail} Session ${truncate(state.pairingPayload.sessionId, 18)} | ${truncate(state.relayOverride || state.pairingPayload.relay, 34)}`
    : state.connection.detail;
  elements.connectionDot.className = "connection-dot";
  elements.connectionDot.classList.add(`state-${state.connection.status}`);
  elements.composerStatus.textContent = state.connection.label;
  if (elements.stageConnectionPill) {
    elements.stageConnectionPill.className = `stage-pill stage-pill-${state.connection.status}`;
    elements.stageConnectionPill.textContent = state.connection.label;
  }
  renderDeckSummary();
  renderThreadSpotlight(selectedChat());
}

function renderRuntimeStrip() {
  const chat = selectedChat();
  const repoLocation = chat?.cwd ? "Repo: Local" : "Repo: Cloud";
  elements.repoLocationChip.textContent = repoLocation;
  elements.rateLimitChip.textContent = state.rateLimitSummary;
  elements.accountChip.textContent = state.accountSummary;
}

function renderDeckSummary() {
  const allChats = flattenChats(state.conversations);
  const connected = state.connection.status === "ready";
  const workspaceCount = state.conversations.filter((group) => (group.chats || []).length > 0).length;
  const activeTurnCount = allChats.filter((chat) => chatHasPendingTurn(chat)).length;

  elements.workspaceCount.textContent = String(workspaceCount);
  elements.threadCount.textContent = String(allChats.length);
  elements.activeTurnCount.textContent = String(activeTurnCount);
  elements.deckSummaryTitle.textContent = connected
    ? "Relay connected"
    : (state.pairingPayload ? "Pairing loaded locally" : "Pair the browser shell");
  elements.deckSummaryCopy.textContent = connected
    ? "Live threads and repo context are flowing into the browser deck. Pick a thread and continue from here."
    : (state.pairingPayload
      ? "Pairing exists in local storage. Reconnect when you want the live thread list and runtime summaries back."
      : "Load pairing JSON or scan a QR code to pull live Remodex threads into this browser workspace.");
  elements.deckSummaryStatus.className = `deck-summary-status deck-summary-status-${state.connection.status}`;
}

function renderThreadSpotlight(chat) {
  if (!chat) {
    elements.threadSpotlightKicker.textContent = "No active thread";
    elements.threadSpotlightTitle.textContent = "Choose a chat or start a local draft";
    elements.threadSpotlightCopy.textContent = "Pair the browser client, then open a thread to see repo context, runtime mode, and live bridge status here.";
    elements.threadModePill.textContent = "No Thread";
    elements.threadRuntimePill.textContent = "Cloud runtime";
    elements.threadMessageCount.textContent = "0";
    elements.threadBranchValue.textContent = "Unknown";
    elements.threadAccessValue.textContent = "Unknown";
    elements.threadSyncValue.textContent = "Waiting";
    return;
  }

  elements.threadSpotlightKicker.textContent = chat.repo || "Workspace";
  elements.threadSpotlightTitle.textContent = describeThreadMode(chat);
  elements.threadSpotlightCopy.textContent = chat.cwd
    ? `Working tree attached at ${truncate(chat.cwd, 78)}. ${state.connection.detail}`
    : (chat.originUrl
      ? `Repo context is linked to ${truncate(chat.originUrl, 78)}. ${state.connection.detail}`
      : `This thread is running without a local repo path in the browser shell. ${state.connection.detail}`);
  elements.threadModePill.textContent = threadModeChipLabel(messageOriginForChat(chat));
  elements.threadRuntimePill.textContent = chat.cwd ? "Local workspace" : "Cloud runtime";
  elements.threadMessageCount.textContent = String(chat.messages?.length || 0);
  elements.threadBranchValue.textContent = chat.branch || "Unknown";
  elements.threadAccessValue.textContent = chat.access || "Unknown";
  elements.threadSyncValue.textContent = chatHasPendingTurn(chat) ? "Running turn" : (chat.timestamp || state.connection.label);
}

function renderComposerState(chat) {
  const hasPendingTurn = chatHasPendingTurn(chat);
  const isSharedView = messageOriginForChat(chat) === "shared";
  elements.sendButton.disabled = !chat || hasPendingTurn;
  elements.sendButton.dataset.loading = hasPendingTurn ? "true" : "false";
  elements.sendButton.setAttribute("aria-busy", hasPendingTurn ? "true" : "false");
  elements.sendButton.textContent = hasPendingTurn ? "Running..." : (!chat ? "Select Chat" : (isSharedView ? "Fork & Send" : "Send"));
  elements.composerInput.placeholder = !chat
    ? "Choose a chat or create a local draft to start sending."
    : (hasPendingTurn
      ? "Wait for the current turn to finish before sending another prompt."
      : (isSharedView
        ? "This shared thread is read-only here. Sending will fork into an isolated web thread."
        : "Ask anything... @files, $skills, /commands"));
}

function renderSettings() {
  elements.fontSelect.value = state.preferences.font;
  elements.glassToggle.checked = state.preferences.glass;
  const pushCapability = state.capabilities.items.find((item) => item.label === "Web Push");
  elements.pushStatusLabel.textContent = pushCapability && pushCapability.detail.includes("exist") ? "Supported" : "Unavailable";
}

function renderLogs() {
  const fragment = document.createDocumentFragment();
  for (const entry of state.logs) {
    const item = document.createElement("li");
    item.innerHTML = `<span class="event-level ${entry.level}">${entry.level}</span><div class="event-copy"></div><div class="event-meta">${escapeHTML(entry.meta)}</div>`;
    item.querySelector(".event-copy").textContent = entry.message;
    fragment.append(item);
  }
  elements.logList.replaceChildren(fragment);
}

function seedLogs() {
  addLog("info", "Web deck initialized.", "UI shell ready");
  if (state.pairingPayload) {
    state.connection = { detail: "Pairing restored from local storage.", label: "Pairing loaded", status: "warning" };
    addLog("info", "Restored pairing payload from local storage.", state.pairingPayload.sessionId);
  }
  if (state.relayOverride) {
    addLog("info", "Restored relay override.", state.relayOverride);
  }
}

async function createChat(folderName = selectedChat()?.repo || state.conversations[0]?.folder) {
  const draftChat = createLocalChat(folderName, { render: false });

  if (!state.client) {
    addLog("info", "Created a local draft thread.", folderName || "Workspace");
    renderAll();
    return draftChat;
  }

  try {
    const threadResponse = await state.client.startThread(buildThreadStartParams(draftChat));
    adoptRemoteThreadForChat(draftChat, threadResponse.thread);
    draftChat.writable = true;
    persistThreadCacheForChat(draftChat);
    addLog("info", "Started a new remote thread.", draftChat.id);
    await refreshThreadList(draftChat.threadId);
    return findChatByThreadId(draftChat.threadId) || draftChat;
  } catch (error) {
    addLog("warn", "Fell back to a local draft because thread/start failed.", error.message || "thread/start");
    renderAll();
    return draftChat;
  }
}

function createLocalChat(folderName = selectedChat()?.repo || state.conversations[0]?.folder, { render = true } = {}) {
  const fallbackGroup = state.conversations[0] || {
    folder: folderName || "Workspace",
    chats: [],
  };
  if (!state.conversations.length) {
    state.conversations.push(fallbackGroup);
  }
  const group = state.conversations.find((candidate) => candidate.folder === folderName) || fallbackGroup;
  const chat = {
    id: `local-${Date.now()}`,
    title: "New Chat",
    snippet: "Start a new thread in the browser shell.",
    timestamp: "now",
    repo: group.folder,
    branch: (REPOSITORY_BRANCHES[group.folder] || ["main"])[0],
    access: state.preferences.access,
    writable: true,
    messages: [
      {
        role: "assistant",
        author: "Codex",
        origin: "local",
        time: "now",
        text: state.client
          ? "This is a local draft thread. The first send will create a real remote thread."
          : "Pair and connect the relay first, then the first send will create a real remote thread.",
      },
    ],
  };
  group.chats.unshift(chat);
  state.selectedChatId = chat.id;
  if (isNarrowViewport()) {
    state.mobileThreadOpen = true;
  }
  if (render) {
    addLog("info", "Created a new local draft thread.", group.folder);
    renderAll();
  }
  return chat;
}

async function sendMessage() {
  const chat = selectedChat();
  const text = elements.composerInput.value.trim();
  if (!chat || !text) {
    return;
  }

  if (chatHasPendingTurn(chat)) {
    addLog("warn", "Wait for the current turn to finish before sending again.", "pending turn");
    renderLogs();
    return;
  }

  chat.messages.push({ id: `local-user-${Date.now()}`, role: "user", author: "You", origin: "web", time: "now", text });
  chat.messages.push({ id: `pending-${Date.now()}`, pending: true, role: "assistant", author: "Codex", origin: "web", time: "pending", text: "Sending to Codex..." });
  chat.snippet = text;
  chat.timestamp = "now";
  chat.access = elements.accessSelect.value;
  elements.composerInput.value = "";
  persistThreadCacheForChat(chat);
  renderAll();

  if (!state.client) {
    addLog("warn", "Send stayed local because the browser client is not connected.", "local only");
    renderLogs();
    return;
  }

  try {
    if (!chat.threadId) {
      const threadResponse = await state.client.startThread(buildThreadStartParams(chat));
      adoptRemoteThreadForChat(chat, threadResponse.thread);
      chat.writable = true;
      persistThreadCacheForChat(chat);
      await refreshThreadList(chat.threadId);
    } else if (shouldForkThreadForSend(chat, state.bridgeActiveThreadId)) {
      const forkResponse = await state.client.forkThread(buildThreadForkParams(chat));
      adoptRemoteThreadForChat(chat, forkResponse.thread);
      chat.writable = true;
      persistThreadCacheForChat(chat);
      addLog("info", "Forked shared thread into an isolated web thread.", chat.id);
      await refreshThreadList(chat.threadId);
    }

    addLog("info", "Started a real remote turn.", truncate(text, 42));
    renderLogs();
    state.connection = { detail: "Turn submitted. Waiting for turn notifications and refreshed thread state.", label: "Running turn", status: "ready" };
    renderConnection();

    await state.client.startTurn(buildTurnStartParams({
      chat,
      text,
      preferences: state.preferences,
    }));

    await pollThreadUntilSettled(chat.threadId);
  } catch (error) {
    chat.messages = chat.messages.filter((message) => !message.pending);
    addLog("error", error.message || "Failed to send the turn.", "turn/start");
    persistThreadCacheForChat(chat);
    renderLogs();
  }
}

function loadPairingFromTextarea() {
  try {
    applyPairing(parsePairingPayload(elements.pairingJsonInput.value), "Loaded pairing payload from settings.");
    closeScanner();
  } catch (error) {
    addLog("error", error.message || "Failed to parse pairing payload.", "settings");
    renderLogs();
  }
}

async function importPairingFile(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }
  try {
    setScannerStatus(`Reading ${file.name}...`);
    await applyPairing(
      await decodePairingPayloadFromFile(file, window),
      `Imported pairing from ${file.name}.`,
      { autoConnect: true }
    );
  } catch (error) {
    setScannerStatus(error.message || "Import failed.");
    addLog("error", error.message || "Could not decode the selected file.", file.name);
    renderLogs();
  } finally {
    event.target.value = "";
  }
}

function clearPairing() {
  void disconnectRelay(true);
  state.pairingPayload = null;
  clearStoredPairingPayload();
  state.connection = { detail: "Pairing payload cleared from browser storage.", label: "Waiting for pairing", status: "warning" };
  addLog("warn", "Cleared the stored pairing payload.", "browser storage");
  renderAll();
}

function openSettings() {
  openModal(elements.settingsPanel);
}

function closeSettings() {
  closeModal(elements.settingsPanel);
}

function openScanner() {
  openModal(elements.scannerModal);
  elements.scannerStatus.textContent = state.capabilities.secureContext
    ? "Use the rear camera or import a QR image."
    : "This page needs HTTPS or localhost for camera access.";
}

function closeScanner() {
  scanner.stop();
  closeModal(elements.scannerModal);
}

async function startScanner() {
  if (!state.capabilities.secureContext) {
    setScannerStatus("Camera access requires HTTPS or localhost.");
    addLog("warn", "Scanner blocked because the page is not in a secure context.", "camera");
    renderLogs();
    return;
  }

  setScannerStatus("Requesting camera permission...");
  try {
    scanner.stop();
    await scanner.start({
      async onDetect(rawValue) {
        try {
          setScannerStatus("QR detected. Loading pairing...");
          await applyPairing(
            parsePairingPayload(rawValue),
            "Captured pairing payload from the live scanner.",
            { autoConnect: true }
          );
        } catch (error) {
          setScannerStatus(error.message || "Failed to connect after scanning.");
          addLog("error", error.message || "Failed to connect after scanning.", "scanner");
          renderLogs();
        }
      },
      onError(error) {
        setScannerStatus(error.message || "Camera scan failed.");
        addLog("error", "Camera scan failed.", error.message || "scanner");
        renderLogs();
      },
      onStatus(statusText) {
        setScannerStatus(statusText);
      },
    });
    addLog("info", "Started the camera scanner.", "scanner");
    renderLogs();
  } catch (error) {
    setScannerStatus(`${error.message || "Could not start the camera."} Safari can still use the camera-photo fallback.`);
    addLog("error", "Failed to start the camera scanner.", error.message || "scanner");
    if (elements.cameraCaptureInput) {
      window.setTimeout(() => {
        elements.cameraCaptureInput.click();
      }, 50);
    }
    renderLogs();
  }
}

async function connectRelay({ restoreThread = false } = {}) {
  if (!state.pairingPayload) {
    openScanner();
    addLog("warn", "Open the scanner or load pairing JSON before connecting.", "relay");
    renderLogs();
    return;
  }

  await disconnectRelay(true);
  const relayBaseUrl = state.relayOverride || state.pairingPayload.relay || inferRelayBaseUrl(window.location);
  state.client = createBrowserBridgeClient({
    pairingPayload: state.pairingPayload,
    relayBaseUrl,
    onApplicationMessage() {},
    onConnectionState(connectionState) {
      state.connection = connectionState;
      if (elements.scannerModal.classList.contains("is-open")) {
        setScannerStatus(`${connectionState.label}: ${connectionState.detail}`);
      }
      renderConnection();
    },
    onLog(level, message, meta) {
      addLog(level, message, meta);
      renderLogs();
    },
    onNotification(notification) {
      handleNotification(notification);
    },
  });

  try {
    addLog("info", "Connecting to relay.", relayBaseUrl);
    renderLogs();
    await state.client.connect();
    const activeThreadResult = await state.client.readActiveThread().catch(() => null);
    state.bridgeActiveThreadId = activeThreadResult?.thread?.threadId || null;
    await refreshThreadList(
      restoreThread
        ? (loadStoredLastThreadId() || state.bridgeActiveThreadId)
        : (state.selectedChatId || state.bridgeActiveThreadId)
    );
    void refreshModelCatalog().catch((error) => {
      addLog("warn", "Could not load the model catalog yet.", error.message || "model/list");
      renderLogs();
    });
    void refreshRuntimeSummaries().catch((error) => {
      addLog("warn", "Could not load account or rate limit metadata yet.", error.message || "account");
      renderLogs();
    });
  } catch (error) {
    state.connection = { detail: error.message || "Failed to initialize the browser client.", label: "Connect failed", status: "error" };
    addLog("error", error.message || "Failed to initialize the browser client.", "connect");
    renderConnection();
    renderLogs();
  }
}

async function disconnectRelay(silent) {
  if (state.client) {
    await state.client.disconnect();
    state.client = null;
  }
  if (!silent) {
    state.connection = {
      detail: state.pairingPayload ? "Pairing is still loaded locally." : "Load pairing again to reconnect.",
      label: state.pairingPayload ? "Disconnected" : "Waiting for pairing",
      status: "warning",
    };
    addLog("warn", "Disconnected the relay socket.", "manual");
    renderConnection();
    renderLogs();
  }
}

async function applyPairing(payload, note, { autoConnect = false } = {}) {
  state.pairingPayload = payload;
  saveStoredPairingPayload(payload);
  if (!state.relayOverride) {
    state.relayOverride = payload.relay;
    saveStoredRelayOverride(payload.relay);
  }
  state.connection = {
    detail: autoConnect
      ? "Pairing loaded. Connecting the relay socket automatically."
      : "Pairing loaded. You can now connect the relay socket from the sidebar footer.",
    label: "Pairing loaded",
    status: "warning",
  };
  addLog("info", note, payload.sessionId);
  renderAll();
  if (autoConnect) {
    await connectRelay();
    if (state.connection.status === "ready") {
      scanner.stop();
      closeModal(elements.scannerModal);
    }
  }
}

function updatePreference(key, value) {
  state.preferences[key] = value;
  persistPreferences();
  renderAll();
}

function bindPreferenceSelect(select, key) {
  select.addEventListener("change", (event) => updatePreference(key, event.target.value));
}

function persistPreferences() {
  savePreferences(state.preferences);
}

async function mutateSelectedChat(mutate) {
  const chat = selectedChat();
  if (!chat) {
    return;
  }
  await mutate(chat);
  renderAll();
}

async function syncThreadMetadata(chat) {
  if (!state.client || !chat?.threadId) {
    return;
  }

  try {
    const result = await state.client.updateThreadMetadata(chat.threadId, {
      branch: chat.branch || null,
      originUrl: chat.originUrl || null,
    });
    chat.branch = result.thread.gitInfo?.branch || chat.branch;
    chat.originUrl = result.thread.gitInfo?.originUrl || chat.originUrl;
  } catch (error) {
    addLog("error", error.message || "Failed to sync thread metadata.", "thread/metadataUpdate");
    renderLogs();
  }
}

function selectedChat() {
  for (const group of state.conversations) {
    const chat = group.chats.find((candidate) => candidate.id === state.selectedChatId);
    if (chat) {
      return chat;
    }
  }
  return null;
}

async function refreshThreadList(preferredThreadId = state.selectedChatId) {
  if (!state.client) {
    return;
  }
  const existingChats = flattenChats(state.conversations);
  const result = await state.client.listThreads({ archived: false, limit: 100, sortKey: "updated_at" });
  state.conversations = mergeConversations(groupRemoteThreads(result.data), existingChats);
  if (preferredThreadId && findChatByThreadId(preferredThreadId)) {
    state.selectedChatId = preferredThreadId;
  } else if (state.conversations[0]?.chats[0]) {
    state.selectedChatId = state.conversations[0].chats[0].id;
  }
  if (state.selectedChatId) {
    persistLastThreadId(state.selectedChatId);
  }
  applyThreadRuntimeToPreferences(selectedChat());
  renderAll();
  const chat = selectedChat();
  if (chat?.threadId) {
    await readRemoteThread(chat.threadId);
    await refreshBranchCatalog(chat);
  }
}

async function refreshModelCatalog() {
  if (!state.client) {
    return;
  }

  const response = await state.client.listModels();
  const visibleModels = (response.data || []).filter((entry) => !entry.hidden);
  if (!visibleModels.length) {
    return;
  }

  state.modelCatalog = visibleModels;
  const currentModel = visibleModels.find((entry) => entry.model === state.preferences.model) || visibleModels.find((entry) => entry.isDefault) || visibleModels[0];
  state.preferences.model = currentModel.model;
  const supportedEfforts = currentModel.supportedReasoningEfforts.map((entry) => entry.reasoningEffort);
  state.preferences.reasoning = supportedEfforts.includes(state.preferences.reasoning)
    ? state.preferences.reasoning
    : currentModel.defaultReasoningEffort;
  persistPreferences();
  renderSelects();
}

async function readRemoteThread(threadId) {
  if (!state.client) {
    return;
  }
  const result = await state.client.readThread(threadId);
  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }
  hydrateChatFromThread(chat, result.thread);
  await refreshThreadRuntime(chat);
  renderAll();
  await refreshBranchCatalog(chat);
}

async function refreshThreadRuntime(chat) {
  if (!state.client || !chat?.threadId) {
    return;
  }

  try {
    const result = await state.client.readThreadRuntime(chat.threadId);
    const runtime = result?.runtime || null;
    if (!runtime) {
      return;
    }

    chat.model = runtime.model || chat.model || null;
    chat.reasoning = runtime.effort || chat.reasoning || null;

    if (selectedChat()?.id === chat.id) {
      applyThreadRuntimeToPreferences(chat);
      renderSelects();
    }

    persistThreadCacheForChat(chat);
  } catch (error) {
    addLog("warn", "Could not read thread runtime settings.", error.message || "thread/runtime/read");
    renderLogs();
  }
}

function applyThreadRuntimeToPreferences(chat) {
  if (!chat) {
    return;
  }
  if (chat.model) {
    state.preferences.model = chat.model;
  }
  if (chat.reasoning) {
    state.preferences.reasoning = chat.reasoning;
  }
}

async function pollThreadUntilSettled(threadId, attemptsRemaining = 10) {
  if (!threadId || !state.client) {
    return;
  }

  const result = await state.client.readThread(threadId);
  const chat = findChatByThreadId(threadId);
  if (chat) {
    hydrateChatFromThread(chat, result.thread);
    renderAll();
  }

  const latestTurn = result.thread?.turns?.[result.thread.turns.length - 1];
  if (!latestTurn || latestTurn.status !== "inProgress" || attemptsRemaining <= 1) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 900));
  await pollThreadUntilSettled(threadId, attemptsRemaining - 1);
}

function handleNotification(notification) {
  const method = typeof notification.method === "string" ? notification.method : "";
  if (!method) {
    return;
  }

  if (method === "account/rateLimits/updated") {
    state.rateLimitSummary = summarizeRateLimits({ rateLimits: notification.params?.rateLimits });
    renderRuntimeStrip();
    return;
  }

  if (method === "item/agentMessage/delta") {
    applyAgentDeltaNotification(notification.params);
    return;
  }

  if (method === "item/reasoning/textDelta" || method === "item/reasoning/summaryTextDelta") {
    applyReasoningDeltaNotification(notification.params, method);
    return;
  }

  if (method === "commandExecution/outputDelta") {
    applyCommandOutputDeltaNotification(notification.params);
    return;
  }

  if (method === "codex/event/user_message") {
    applyCodexUserMessageNotification(notification.params);
    return;
  }

  if (method === "codex/event/agent_message") {
    applyCodexAgentMessageNotification(notification.params);
    return;
  }

  if (method === "codex/event/background_event") {
    applyBackgroundEventNotification(notification.params);
    return;
  }

  if (method === "codex/event/exec_command_begin") {
    applyExecCommandBeginNotification(notification.params);
    return;
  }

  if (method === "codex/event/exec_command_output_delta") {
    applyExecCommandOutputNotification(notification.params);
    return;
  }

  if (method === "codex/event/exec_command_end") {
    applyExecCommandEndNotification(notification.params);
    return;
  }

  if (method === "item/started") {
    applyStartedItemNotification(notification.params);
    return;
  }

  if (method === "item/completed") {
    applyCompletedItemNotification(notification.params);
    return;
  }

  if (method === "turn/completed") {
    const threadId = notification.params?.threadId || notification.params?.thread?.id || notification.params?.thread?.threadId;
    if (threadId) {
      const chat = findChatByThreadId(threadId);
      if (chat) {
        chat.messages = chat.messages.filter((message) => !message.pending);
        persistThreadCacheForChat(chat);
      }
    }
  }

  if (method === "turn/started") {
    const threadId = notification.params?.threadId || notification.params?.thread?.id || notification.params?.thread?.threadId;
    if (threadId) {
      const chat = findChatByThreadId(threadId);
      if (chat) {
        const pendingMessage = [...chat.messages].reverse().find((message) => message.pending);
        if (pendingMessage) {
          pendingMessage.text = "Sent. Codex started the turn.";
          pendingMessage.time = "started";
          persistThreadCacheForChat(chat);
          if (selectedChat()?.id === chat.id) {
            renderConversation();
          }
        }
      }
    }
  }

  addLog("info", `Received ${method}.`, "notification");
  renderLogs();

  if (method === "turn/completed" || method.startsWith("thread/")) {
    const threadId = notification.params?.threadId || notification.params?.thread?.id || notification.params?.thread?.threadId;
    scheduleRefresh(threadId || selectedChat()?.threadId || null);
  }
}

function scheduleRefresh(threadId) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    if (threadId) {
      void refreshThreadList(threadId);
      return;
    }
    void refreshThreadList();
  }, 400);
}

async function refreshRuntimeSummaries() {
  if (!state.client) {
    return;
  }

  try {
    const [accountResult, rateLimitResult] = await Promise.all([
      state.client.readAccount(),
      state.client.readRateLimits(),
    ]);
    state.accountSummary = summarizeAccount(accountResult);
    state.rateLimitSummary = summarizeRateLimits(rateLimitResult);
    renderRuntimeStrip();
  } catch (error) {
    addLog("warn", "Could not load account or rate limit metadata.", error.message || "account");
    renderLogs();
  }
}

async function refreshBranchCatalog(chat) {
  if (!state.client || !chat?.cwd) {
    state.branchCatalog = [];
    renderSelects();
    return;
  }

  try {
    const branchResult = await state.client.gitBranchesWithStatus(chat.cwd);
    state.branchCatalog = branchResult.branches || [];
    if (!chat.branch && branchResult.current) {
      chat.branch = branchResult.current;
    }
    renderSelects();
  } catch (error) {
    addLog("warn", "Could not load git branches for the current repo.", error.message || "git/branchesWithStatus");
    renderLogs();
  }
}

async function switchGitBranch(chat, branch) {
  if (!state.client || !chat?.cwd || !branch) {
    return;
  }

  try {
    const result = await state.client.gitCheckout(chat.cwd, branch);
    chat.branch = result.current || branch;
    addLog("info", "Checked out git branch.", chat.branch);
    renderLogs();
  } catch (error) {
    addLog("error", error.message || "Failed to switch git branch.", "git/checkout");
    renderLogs();
  }
}

function groupRemoteThreads(threads) {
  return groupRemoteThreadsModel({
    threads,
    repoLabelFromThread,
    threadToChat,
  });
}

function mergeConversations(remoteConversations, existingChats) {
  return mergeConversationsModel({
    remoteConversations,
    existingChats,
    cloneConversations,
    flattenChats,
    upsertChatIntoConversations,
  });
}

function threadToChat(thread) {
  return threadToChatModel(thread, {
    defaultAccess: state.preferences.access,
    mergeChatWithCache,
    messageOriginForChat,
    repoLabelFromThread,
    relativeTimeFromUnix,
  });
}

function hydrateChatFromThread(chat, thread) {
  hydrateChatFromThreadModel(chat, thread, {
    cachedMessages: state.threadCache[thread.id]?.messages || [],
    cachedWritable: state.threadCache[thread.id]?.writable === true,
    messageOriginForChat,
    persistThreadCacheForChat,
    repoLabelFromThread,
    relativeTimeFromUnix,
  });
}

function adoptRemoteThreadForChat(chat, thread) {
  adoptRemoteThreadForChatModel(chat, thread, {
    repoLabelFromThread,
    relativeTimeFromUnix,
    selectChat(id) {
      state.selectedChatId = id;
    },
  });
}

function buildThreadStartParams(chat) {
  const representativeCwd = chat.cwd || guessCwdForRepo(chat.repo);
  return {
    approvalPolicy: approvalPolicyForAccess(chat.access),
    cwd: representativeCwd,
    model: state.preferences.model,
    personality: "pragmatic",
    sandbox: sandboxForAccess(chat.access),
  };
}

function buildThreadForkParams(chat) {
  return {
    approvalPolicy: approvalPolicyForAccess(chat.access),
    cwd: chat.cwd || null,
    model: state.preferences.model,
    sandbox: sandboxForAccess(chat.access),
    threadId: chat.threadId,
  };
}

function effortForReasoning(reasoning) {
  switch (reasoning) {
    case "Extra High":
      return "xhigh";
    case "High":
      return "high";
    default:
      return "medium";
  }
}

function guessCwdForRepo(repo) {
  return representativeThreadInfo(repo)?.cwd || null;
}

function findChatByThreadId(threadId) {
  return findChatByThreadIdInCollections(state.conversations, threadId);
}

function ensureChatVisible(chat) {
  upsertChatIntoConversations(state.conversations, chat);
  renderAll();
}

function upsertChatIntoConversations(conversations, chat) {
  return upsertChatIntoCollections({
    conversations,
    chat,
    mergeChatWithCache,
  });
}

function flattenChats(conversations) {
  return flattenChatsFromCollections(conversations);
}

function representativeThreadInfo(repo) {
  return representativeThreadInfoFromCollections(state.conversations, repo);
}

async function createBranch() {
  const chat = selectedChat();
  if (!state.client || !chat?.cwd) {
    addLog("warn", "Branch creation needs a connected local git repo.", "branch");
    renderLogs();
    return;
  }

  const name = window.prompt("New branch name");
  if (!name || !name.trim()) {
    return;
  }

  try {
    const result = await state.client.gitCreateBranch(chat.cwd, name.trim());
    chat.branch = result.branch || name.trim();
    await refreshBranchCatalog(chat);
    addLog("info", "Created git branch.", chat.branch);
    renderAll();
  } catch (error) {
    addLog("error", error.message || "Failed to create git branch.", "git/createBranch");
    renderLogs();
  }
}

function summarizeAccount(accountResult) {
  if (accountResult?.account?.type === "chatgpt") {
    return `Account: ${accountResult.account.planType || "chatgpt"}`;
  }
  if (accountResult?.account?.type === "apiKey") {
    return "Account: API key";
  }
  if (accountResult?.requiresOpenaiAuth) {
    return "Account: Sign in required";
  }
  return "Account: Unknown";
}

function summarizeRateLimits(rateLimitResult) {
  const snapshot = rateLimitResult?.rateLimitsByLimitId?.codex || rateLimitResult?.rateLimits || null;
  if (!snapshot) {
    return "Usage: Unknown";
  }

  if (snapshot.credits?.unlimited) {
    return "Usage: Unlimited";
  }
  if (snapshot.credits?.balance) {
    return `Usage: ${snapshot.credits.balance}`;
  }
  if (snapshot.primary?.usedPercent != null) {
    return `Usage: ${snapshot.primary.usedPercent}% used`;
  }
  return "Usage: Available";
}

function repoLabelFromThread(thread) {
  const originUrl = thread.gitInfo?.originUrl || "";
  const repoFromOrigin = originUrl.match(/\/([^/]+?)(?:\.git)?$/)?.[1];
  if (repoFromOrigin) {
    return repoFromOrigin;
  }
  return thread.cwd?.split(/[\\/]/).filter(Boolean).pop() || "Workspace";
}

function relativeTimeFromUnix(unixSeconds) {
  if (!Number.isFinite(Number(unixSeconds))) {
    return "now";
  }
  const deltaSeconds = Math.max(0, Math.floor(Date.now() / 1000) - Number(unixSeconds));
  if (deltaSeconds < 90) {
    return "now";
  }
  const deltaDays = Math.floor(deltaSeconds / 86400);
  if (deltaDays >= 1) {
    return `${deltaDays}d`;
  }
  const deltaHours = Math.floor(deltaSeconds / 3600);
  if (deltaHours >= 1) {
    return `${deltaHours}h`;
  }
  return `${Math.max(1, Math.floor(deltaSeconds / 60))}m`;
}

function applyAgentDeltaNotification(params) {
  const threadId = params?.threadId;
  const itemId = params?.itemId;
  const delta = typeof params?.delta === "string" ? params.delta : "";
  if (!threadId || !itemId || !delta) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  let message = chat.messages.find((entry) => entry.id === itemId);
  if (!message) {
    chat.messages = chat.messages.filter((entry) => !entry.pending);
    message = {
      id: itemId,
      role: "assistant",
      author: "Codex",
      origin: messageOriginForChat(chat),
      time: "streaming",
      text: "",
    };
    chat.messages.push(message);
  }

  message.text += delta;
  chat.snippet = message.text.slice(0, 120) || chat.snippet;
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyCompletedItemNotification(params) {
  const threadId = params?.threadId;
  const item = params?.item;
  if (!threadId || !item?.type) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  if (item.type === "agentMessage") {
    chat.messages = chat.messages.filter((entry) => !entry.pending);
    const existing = chat.messages.find((entry) => entry.id === item.id);
    if (existing) {
      existing.origin = existing.origin || messageOriginForChat(chat);
      existing.text = item.text || existing.text;
      existing.time = item.phase || "completed";
    } else {
      chat.messages.push({
        id: item.id,
        role: "assistant",
        author: "Codex",
        origin: messageOriginForChat(chat),
        time: item.phase || "completed",
        text: item.text || "",
      });
    }
    chat.snippet = item.text || chat.snippet;
  }

  if (item.type === "reasoning" && Array.isArray(item.summary) && item.summary.length) {
    const existingReasoning = chat.messages.find((entry) => entry.id === item.id);
    if (existingReasoning) {
      existingReasoning.origin = existingReasoning.origin || messageOriginForChat(chat);
      existingReasoning.text = item.summary.join("\n");
      existingReasoning.time = "completed";
    } else {
      chat.messages.push({
        id: item.id,
        role: "assistant",
        author: "Reasoning",
        origin: messageOriginForChat(chat),
        time: "completed",
        text: item.summary.join("\n"),
      });
    }
  }

  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "";
    const commandId = item.id || `command:${hashString(`${command}\n${item.text || item.output || item.rawOutput || ""}`)}`;
    const message = ensureCommandMessage(chat, commandId, command);
    const rawOutput = normalizeCommandOutput(item.output || item.rawOutput || item.text || "");
    if (rawOutput) {
      message.rawOutput = rawOutput;
    }
    message.preview = buildCommandPreview(message.rawOutput);
    message.time = "completed";
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyStartedItemNotification(params) {
  const threadId = params?.threadId;
  const item = params?.item;
  if (!threadId || !item?.type) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  if (item.type === "reasoning") {
    if (!chat.messages.find((entry) => entry.id === item.id)) {
      chat.messages.push({
        id: item.id,
        role: "assistant",
        author: "Reasoning",
        origin: messageOriginForChat(chat),
        time: "thinking",
        text: "Thinking...",
      });
    }
  }

  if (item.type === "commandExecution") {
    const command = typeof item.command === "string" ? item.command : "";
    const commandId = item.id || `command:${hashString(`${command}\n${item.text || item.output || item.rawOutput || ""}`)}`;
    const message = ensureCommandMessage(chat, commandId, command);
    message.preview = "Running...";
    message.time = "running";
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyReasoningDeltaNotification(params, method) {
  const threadId = params?.threadId;
  const itemId = params?.itemId;
  const delta = typeof params?.delta === "string" ? params.delta : "";
  if (!threadId || !itemId || !delta) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  let message = chat.messages.find((entry) => entry.id === itemId);
  if (!message) {
    message = {
      id: itemId,
      role: "assistant",
      author: "Reasoning",
      origin: messageOriginForChat(chat),
      time: "thinking",
      text: "",
    };
    chat.messages.push(message);
  }

  if (method === "item/reasoning/textDelta" && delta.trim() === "Thinking...") {
    if (!message.text) {
      message.text = "Thinking...";
    }
    persistThreadCacheForChat(chat);
    if (selectedChat()?.id === chat.id) {
      renderConversation();
    }
    return;
  }

  if (message.text === "Thinking...") {
    message.text = "";
  }

  if (method === "item/reasoning/summaryTextDelta" && message.text && !message.text.endsWith("\n")) {
    message.text += "\n";
  }
  message.text += delta;
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyCommandOutputDeltaNotification(params) {
  const threadId = params?.threadId;
  const itemId = params?.itemId;
  const delta = typeof params?.delta === "string" ? params.delta : "";
  if (!threadId || !itemId || !delta) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const message = ensureCommandMessage(chat, itemId, params?.command || "");
  message.rawOutput = `${message.rawOutput || ""}${message.rawOutput ? "\n" : ""}${delta}`;
  message.preview = buildCommandPreview(message.rawOutput);
  message.time = "running";
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyCodexUserMessageNotification(params) {
  const threadId = params?.threadId;
  const turnId = params?.turnId || "";
  const messageText = typeof params?.message === "string" ? params.message : "";
  if (!threadId || !messageText) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const existingRecentUserMessage = [...chat.messages].reverse().find((entry) => entry.role === "user");
  if (
    existingRecentUserMessage
    && existingRecentUserMessage.origin === "web"
    && existingRecentUserMessage.text === messageText
  ) {
    return;
  }

  const messageId = `codex-user:${turnId || messageText}`;
  if (!chat.messages.find((entry) => entry.id === messageId)) {
    chat.messages.push({
      id: messageId,
      role: "user",
      author: "You",
      origin: messageOriginForChat(chat),
      time: "synced",
      text: messageText,
    });
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyCodexAgentMessageNotification(params) {
  const threadId = params?.threadId;
  const turnId = params?.turnId || "";
  const messageText = typeof params?.message === "string" ? params.message : "";
  const phase = normalizeLivePhase(params?.phase);
  if (!threadId || !messageText) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  chat.messages = chat.messages.filter((entry) => !entry.pending);
  const messageId = `codex-agent:${turnId || "turn"}:${phase}:${hashString(messageText)}`;
  const existing = chat.messages.find((entry) => entry.id === messageId);
  if (existing) {
    existing.text = messageText;
    existing.time = phase;
    existing.origin = messageOriginForChat(chat);
  } else {
    chat.messages.push({
      id: messageId,
      role: "assistant",
      author: "Codex",
      origin: messageOriginForChat(chat),
      time: phase,
      text: messageText,
    });
  }

  chat.snippet = messageText;
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyBackgroundEventNotification(params) {
  const threadId = params?.threadId;
  const turnId = params?.turnId || "";
  const callId = params?.call_id || params?.callId || "";
  const messageText = typeof params?.message === "string" ? params.message : "";
  if (!threadId || !messageText) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const messageId = `background:${turnId || "turn"}:${callId || "call"}:${hashString(messageText)}`;
  if (!chat.messages.find((entry) => entry.id === messageId)) {
    chat.messages.push({
      id: messageId,
      role: "assistant",
      author: "Activity",
      origin: messageOriginForChat(chat),
      time: "running",
      text: messageText,
    });
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function ensureCommandMessage(chat, itemId, command = "") {
  let message = chat.messages.find((entry) => entry.id === itemId);
  if (!message) {
    message = {
      id: itemId,
      role: "assistant",
      author: "Shell",
      origin: messageOriginForChat(chat),
      kind: "command",
      command: "",
      summary: "",
      preview: "Running...",
      rawOutput: "",
      time: "running",
      text: "",
    };
    chat.messages.push(message);
  }

  message.author = "Shell";
  message.kind = "command";
  message.origin = message.origin || messageOriginForChat(chat);
  if (command) {
    message.command = command;
  }
  message.summary = summarizeCommandForDisplay(message.command || "Command");
  return message;
}

function normalizeLivePhase(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "completed";
  }
  if (normalized === "final") {
    return "final_answer";
  }
  return normalized;
}

function hashString(value) {
  let hash = 0;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function legacyApplyExecCommandBeginNotification(params) {
  const threadId = params?.threadId;
  const callId = params?.call_id || params?.callId;
  const command = typeof params?.command === "string" ? params.command : "";
  if (!threadId || !callId || !command) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const messageId = `command:${callId}`;
  const existing = chat.messages.find((entry) => entry.id === messageId);
  if (!existing) {
    chat.messages.push({
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOriginForChat(chat),
      kind: "command",
      time: "running",
      text: `${command}\n\n실행함`,
    });
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function legacyApplyExecCommandOutputNotification(params) {
  const threadId = params?.threadId;
  const callId = params?.call_id || params?.callId;
  const delta = typeof params?.chunk === "string" ? params.chunk : "";
  if (!threadId || !callId || !delta) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const messageId = `command:${callId}`;
  let message = chat.messages.find((entry) => entry.id === messageId);
  if (!message) {
    message = {
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOriginForChat(chat),
      kind: "command",
      time: "running",
      text: "",
    };
    chat.messages.push(message);
  }

  message.text += `${message.text ? "\n\n" : ""}${delta}`;
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function legacyApplyExecCommandEndNotification(params) {
  const threadId = params?.threadId;
  const callId = params?.call_id || params?.callId;
  const output = typeof params?.output === "string" ? params.output : "";
  if (!threadId || !callId) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  const messageId = `command:${callId}`;
  let message = chat.messages.find((entry) => entry.id === messageId);
  if (!message) {
    message = {
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOriginForChat(chat),
      kind: "command",
      time: "completed",
      text: typeof params?.command === "string" ? `${params.command}\n\n실행함` : "명령 실행",
    };
    chat.messages.push(message);
  }

  if (output && !message.text.includes(output)) {
    message.text += `${message.text ? "\n\n" : ""}${output}`;
  }
  message.time = "completed";
  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function mergeChatWithCache(chat) {
  const cached = state.threadCache[chat.threadId || chat.id];
  const merged = mergeChatWithCacheModel(chat, cached);
  if (cached?.messages?.length) {
    merged.messages = mergeMessagesWithCache({
      threadId: chat.threadId || chat.id,
      serverMessages: chat.messages,
      cachedMessages: cached.messages,
    });
  }
  return merged;
}

function applyExecCommandBeginNotification(params) {
  const threadId = params?.threadId;
  if (!threadId) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  if (!applyExecCommandBegin(chat, params, { messageOrigin: messageOriginForChat(chat) })) {
    return;
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyExecCommandOutputNotification(params) {
  const threadId = params?.threadId;
  if (!threadId) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  if (!applyExecCommandOutput(chat, params, { messageOrigin: messageOriginForChat(chat) })) {
    return;
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function applyExecCommandEndNotification(params) {
  const threadId = params?.threadId;
  if (!threadId) {
    return;
  }

  const chat = findChatByThreadId(threadId);
  if (!chat) {
    return;
  }

  if (!applyExecCommandEnd(chat, params, { messageOrigin: messageOriginForChat(chat) })) {
    return;
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function chatHasPendingTurn(chat) {
  return Boolean(chat?.messages?.some((message) => message.pending));
}

function persistThreadCacheForChat(chat) {
  const threadId = chat.threadId || chat.id;
  if (!threadId) {
    return;
  }

  state.threadCache[threadId] = {
    access: chat.access,
    branch: chat.branch,
    cwd: chat.cwd || null,
    model: chat.model || null,
    messages: chat.messages,
    originUrl: chat.originUrl || null,
    reasoning: chat.reasoning || null,
    repo: chat.repo,
    snippet: chat.snippet,
    title: chat.title,
    writable: chat.writable === true,
  };
  saveStoredThreadCache(state.threadCache);
}

function persistLastThreadId(threadId) {
  saveStoredLastThreadId(threadId);
}

function setOptions(select, values, selectedValue = select.value) {
  select.replaceChildren(...values.map((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    return option;
  }));
  if (values.includes(selectedValue)) {
    select.value = selectedValue;
  }
}

function setOptionEntries(select, entries, selectedValue = select.value) {
  select.replaceChildren(...entries.map((entry) => {
    const option = document.createElement("option");
    option.value = entry.value;
    option.textContent = entry.label;
    return option;
  }));
  if (entries.some((entry) => entry.value === selectedValue)) {
    select.value = selectedValue;
  } else if (entries[0]) {
    select.value = entries[0].value;
  }
}

function currentReasoningOptions(chat = selectedChat(), modelEntries = state.modelCatalog) {
  const selectedModelName = chat?.model || state.preferences.model;
  const selectedModel = modelEntries.find((entry) => entry.model === selectedModelName) || modelEntries[0];
  if (!selectedModel) {
    return REASONING_OPTIONS.map((value) => ({ label: value, value }));
  }

  const options = selectedModel.supportedReasoningEfforts.map((entry) => ({
    label: labelForReasoningEffort(entry.reasoningEffort),
    value: entry.reasoningEffort,
  }));

  const threadEffort = chat?.reasoning || state.preferences.reasoning;
  if (threadEffort && !options.some((entry) => entry.value === threadEffort)) {
    options.unshift({
      label: labelForReasoningEffort(threadEffort),
      value: threadEffort,
    });
  }

  return options;
}

function modelCatalogWithThreadRuntime(chat = selectedChat()) {
  const catalog = [...state.modelCatalog];
  if (!chat?.model || catalog.some((entry) => entry.model === chat.model)) {
    return catalog;
  }

  const fallbackEntry = catalog.find((entry) => entry.model === state.preferences.model) || catalog[0];
  const supportedReasoningEfforts = [
    ...(fallbackEntry?.supportedReasoningEfforts || []),
  ];

  if (chat.reasoning && !supportedReasoningEfforts.some((entry) => entry.reasoningEffort === chat.reasoning)) {
    supportedReasoningEfforts.unshift({
      description: "Thread runtime",
      reasoningEffort: chat.reasoning,
    });
  }

  catalog.unshift({
    defaultReasoningEffort: chat.reasoning || fallbackEntry?.defaultReasoningEffort || "medium",
    displayName: chat.model,
    isDefault: false,
    model: chat.model,
    supportedReasoningEfforts: supportedReasoningEfforts.length
      ? supportedReasoningEfforts
      : [{ description: "Balanced", reasoningEffort: "medium" }],
  });

  return catalog;
}

function messageOriginForChat(chat) {
  return messageOriginForThread(chat, state.bridgeActiveThreadId);
}

function describeThreadMode(chat) {
  if (!chat) {
    return "No thread selected";
  }
  if (!chat.threadId) {
    return "Local draft";
  }
  if (chat.threadId === state.bridgeActiveThreadId) {
    return "Shared session view";
  }
  return chat.writable
    ? "Isolated web thread"
    : "Desktop mirror view";
}

function renderThreadModeChip(chat) {
  if (!elements.threadModeChip) {
    return;
  }

  const origin = !chat ? "none" : messageOriginForChat(chat);
  const className = `header-chip thread-mode-chip ${threadModeChipClass(origin)}`;
  elements.threadModeChip.className = className;
  elements.threadModeChip.textContent = threadModeChipLabel(origin);
}

function threadModeChipLabel(origin) {
  switch (origin) {
    case "web":
      return "Web Isolated";
    case "shared":
      return "Shared View";
    case "desktop":
      return "Desktop View";
    case "local":
      return "Local Draft";
    default:
      return "No Thread";
  }
}

function sidebarModeLabel(chat) {
  switch (messageOriginForChat(chat)) {
    case "web":
      return "Browser";
    case "shared":
      return "Shared";
    case "desktop":
      return "Mirror";
    case "local":
      return "Draft";
    default:
      return "Thread";
  }
}

function threadModeChipClass(origin) {
  switch (origin) {
    case "web":
      return "thread-mode-chip-web";
    case "shared":
      return "thread-mode-chip-shared";
    case "desktop":
      return "thread-mode-chip-desktop";
    case "local":
      return "thread-mode-chip-local";
    default:
      return "thread-mode-chip-neutral";
  }
}

function originBadgeLabel(origin) {
  switch (origin) {
    case "web":
      return "Web Turn";
    case "shared":
      return "Shared Session";
    case "desktop":
      return "Desktop Mirror";
    case "local":
      return "Local Draft";
    default:
      return "Unknown";
  }
}

function originBadgeClass(origin) {
  switch (origin) {
    case "web":
      return "origin-web";
    case "shared":
      return "origin-shared";
    case "desktop":
      return "origin-desktop";
    case "local":
      return "origin-local";
    default:
      return "origin-unknown";
  }
}

function renderMessageBubble(element, message) {
  if (!element) {
    return;
  }

  if (message?.pending) {
    element.classList.add("typing-bubble");

    const label = document.createElement("div");
    label.className = "typing-label";
    label.textContent = message.text || "Waiting for response";

    const indicator = document.createElement("div");
    indicator.className = "typing-indicator";
    indicator.innerHTML = "<span></span><span></span><span></span>";

    element.replaceChildren(label, indicator);
    return;
  }

  if (message?.kind === "command") {
    const summaryText = message.summary || summarizeCommandForDisplay(message.command || "Command");
    const previewText = message.preview || buildCommandPreview(message.rawOutput || message.text || "");
    const rawContent = buildCommandRawContent(message);
    if (!summaryText && !previewText && !rawContent) {
      element.replaceChildren();
      return;
    }

    element.classList.add("command-bubble");

    const summary = document.createElement("div");
    summary.className = "command-summary";
    summary.textContent = summaryText;

    const preview = document.createElement("pre");
    preview.className = "command-preview";
    preview.textContent = previewText;

    element.replaceChildren(summary, preview);

    if (rawContent) {
      const details = document.createElement("details");
      details.className = "command-details";
      const summaryLine = document.createElement("summary");
      summaryLine.textContent = "Show Raw";
      const rawBlock = document.createElement("pre");
      rawBlock.textContent = rawContent;
      details.append(summaryLine, rawBlock);
      element.append(details);
    }
    return;
  }

  element.textContent = message?.text || "";
}

function addLog(level, message, meta = new Date().toLocaleTimeString()) {
  state.logs.unshift({ level, message, meta });
  state.logs = state.logs.slice(0, 8);
}

function openModal(element) {
  if (!element) {
    return;
  }
  element.classList.add("is-open");
  element.removeAttribute("inert");
  element.setAttribute("aria-hidden", "false");
}

function closeModal(element) {
  if (!element) {
    return;
  }

  const activeElement = document.activeElement;
  if (activeElement instanceof HTMLElement && element.contains(activeElement)) {
    activeElement.blur();
  }

  element.classList.remove("is-open");
  element.setAttribute("aria-hidden", "true");
  element.setAttribute("inert", "");
}

function isNarrowViewport() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function labelForReasoningEffort(value) {
  switch (value) {
    case "xhigh":
      return "Extra High";
    case "high":
      return "High";
    case "medium":
      return "Balanced";
    case "low":
      return "Low";
    case "minimal":
      return "Minimal";
    case "none":
      return "None";
    default:
      return value;
  }
}

function scrollConversationToBottom() {
  const scrollToBottom = () => {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  };

  scrollToBottom();
  window.requestAnimationFrame(scrollToBottom);
  window.setTimeout(scrollToBottom, 40);
}

function truncate(value, maxLength) {
  const normalized = String(value || "");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function setScannerStatus(message) {
  elements.scannerStatus.textContent = message;
}

function cloneConversations(value) {
  return JSON.parse(JSON.stringify(value));
}

async function cleanupLegacyAppShell() {
  if (!("serviceWorker" in navigator)) {
    return false;
  }

  const reloadMarker = "remodex-web.sw-cleanup-reloaded";
  let hadLegacyRegistration = false;

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    const appRegistrations = registrations.filter((registration) => (
      registration.scope.includes("/app/")
      || registration.scope.endsWith("/app")
    ));

    hadLegacyRegistration = appRegistrations.length > 0;
    await Promise.all(appRegistrations.map((registration) => registration.unregister()));
  } catch {}

  try {
    if ("caches" in globalThis) {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith("remodex-web-deck-"))
          .map((key) => caches.delete(key))
      );
    }
  } catch {}

  try {
    if (hadLegacyRegistration && sessionStorage.getItem(reloadMarker) !== "1") {
      sessionStorage.setItem(reloadMarker, "1");
      window.location.replace(window.location.href);
      return true;
    }
    sessionStorage.removeItem(reloadMarker);
  } catch {}

  return false;
}
