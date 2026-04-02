import {
  buildMessageRenderKey,
  isScrolledNearBottom,
  shouldAutoScrollMessageList,
} from "./modules/conversation-render-state.mjs";
import {
  createAnimationFrameBatcher,
  createDeferredStorageWriter,
} from "./modules/ui-work-batching.mjs";
import {
  buildSidebarChatRenderKey,
  buildSidebarRenderModel,
  buildSidebarSelectionDelta,
} from "./modules/sidebar-render-state.mjs";
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
import { describeMobileDockState } from "./modules/mobile-dock-state.mjs";
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
  applyPlanDelta,
  applyTurnPlanUpdated,
  buildStructuredUserInputResponse,
  chatHasBlockingServerRequest,
  ensurePlanMessage,
  finalizePlanMessages,
  normalizePlanExplanation,
  normalizePlanItemText,
  normalizePlanSteps,
  rememberThreadTurnMapping,
  resolveServerRequestInChats,
  resolveThreadIdFromParams,
  resolveTurnIdFromParams,
  upsertApprovalRequest,
  upsertStructuredUserInputRequest,
} from "./modules/thread-collaboration-state.mjs";
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

const DEFAULT_GLASS_ENABLED = !shouldPreferReducedGlass(window, navigator);

const state = {
  accountSummary: "Account: Unknown",
  branchCatalog: [],
  bridgeActiveThreadId: null,
  capabilities: collectBrowserCapabilities(window, navigator),
  client: null,
  connection: { detail: "Load a QR or pairing JSON to connect the browser client.", label: "Waiting for pairing", status: "warning" },
  conversations: [],
  diffViewer: {
    callId: "",
    error: "",
    loadedAt: 0,
    patch: "",
    sourceThreadId: "",
    status: "idle",
    turnId: "",
  },
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
  preferences: loadPreferences({
    accessOptions: ACCESS_OPTIONS,
    defaultGlass: DEFAULT_GLASS_ENABLED,
    modelOptions: MODEL_OPTIONS,
    reasoningOptions: REASONING_OPTIONS,
    speedOptions: SPEED_OPTIONS,
  }),
  rateLimitSummary: "Usage: Unknown",
  relayOverride: loadStoredRelayOverride(),
  searchQuery: "",
  selectedChatId: loadStoredLastThreadId(),
  sidebarOpen: false,
  threadCache: loadStoredThreadCache(),
  threadIdByTurnId: {},
  mobileThreadOpen: false,
};

const elements = mapElements();
let refreshTimer = 0;
let searchRenderTimer = 0;
let scanner = null;
let bridgeClientModule = null;
let bridgeClientModulePromise = null;
const patchRefreshTimers = new Map();
let richMessageRendererModule = null;
let richMessageRendererPromise = null;
const conversationRenderBatcher = createAnimationFrameBatcher(() => {
  renderConversation();
}, {
  cancelFrame: window.cancelAnimationFrame?.bind(window),
  requestFrame: window.requestAnimationFrame?.bind(window),
});
const threadCacheWriter = createDeferredStorageWriter(() => {
  saveStoredThreadCache(state.threadCache);
}, {
  cancelIdleCallback: window.cancelIdleCallback?.bind(window),
  clearTimeout: window.clearTimeout.bind(window),
  requestIdleCallback: window.requestIdleCallback?.bind(window),
  setTimeout: window.setTimeout.bind(window),
});
let persistedLastThreadId = state.selectedChatId || null;
const modalFocusRestore = new WeakMap();
const swipeGesture = {
  active: false,
  chatId: "",
  horizontal: false,
  lastX: 0,
  mode: "",
  startX: 0,
  startY: 0,
};

void init();

function shouldPreferReducedGlass(windowLike = globalThis, navigatorLike = globalThis.navigator) {
  try {
    if (windowLike?.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      return true;
    }
  } catch {}

  if (navigatorLike?.connection?.saveData === true) {
    return true;
  }

  const deviceMemory = Number(navigatorLike?.deviceMemory || 0);
  if (Number.isFinite(deviceMemory) && deviceMemory > 0 && deviceMemory <= 4) {
    return true;
  }

  const hardwareConcurrency = Number(navigatorLike?.hardwareConcurrency || 0);
  if (Number.isFinite(hardwareConcurrency) && hardwareConcurrency > 0 && hardwareConcurrency <= 4) {
    return true;
  }

  return false;
}

async function init() {
  seedLogs();
  wireEvents();
  renderAll();
  if (state.pairingPayload) {
    void connectRelay({ restoreThread: true });
  }
}

async function ensureBridgeClientModule() {
  if (bridgeClientModule) {
    return bridgeClientModule;
  }

  if (!bridgeClientModulePromise) {
    bridgeClientModulePromise = import("./modules/browser-bridge-client.mjs").then((module) => {
      bridgeClientModule = module;
      return module;
    });
  }

  return bridgeClientModulePromise;
}

async function ensureRichMessageRenderer() {
  if (richMessageRendererModule) {
    return richMessageRendererModule;
  }

  if (!richMessageRendererPromise) {
    richMessageRendererPromise = import("./modules/thread-message-renderer.mjs").then((module) => {
      richMessageRendererModule = module;
      return module;
    });
  }

  return richMessageRendererPromise;
}

function inferRelayBaseUrl(locationLike) {
  if (!locationLike?.host || !locationLike?.protocol) {
    return "";
  }

  const socketProtocol = locationLike.protocol === "https:" ? "wss:" : "ws:";
  return `${socketProtocol}//${locationLike.host}/relay`;
}

function getBrowserNotificationState(windowLike = globalThis, navigatorLike = globalThis.navigator) {
  const supported = typeof windowLike?.Notification === "function";
  return {
    permission: supported ? windowLike.Notification.permission : "unsupported",
    serviceWorkerSupported: Boolean(navigatorLike?.serviceWorker),
    supported,
  };
}

async function requestBrowserNotificationPermission(windowLike = globalThis) {
  if (typeof windowLike?.Notification?.requestPermission !== "function") {
    return "unsupported";
  }
  return windowLike.Notification.requestPermission();
}

function describeBrowserNotificationPermission(permission) {
  switch (permission) {
    case "granted":
      return "Enabled";
    case "denied":
      return "Blocked";
    case "default":
      return "Not requested";
    default:
      return "Unavailable";
  }
}

async function sendBrowserNotification({
  body = "",
  navigatorLike = globalThis.navigator,
  requireHidden = true,
  tag,
  title,
  windowLike = globalThis,
} = {}) {
  const notificationState = getBrowserNotificationState(windowLike, navigatorLike);
  if (!notificationState.supported || notificationState.permission !== "granted") {
    return false;
  }

  if (requireHidden && windowLike?.document && !windowLike.document.hidden) {
    return false;
  }

  const iconUrl = resolveVersionedAppAssetUrl("/app/icon.svg", windowLike);
  const options = {
    badge: iconUrl,
    body,
    icon: iconUrl,
    tag,
  };

  try {
    const registration = await navigatorLike?.serviceWorker?.ready;
    if (typeof registration?.showNotification === "function") {
      await registration.showNotification(title, options);
      return true;
    }
  } catch {}

  try {
    new windowLike.Notification(title, options);
    return true;
  } catch {
    return false;
  }
}

function resolveVersionedAppAssetUrl(assetPath, windowLike = globalThis) {
  const version = String(windowLike?.__REMODEX_APP_VERSION__ || "").trim();
  return version ? `${assetPath}?v=${encodeURIComponent(version)}` : assetPath;
}

function mapElements() {
  return {
    accessSelect: document.querySelector("#access-select"),
    activeTurnCount: document.querySelector("#active-turn-count"),
    appFrame: document.querySelector(".app-frame"),
    deckSummaryCopy: document.querySelector("#deck-summary-copy"),
    deckSummaryStatus: document.querySelector("#deck-summary-status"),
    deckSummaryTitle: document.querySelector("#deck-summary-title"),
    body: document.body,
    branchContext: document.querySelector("#branch-context"),
    branchCancelButton: document.querySelector("#branch-cancel-button"),
    branchError: document.querySelector("#branch-error"),
    branchForm: document.querySelector("#branch-form"),
    branchNameInput: document.querySelector("#branch-name-input"),
    branchSheet: document.querySelector("#branch-sheet"),
    branchSubmitButton: document.querySelector("#branch-submit-button"),
    branchSelect: document.querySelector("#branch-select"),
    cameraCaptureInput: document.querySelector("#camera-capture-input"),
    closeBranchButton: document.querySelector("#close-branch-button"),
    clearPairingButton: document.querySelector("#clear-pairing-button"),
    closeDiffButton: document.querySelector("#close-diff-button"),
    closeScannerButton: document.querySelector("#close-scanner-button"),
    closeSettingsButton: document.querySelector("#close-settings-button"),
    composerInput: document.querySelector("#composer-input"),
    composerStatus: document.querySelector("#composer-status"),
    conversationHeader: document.querySelector(".conversation-header"),
    conversationShell: document.querySelector(".conversation-shell"),
    connectButton: document.querySelector("#connect-button"),
    connectionDot: document.querySelector("#connection-dot"),
    connectionLabel: document.querySelector("#connection-label"),
    connectionMeta: document.querySelector("#connection-meta"),
    createBranchButton: document.querySelector("#create-branch-button"),
    disconnectButton: document.querySelector("#disconnect-button"),
    diffBody: document.querySelector("#diff-body"),
    diffMeta: document.querySelector("#diff-meta"),
    diffSheet: document.querySelector("#diff-sheet"),
    diffTitle: document.querySelector("#diff-title"),
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
    mobileTabBar: document.querySelector(".mobile-tab-bar"),
    mobileDeckButton: document.querySelector("#mobile-deck-button"),
    mobileNewButton: document.querySelector("#mobile-new-button"),
    mobileScanDockButton: document.querySelector("#mobile-scan-dock-button"),
    mobileSettingsDockButton: document.querySelector("#mobile-settings-dock-button"),
    newChatButton: document.querySelector("#new-chat-button"),
    notificationStatusCopy: document.querySelector("#notification-status-copy"),
    notificationTestButton: document.querySelector("#notification-test-button"),
    notificationToggleButton: document.querySelector("#notification-toggle-button"),
    openScannerButton: document.querySelector("#open-scanner-button"),
    openSettingsButton: document.querySelector("#open-settings-button"),
    pairingFileInput: document.querySelector("#pairing-file-input"),
    pairingJsonInput: document.querySelector("#pairing-json-input"),
    accountChip: document.querySelector("#account-chip"),
    pushStatusLabel: document.querySelector("#push-status-label"),
    rateLimitChip: document.querySelector("#rate-limit-chip"),
    refreshDiffButton: document.querySelector("#refresh-diff-button"),
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
    sidebar: document.querySelector(".sidebar"),
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
    threadDiffButton: document.querySelector("#thread-diff-button"),
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
  elements.searchInput.addEventListener("input", (event) => {
    state.searchQuery = event.target.value.trim().toLowerCase();
    scheduleSidebarRender();
  });
  elements.folderList.addEventListener("click", handleSidebarClick);
  elements.newChatButton.addEventListener("click", () => { void createChat(); });
  elements.mobileDeckButton?.addEventListener("click", () => {
    pulseHaptic(8);
    setMobileThreadOpen(false);
  });
  elements.mobileNewButton?.addEventListener("click", () => { void createChat(); });
  elements.mobileScanDockButton?.addEventListener("click", openScanner);
  elements.mobileSettingsDockButton?.addEventListener("click", openSettings);
  elements.createBranchButton.addEventListener("click", createBranch);
  elements.branchForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void submitBranchCreation();
  });
  elements.closeBranchButton?.addEventListener("click", closeBranchSheet);
  elements.branchCancelButton?.addEventListener("click", closeBranchSheet);
  elements.sendButton.addEventListener("click", sendMessage);
  elements.threadDiffButton.addEventListener("click", () => { void openDiff(); });
  elements.refreshDiffButton.addEventListener("click", () => { void refreshDiffForSelectedChat(); });
  elements.closeDiffButton.addEventListener("click", closeDiff);
  elements.composerInput.addEventListener("input", autosizeComposer);
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
  elements.notificationToggleButton?.addEventListener("click", () => { void toggleBrowserNotifications(); });
  elements.notificationTestButton?.addEventListener("click", () => { void sendTestBrowserNotification(); });
  elements.openSettingsButton.addEventListener("click", openSettings);
  elements.headerSettingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.settingsPanel.addEventListener("click", (event) => { if (event.target === elements.settingsPanel) { closeSettings(); } });
  elements.openScannerButton.addEventListener("click", openScanner);
  elements.headerScanButton.addEventListener("click", openScanner);
  elements.closeScannerButton.addEventListener("click", closeScanner);
  elements.scannerModal.addEventListener("click", (event) => { if (event.target === elements.scannerModal) { closeScanner(); } });
  elements.diffSheet.addEventListener("click", (event) => { if (event.target === elements.diffSheet) { closeDiff(); } });
  elements.branchSheet?.addEventListener("click", (event) => { if (event.target === elements.branchSheet) { closeBranchSheet(); } });
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
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushPendingThreadCacheWrite();
    }
  });
  window.addEventListener("pagehide", flushPendingThreadCacheWrite);
  window.addEventListener("beforeunload", flushPendingThreadCacheWrite);
  document.addEventListener("keydown", handleGlobalKeydown);
  wireSwipeGestures();
  elements.mobileBackButton.addEventListener("click", () => {
    pulseHaptic(8);
    setMobileThreadOpen(false);
  });
}

function renderAll() {
  renderBody();
  renderSelects();
  renderSidebar();
  renderDeckSummary();
  renderConversationNow();
  renderPairing();
  renderConnection();
  renderRuntimeStrip();
  renderSettings();
  renderDiffViewer();
  renderLogs();
  autosizeComposer();
  renderAppChrome();
}

function renderAfterChatStateChange({
  includeDeckSummary = false,
  includeDiffViewer = true,
  includeLogs = false,
  includeSidebar = true,
} = {}) {
  renderSelects();
  if (includeSidebar) {
    renderSidebar();
  }
  if (includeDeckSummary) {
    renderDeckSummary();
  }
  renderConversationNow();
  renderConnection();
  renderRuntimeStrip();
  if (includeDiffViewer) {
    renderDiffViewer();
  }
  if (includeLogs) {
    renderLogs();
  }
  autosizeComposer();
  renderAppChrome();
}

function renderAfterPreferenceChange() {
  renderBody();
  renderSelects();
  renderConversationNow();
  renderConnection();
  renderRuntimeStrip();
  renderSettings();
  renderAppChrome();
}

function renderAfterPairingStateChange() {
  renderPairing();
  renderConnection();
  renderDeckSummary();
  renderThreadSpotlight(selectedChat());
  renderRuntimeStrip();
  renderDiffViewer();
  renderSettings();
  renderAppChrome();
}

function renderBody() {
  elements.body.classList.toggle("sidebar-open", state.sidebarOpen);
  elements.body.classList.toggle("mobile-thread-open", state.mobileThreadOpen && isNarrowViewport());
  elements.body.classList.toggle("font-rounded", state.preferences.font === "rounded");
  elements.body.classList.toggle("no-glass", state.preferences.glass === false);
}

function setMobileThreadOpen(nextOpen) {
  state.mobileThreadOpen = Boolean(nextOpen);
  renderBody();
  renderAppChrome();
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
  const sidebarModel = buildSidebarRenderModel({
    conversations: state.conversations,
    isChatPending: chatHasPendingTurn,
    searchQuery: state.searchQuery,
    selectedChatId: state.selectedChatId,
  });

  syncSidebarSections(sidebarModel);
  if (elements.searchMeta.textContent !== sidebarModel.metaText) {
    elements.searchMeta.textContent = sidebarModel.metaText;
  }
}

function renderConversation() {
  const chat = selectedChat();
  renderComposerState(chat);
  elements.messageList.setAttribute("aria-busy", chatHasPendingTurn(chat) ? "true" : "false");
  if (!chat) {
    elements.messageList.dataset.chatId = "";
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
  elements.threadSubtitle.textContent = compactThreadSubtitle(chat);
  renderThreadModeChip(chat);
  renderThreadSpotlight(chat);
  const branchOptions = state.branchCatalog.length ? state.branchCatalog : (REPOSITORY_BRANCHES[chat.repo] || [chat.branch || "main"]);
  setOptions(elements.branchSelect, branchOptions, chat.branch);
  elements.repoSelect.value = chat.repo;
  elements.accessSelect.value = chat.access;
  persistLastThreadId(chat.id);

  const previousRenderState = captureConversationRenderState(chat.id);
  syncConversationMessageCards(chat);
  if (chatNeedsRichMessageRenderer(chat) && !richMessageRendererModule) {
    void ensureRichMessageRenderer().then(() => {
      if (selectedChat()?.id === chat.id) {
        scheduleConversationRenderForChat(chat);
      }
    });
  }

  const lastMessage = chat.messages[chat.messages.length - 1] || null;
  if (shouldAutoScrollMessageList({
    nextLastMessageId: lastMessage?.id || "",
    nextLastRenderKey: lastMessage ? buildMessageRenderKey(lastMessage) : "",
    nextMessageCount: chat.messages.length,
    previousLastMessageId: previousRenderState.lastMessageId,
    previousLastRenderKey: previousRenderState.lastRenderKey,
    previousMessageCount: previousRenderState.messageCount,
    selectedChatChanged: previousRenderState.selectedChatChanged,
    wasNearBottom: previousRenderState.wasNearBottom,
  })) {
    scrollConversationToBottom();
  }
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
}

function isSameConnectionState(left, right) {
  return left?.label === right?.label
    && left?.detail === right?.detail
    && left?.status === right?.status;
}

function scheduleSidebarRender() {
  window.clearTimeout(searchRenderTimer);
  searchRenderTimer = window.setTimeout(() => {
    searchRenderTimer = 0;
    renderSidebar();
  }, 120);
}

function renderConversationNow() {
  conversationRenderBatcher.cancel();
  renderConversation();
}

function scheduleConversationRenderForChat(chat) {
  if (!chat || selectedChat()?.id !== chat.id) {
    return;
  }

  conversationRenderBatcher.schedule();
}

function queueChatPersistenceAndRender(chat) {
  persistThreadCacheForChat(chat);
  scheduleConversationRenderForChat(chat);
}

function flushPendingThreadCacheWrite() {
  threadCacheWriter.flush();
}

function syncSidebarSelection(previousSelectedChatId, nextSelectedChatId) {
  if (elements.folderList.dataset.renderMode !== "groups") {
    renderSidebar();
    return;
  }

  for (const change of buildSidebarSelectionDelta(previousSelectedChatId, nextSelectedChatId)) {
    const button = findSidebarChatButtonById(change.id);
    if (!(button instanceof HTMLElement)) {
      continue;
    }
    updateSidebarChatButtonActiveState(button, change.active);
  }
}

function findSidebarChatButtonById(chatId) {
  if (!chatId) {
    return null;
  }

  for (const button of elements.folderList.querySelectorAll(".chat-item")) {
    if (button instanceof HTMLElement && button.dataset.chatId === chatId) {
      return button;
    }
  }
  return null;
}

function updateSidebarChatButtonActiveState(button, active) {
  button.classList.toggle("is-active", active);
  button.setAttribute("aria-current", active ? "true" : "false");
  const dot = button.querySelector(".chat-item-dot");
  if (dot instanceof HTMLElement && !dot.classList.contains("chat-item-dot-live")) {
    dot.hidden = !active;
  }
}

function handleSidebarClick(event) {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return;
  }

  const createThreadButton = target.closest(".folder-plus");
  if (createThreadButton instanceof HTMLElement && elements.folderList.contains(createThreadButton)) {
    void createChat(createThreadButton.dataset.folder || selectedChat()?.repo || state.conversations[0]?.folder);
    return;
  }

  const chatButton = target.closest(".chat-item");
  if (chatButton instanceof HTMLElement && elements.folderList.contains(chatButton)) {
    selectChatById(chatButton.dataset.chatId || "");
  }
}

function syncSidebarSections(sidebarModel) {
  if (!sidebarModel.hasChats) {
    syncSidebarEmptyState(sidebarModel);
    return;
  }

  if (elements.folderList.dataset.renderMode !== "groups") {
    elements.folderList.replaceChildren();
    elements.folderList.dataset.renderMode = "groups";
  }

  const existingSectionsByFolder = new Map();
  for (const child of Array.from(elements.folderList.children)) {
    if (child instanceof HTMLElement && child.dataset.folder) {
      existingSectionsByFolder.set(child.dataset.folder, child);
    }
  }

  let insertionCursor = elements.folderList.firstElementChild;
  for (const group of sidebarModel.groups) {
    let section = existingSectionsByFolder.get(group.folder) || null;
    if (!section) {
      section = createSidebarSection(group.folder);
      elements.folderList.insertBefore(section, insertionCursor);
    } else {
      existingSectionsByFolder.delete(group.folder);
      if (section !== insertionCursor) {
        elements.folderList.insertBefore(section, insertionCursor);
      }
    }

    updateSidebarSection(section, group);
    insertionCursor = section.nextElementSibling;
  }

  for (const staleSection of existingSectionsByFolder.values()) {
    staleSection.remove();
  }
}

function syncSidebarEmptyState(sidebarModel) {
  const emptyRenderKey = `${sidebarModel.normalizedQuery}|${sidebarModel.metaText}`;
  const existingChild = elements.folderList.firstElementChild;
  if (
    elements.folderList.dataset.renderMode === "empty"
    && existingChild instanceof HTMLElement
    && existingChild.dataset.renderKey === emptyRenderKey
  ) {
    return;
  }

  const emptyState = document.createElement("section");
  emptyState.className = "empty-panel";
  emptyState.dataset.renderKey = emptyRenderKey;
  emptyState.innerHTML = `
      <p class="empty-kicker">${sidebarModel.normalizedQuery ? "No Matches" : "No Chats Yet"}</p>
      <h3>${sidebarModel.normalizedQuery ? "Try a broader search term" : "Connect the bridge to load your real threads"}</h3>
      <p>${sidebarModel.normalizedQuery
    ? `No threads matched "${state.searchQuery}". Search by repo, thread title, or the latest snippet.`
    : "Pair the browser client, then your actual Remodex thread list will appear here instead of demo content."}</p>
    `;
  elements.folderList.replaceChildren(emptyState);
  elements.folderList.dataset.renderMode = "empty";
}

function createSidebarSection(folder) {
  const section = document.createElement("section");
  section.className = "folder-section";
  section.dataset.folder = folder;
  section.innerHTML = '<div class="folder-heading"><div class="folder-label"><span class="folder-icon" aria-hidden="true"></span><span></span></div><button class="folder-plus" type="button">+ Thread</button></div><div class="chat-list"></div>';
  return section;
}

function updateSidebarSection(section, group) {
  const nextGroupRenderKey = group.chats.map((chat) => buildSidebarChatRenderKey(chat)).join("\n");
  const label = section.querySelector(".folder-label span:last-child");
  const createThreadButton = section.querySelector(".folder-plus");
  if (label && label.textContent !== group.folder) {
    label.textContent = group.folder;
  }
  if (createThreadButton instanceof HTMLElement && createThreadButton.dataset.folder !== group.folder) {
    createThreadButton.dataset.folder = group.folder;
  }
  if (section.__remodexRenderKey === nextGroupRenderKey) {
    return;
  }

  section.__remodexRenderKey = nextGroupRenderKey;
  const list = section.querySelector(".chat-list");
  if (list instanceof HTMLElement) {
    syncSidebarChatButtons(list, group.chats);
  }
}

function syncSidebarChatButtons(list, chats) {
  const existingButtonsById = new Map();
  for (const child of Array.from(list.children)) {
    if (child instanceof HTMLElement && child.dataset.chatId) {
      existingButtonsById.set(child.dataset.chatId, child);
    }
  }

  let insertionCursor = list.firstElementChild;
  for (const chat of chats) {
    let button = existingButtonsById.get(chat.id) || null;
    const renderKey = buildSidebarChatRenderKey(chat);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      list.insertBefore(button, insertionCursor);
    } else {
      existingButtonsById.delete(chat.id);
      if (button !== insertionCursor) {
        list.insertBefore(button, insertionCursor);
      }
    }

    updateSidebarChatButton(button, chat, renderKey);
    insertionCursor = button.nextElementSibling;
  }

  for (const staleButton of existingButtonsById.values()) {
    staleButton.remove();
  }
}

function updateSidebarChatButton(button, chat, renderKey) {
  const className = `chat-item${chat.active ? " is-active" : ""}${chat.pending ? " is-pending" : ""}`;
  if (button.className !== className) {
    button.className = className;
  }
  if (button.dataset.chatId !== chat.id) {
    button.dataset.chatId = chat.id;
  }
  button.setAttribute("aria-current", chat.active ? "true" : "false");
  if (button.__remodexRenderKey === renderKey) {
    return;
  }

  button.__remodexRenderKey = renderKey;
  button.innerHTML = `
        <div class="chat-item-head">
          <span class="chat-item-title">${escapeHTML(chat.title)}</span>
          <span class="chat-item-timestamp">${escapeHTML(chat.timestamp)}</span>
        </div>
        <div class="chat-item-meta">
          <span class="chat-item-snippet">${escapeHTML(chat.snippet)}</span>
          <span class="chat-item-dot${chat.pending ? " chat-item-dot-live" : ""}"${chat.active || chat.pending ? "" : " hidden"}></span>
        </div>
        ${chat.pending
    ? '<div class="chat-item-tags"><span class="chat-item-tag chat-item-tag-live">Running</span></div>'
    : ""}
      `;
}

function captureConversationRenderState(chatId) {
  const lastCard = elements.messageList.lastElementChild;
  return {
    lastMessageId: lastCard?.dataset?.messageId || "",
    lastRenderKey: lastCard?.__remodexRenderKey || "",
    messageCount: elements.messageList.childElementCount,
    selectedChatChanged: String(elements.messageList.dataset.chatId || "") !== String(chatId || ""),
    wasNearBottom: isScrolledNearBottom(elements.messageList),
  };
}

function syncConversationMessageCards(chat) {
  if (String(elements.messageList.dataset.chatId || "") !== String(chat.id || "")) {
    elements.messageList.replaceChildren();
    elements.messageList.dataset.chatId = String(chat.id || "");
  }

  if (trySyncConversationMessageCardsInOrder(chat)) {
    return;
  }

  const existingCardsById = new Map();
  for (const child of Array.from(elements.messageList.children)) {
    if (child instanceof HTMLElement && child.dataset.messageId) {
      existingCardsById.set(child.dataset.messageId, child);
    }
  }

  let insertionCursor = elements.messageList.firstElementChild;
  for (let index = 0; index < chat.messages.length; index += 1) {
    const message = chat.messages[index];
    const messageId = String(message?.id || `${message?.role || "assistant"}:${index}`);
    const renderKey = buildMessageRenderKey(message);
    let card = existingCardsById.get(messageId) || null;

    if (!card) {
      card = createMessageCard(message, messageId, renderKey);
      elements.messageList.insertBefore(card, insertionCursor);
    } else {
      existingCardsById.delete(messageId);
      if (card !== insertionCursor) {
        elements.messageList.insertBefore(card, insertionCursor);
      }
      updateMessageCard(card, message, messageId, renderKey);
    }

    insertionCursor = card.nextElementSibling;
  }

  for (const staleCard of existingCardsById.values()) {
    staleCard.remove();
  }
}

function trySyncConversationMessageCardsInOrder(chat) {
  const existingCount = elements.messageList.childElementCount;
  if (existingCount > chat.messages.length) {
    return false;
  }

  for (let index = 0; index < existingCount; index += 1) {
    const card = elements.messageList.children[index];
    if (!(card instanceof HTMLElement)) {
      return false;
    }

    const message = chat.messages[index];
    const messageId = String(message?.id || `${message?.role || "assistant"}:${index}`);
    if (card.dataset.messageId !== messageId) {
      return false;
    }

    updateMessageCard(card, message, messageId, buildMessageRenderKey(message));
  }

  for (let index = existingCount; index < chat.messages.length; index += 1) {
    const message = chat.messages[index];
    const messageId = String(message?.id || `${message?.role || "assistant"}:${index}`);
    elements.messageList.append(createMessageCard(message, messageId, buildMessageRenderKey(message)));
  }

  return true;
}

function createMessageCard(message, messageId, renderKey) {
  const card = document.createElement("article");
  updateMessageCard(card, message, messageId, renderKey);
  return card;
}

function updateMessageCard(card, message, messageId, renderKey) {
  const nextClassName = [
    "message-card",
    message?.role === "user" ? "user" : "assistant",
    `message-origin-${message?.origin || "unknown"}`,
    message?.kind ? `message-kind-${message.kind}` : "",
    message?.pending ? "is-pending" : "",
  ].filter(Boolean).join(" ");

  if (card.className !== nextClassName) {
    card.className = nextClassName;
  }

  if (card.dataset.messageId !== messageId) {
    card.dataset.messageId = messageId;
  }

  const rendererMode = richMessageRendererModule && messageNeedsRichRenderer(message) ? "rich" : "basic";
  if (card.__remodexRenderKey === renderKey && card.dataset.rendererMode === rendererMode) {
    return;
  }

  card.__remodexRenderKey = renderKey;
  card.dataset.rendererMode = rendererMode;
  card.innerHTML = `<div class="message-meta"><span>${escapeHTML(message.author)}</span><span>|</span><span>${escapeHTML(message.time)}</span><span class="message-origin-badge ${originBadgeClass(message.origin)}">${escapeHTML(originBadgeLabel(message.origin))}</span></div><div class="message-bubble"></div>`;
  const bubble = card.querySelector(".message-bubble");
  if (rendererMode === "rich") {
    richMessageRendererModule.renderMessageBubble(bubble, message, {
      buildCommandPreview,
      buildCommandRawContent,
      onSubmitApproval: submitApprovalDecision,
      onSubmitStructuredInput: submitStructuredUserInputResponse,
      summarizeCommandForDisplay,
    });
    return;
  }

  renderBasicMessageBubble(bubble, message);
}

function chatNeedsRichMessageRenderer(chat) {
  return Boolean(chat?.messages?.some((message) => messageNeedsRichRenderer(message)));
}

function messageNeedsRichRenderer(message) {
  return message?.kind === "plan"
    || message?.kind === "structured-input"
    || message?.kind === "approval";
}

function renderBasicMessageBubble(element, message) {
  if (!element) {
    return;
  }

  element.className = "message-bubble";

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
    renderBasicCommandBubble(element, message);
    return;
  }

  if (message?.kind === "patch") {
    renderBasicPatchBubble(element, message);
    return;
  }

  if (messageNeedsRichRenderer(message)) {
    element.textContent = message.text || "Loading interactive card...";
    return;
  }

  element.textContent = message?.text || "";
}

function renderBasicCommandBubble(element, message) {
  const summaryText = message.summary || summarizeCommandForDisplay(message.command || "Command");
  const previewText = message.preview || buildCommandPreview(message.rawOutput || message.text || "");
  const rawContent = buildCommandRawContent(message);

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
}

function renderBasicPatchBubble(element, message) {
  const patch = String(message?.patch || "");
  const summaryText = message.summary || summarizePatchForDisplayBasic(patch);
  const previewText = message.preview || buildPatchPreviewBasic(patch);

  element.classList.add("patch-bubble");

  const summary = document.createElement("div");
  summary.className = "patch-summary";
  summary.textContent = summaryText;

  const preview = document.createElement("pre");
  preview.className = "patch-preview";
  preview.textContent = previewText;

  element.replaceChildren(summary, preview);
}

function buildPatchPreviewBasic(patch) {
  const files = [];
  for (const line of String(patch || "").replace(/\r/g, "").split("\n")) {
    if (!line.startsWith("diff --git ")) {
      continue;
    }
    const match = line.match(/^diff --git a\/(.+?) b\/.+$/);
    files.push(match?.[1] || line.replace(/^diff --git\s+/, ""));
  }
  return files.length ? files.map((file) => `- ${file}`).join("\n") : "";
}

function summarizePatchForDisplayBasic(patch) {
  const lines = String(patch || "").replace(/\r/g, "").split("\n");
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  if (!files && !additions && !deletions) {
    return "";
  }

  return `Changed ${files} file${files === 1 ? "" : "s"} | +${additions} -${deletions}`;
}

function renderAppChrome() {
  renderMobileDock();
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

function renderMobileDock() {
  const scannerOpen = elements.scannerModal.classList.contains("is-open");
  const settingsOpen = elements.settingsPanel.classList.contains("is-open");
  const { currentView, interactive } = describeMobileDockState({
    isNarrowViewport: isNarrowViewport(),
    mobileThreadOpen: state.mobileThreadOpen,
    modalOpen: anyModalOpen(),
    scannerOpen,
    settingsOpen,
  });

  toggleDockButton(elements.mobileDeckButton, currentView === "deck");
  toggleDockButton(elements.mobileScanDockButton, currentView === "scan");
  toggleDockButton(elements.mobileSettingsDockButton, currentView === "settings");
  syncFocusableRegion(elements.mobileTabBar, interactive);
}

function renderThreadSpotlight(chat) {
  if (!chat) {
    elements.threadSpotlightKicker.textContent = "No active thread";
    elements.threadSpotlightTitle.textContent = "Choose a chat or start a local draft";
    elements.threadSpotlightCopy.textContent = "Pair the browser client, then open a thread to see repo context, runtime mode, and live bridge status here.";
    elements.threadModePill.textContent = "No Thread";
    elements.threadRuntimePill.textContent = "Cloud runtime";
    elements.threadMessageCount.textContent = "0";
    elements.threadBranchValue.textContent = "Unavailable";
    elements.threadAccessValue.textContent = "Waiting";
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
  elements.threadBranchValue.textContent = workspaceSummaryLabel(chat);
  elements.threadAccessValue.textContent = state.connection.label || "Waiting";
  elements.threadSyncValue.textContent = chatHasPendingTurn(chat) ? "Running turn" : (chat.timestamp || state.connection.label);
}

function renderComposerState(chat) {
  const hasPendingTurn = chatHasPendingTurn(chat);
  const hasBlockingRequest = chatHasBlockingServerRequest(chat);
  const isSharedView = messageOriginForChat(chat) === "shared";
  const isBusy = hasPendingTurn || hasBlockingRequest;
  elements.sendButton.disabled = !chat || isBusy;
  elements.sendButton.dataset.loading = hasPendingTurn ? "true" : "false";
  elements.sendButton.setAttribute("aria-busy", isBusy ? "true" : "false");
  elements.sendButton.textContent = hasPendingTurn
    ? "Running..."
    : (hasBlockingRequest
      ? "Needs Response"
      : (!chat ? "Select Chat" : (isSharedView ? "Fork & Send" : "Send")));
  elements.composerInput.placeholder = !chat
    ? "Choose a chat or create a local draft to start sending."
    : (hasPendingTurn
      ? "Wait for the current turn to finish before sending another prompt."
      : (hasBlockingRequest
        ? "Resolve the active approval or questionnaire card before sending a new prompt."
      : (isSharedView
        ? "This shared thread is read-only here. Sending will fork into an isolated web thread."
        : "Ask anything... @files, $skills, /commands")));
  elements.composerStatus.textContent = composerStatusLabel(chat);
}

function renderSettings() {
  elements.fontSelect.value = state.preferences.font;
  elements.glassToggle.checked = state.preferences.glass;
  const notificationState = getBrowserNotificationState(window, navigator);
  const notificationsEnabled = notificationState.permission === "granted" && state.preferences.notifications !== false;

  elements.pushStatusLabel.textContent = describeBrowserNotificationPermission(notificationState.permission);
  if (elements.notificationStatusCopy) {
    elements.notificationStatusCopy.textContent = describeNotificationStatusCopy(notificationState);
  }
  if (elements.notificationToggleButton) {
    elements.notificationToggleButton.disabled = !notificationState.supported;
    elements.notificationToggleButton.textContent = notificationState.permission === "granted"
      ? (notificationsEnabled ? "Pause Alerts" : "Enable Alerts")
      : "Enable Alerts";
  }
  if (elements.notificationTestButton) {
    elements.notificationTestButton.disabled = !(notificationState.permission === "granted" && notificationsEnabled);
  }
}

function renderDiffViewer() {
  const chat = selectedChat();
  const canView = canViewDiffForChat(chat);
  const isCurrentThread = Boolean(chat?.threadId && state.diffViewer.sourceThreadId === chat.threadId);

  elements.threadDiffButton.disabled = !canView;
  elements.threadDiffButton.textContent = state.diffViewer.status === "loading" && isCurrentThread
    ? "Loading..."
    : "View Diff";

  elements.refreshDiffButton.disabled = !canView || (state.diffViewer.status === "loading" && isCurrentThread);
  elements.diffTitle.textContent = chat?.repo ? `${chat.repo} changes` : "Current changes";

  if (!isDiffSheetOpen()) {
    return;
  }

  if (!chat) {
    elements.diffMeta.textContent = "Select a thread to load the latest Codex patch captured for it.";
    renderDiffBodyEmpty("Choose a chat first.");
    return;
  }

  if (!chat.threadId) {
    elements.diffMeta.textContent = "This local draft does not have a remote thread yet.";
    renderDiffBodyEmpty("Send the first prompt so the draft becomes a real thread, then the latest patch can show here.");
    return;
  }

  if (!state.client || state.connection.status !== "ready") {
    elements.diffMeta.textContent = `${truncate(chat.threadId, 40)} | Connect the bridge to read the latest captured patch.`;
    renderDiffBodyEmpty("Reconnect the bridge, then refresh to load the latest Codex patch for this thread.");
    return;
  }

  if (state.diffViewer.status === "loading" && isCurrentThread) {
    elements.diffMeta.textContent = `${truncate(chat.threadId, 40)} | Loading latest patch...`;
    renderDiffBodyEmpty("Loading the latest Codex patch for this thread...");
    return;
  }

  if (state.diffViewer.status === "error" && isCurrentThread) {
    elements.diffMeta.textContent = `${truncate(chat.threadId, 40)} | Could not load the patch.`;
    renderDiffBodyEmpty(state.diffViewer.error || "Could not load the latest Codex patch.");
    return;
  }

  if (state.diffViewer.status === "empty" && isCurrentThread) {
    elements.diffMeta.textContent = `${truncate(chat.threadId, 40)} | No captured patch yet.`;
    renderDiffBodyEmpty("No exact Codex patch has been captured for this thread yet.");
    return;
  }

  if (state.diffViewer.status === "ready" && isCurrentThread) {
    elements.diffMeta.textContent = buildDiffMeta({
      callId: state.diffViewer.callId,
      patch: state.diffViewer.patch,
      threadId: chat.threadId,
      turnId: state.diffViewer.turnId,
      loadedAt: state.diffViewer.loadedAt,
    });
    if (!richMessageRendererModule) {
      renderDiffBodyEmpty("Loading the exact diff renderer...");
      void ensureRichMessageRenderer().then(() => {
        if (isDiffSheetOpen()) {
          renderDiffViewer();
        }
      });
      return;
    }
    renderUnifiedDiff(elements.diffBody, state.diffViewer.patch);
    return;
  }

  elements.diffMeta.textContent = `${truncate(chat.threadId, 40)} | Tap refresh to load the latest patch.`;
  renderDiffBodyEmpty("No Codex patch has been loaded for this thread yet.");
}

function isDiffSheetOpen() {
  return elements.diffSheet.classList.contains("is-open");
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
    renderAfterChatStateChange({
      includeDeckSummary: true,
      includeLogs: true,
    });
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
    renderAfterChatStateChange({
      includeDeckSummary: true,
      includeLogs: true,
    });
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
    setMobileThreadOpen(true);
  }
  if (render) {
    addLog("info", "Created a new local draft thread.", group.folder);
    pulseHaptic(12);
    renderAfterChatStateChange({
      includeDeckSummary: true,
      includeDiffViewer: true,
      includeLogs: true,
    });
    focusComposer();
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
  autosizeComposer();
  pulseHaptic(16);
  renderAfterChatStateChange({
    includeDeckSummary: true,
    includeDiffViewer: true,
  });

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
    renderThreadSpotlight(chat);

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
  pulseHaptic(10);
  openModal(elements.settingsPanel);
  renderAppChrome();
}

function closeSettings() {
  closeModal(elements.settingsPanel);
  renderAppChrome();
}

function openBranchSheet() {
  const chat = selectedChat();
  if (!elements.branchSheet) {
    return;
  }

  if (elements.branchError) {
    elements.branchError.textContent = "";
  }
  if (elements.branchContext) {
    elements.branchContext.textContent = chat?.cwd
      ? `${chat.repo || "Workspace"} | ${chat.branch || "main"} | ${truncate(chat.cwd, 72)}`
      : `${chat?.repo || "Workspace"} | ${chat?.branch || "main"}`;
  }
  if (elements.branchNameInput) {
    elements.branchNameInput.value = suggestBranchName(chat);
  }
  if (elements.branchSubmitButton) {
    elements.branchSubmitButton.disabled = false;
    elements.branchSubmitButton.textContent = "Create Branch";
  }

  pulseHaptic(10);
  openModal(elements.branchSheet);
  renderAppChrome();

  window.requestAnimationFrame(() => {
    elements.branchNameInput?.focus();
    elements.branchNameInput?.select();
  });
}

function closeBranchSheet() {
  closeModal(elements.branchSheet);
  renderAppChrome();
}

function openScanner() {
  pulseHaptic(10);
  openModal(elements.scannerModal);
  renderAppChrome();
  elements.scannerStatus.textContent = state.capabilities.secureContext
    ? "Use the rear camera or import a QR image."
    : "This page needs HTTPS or localhost for camera access.";
  if (state.capabilities.secureContext) {
    void startScanner();
  }
}

function closeScanner() {
  scanner?.stop();
  closeModal(elements.scannerModal);
  renderAppChrome();
}

async function openDiff() {
  const chat = selectedChat();
  if (!canViewDiffForChat(chat)) {
    return;
  }

  pulseHaptic(10);
  openModal(elements.diffSheet);
  renderAppChrome();
  renderDiffViewer();

  if (state.diffViewer.sourceThreadId !== chat.threadId || state.diffViewer.status === "idle" || state.diffViewer.status === "error") {
    await refreshDiffForSelectedChat();
  }
}

function closeDiff() {
  closeModal(elements.diffSheet);
  renderAppChrome();
}

async function toggleBrowserNotifications() {
  const notificationState = getBrowserNotificationState(window, navigator);
  if (!notificationState.supported) {
    addLog("warn", "This browser does not support notifications.", "notifications");
    renderLogs();
    return;
  }

  if (notificationState.permission === "denied") {
    addLog("warn", "Notifications are blocked in browser settings for this browser shell.", "notifications");
    renderLogs();
    renderSettings();
    return;
  }

  if (notificationState.permission !== "granted") {
    const permission = await requestBrowserNotificationPermission(window);
    if (permission === "granted") {
      state.preferences.notifications = true;
      persistPreferences();
      addLog("info", "Browser notifications enabled.", "notifications");
    } else {
      addLog("warn", "Notification permission was not granted.", "notifications");
    }
    renderLogs();
    renderSettings();
    return;
  }

  state.preferences.notifications = !state.preferences.notifications;
  persistPreferences();
  addLog("info", state.preferences.notifications ? "Browser notifications resumed." : "Browser notifications paused.", "notifications");
  renderLogs();
  renderSettings();
}

async function sendTestBrowserNotification() {
  const delivered = await dispatchBrowserNotification({
    body: "Completion, approval, and plan prompts will use this channel.",
    requireHidden: false,
    tag: "remodex-web:test",
    title: "Remodex Web alerts",
  });
  addLog(delivered ? "info" : "warn", delivered ? "Delivered a test notification." : "Could not deliver a test notification.", "notifications");
  renderLogs();
}

async function refreshDiffForSelectedChat() {
  const chat = selectedChat();
  if (!canViewDiffForChat(chat)) {
    renderDiffViewer();
    return;
  }

  state.diffViewer = {
    callId: "",
    error: "",
    loadedAt: state.diffViewer.loadedAt,
    patch: "",
    sourceThreadId: chat.threadId,
    status: "loading",
    turnId: "",
    };
    renderDiffViewer();

    try {
      const result = await state.client.readThreadPatch(chat.threadId);
      const patch = resolveDisplayPatchResult(result);
      state.diffViewer = {
        callId: result?.callId || "",
        error: "",
        loadedAt: result?.timestamp ? Date.parse(result.timestamp) || Date.now() : Date.now(),
      patch,
      sourceThreadId: chat.threadId,
      status: patch ? "ready" : "empty",
      turnId: result?.turnId || "",
    };
    renderDiffViewer();
  } catch (error) {
    state.diffViewer = {
      callId: "",
      error: error.message || "Could not load the latest Codex patch.",
      loadedAt: 0,
      patch: "",
      sourceThreadId: chat.threadId,
      status: "error",
      turnId: "",
    };
    addLog("error", state.diffViewer.error, "thread/patch/read");
    renderDiffViewer();
    renderLogs();
  }
}

async function syncLatestPatchForChat(chat) {
  if (!state.client || state.connection.status !== "ready" || !chat?.threadId) {
    return;
  }

  try {
    const result = await state.client.readThreadPatch(chat.threadId);
    const patch = resolveDisplayPatchResult(result);
    if (!patch) {
      return;
    }

    const messageId = `patch:${result?.callId || result?.turnId || hashString(patch)}`;
    const timestamp = result?.timestamp
      ? new Date(result.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "changed";

    let message = chat.messages.find((entry) => entry.id === messageId);
    if (!message) {
      message = {
        id: messageId,
        role: "assistant",
        author: "Changed files",
        kind: "patch",
        origin: messageOriginForChat(chat),
        patch,
        preview: buildPatchPreviewBasic(patch),
        summary: summarizePatchForDisplayBasic(patch),
        time: timestamp,
        text: "",
      };
      chat.messages.push(message);
    } else {
      message.author = "Changed files";
      message.kind = "patch";
      message.origin = message.origin || messageOriginForChat(chat);
      message.patch = patch;
      message.preview = buildPatchPreviewBasic(patch);
      message.summary = summarizePatchForDisplayBasic(patch);
      message.time = timestamp;
    }

    if (state.diffViewer.sourceThreadId === chat.threadId || elements.diffSheet.classList.contains("is-open")) {
      state.diffViewer = {
        callId: result?.callId || "",
        error: "",
        loadedAt: result?.timestamp ? Date.parse(result.timestamp) || Date.now() : Date.now(),
        patch,
        sourceThreadId: chat.threadId,
        status: "ready",
        turnId: result?.turnId || "",
      };
    }

    persistThreadCacheForChat(chat);
    if (selectedChat()?.id === chat.id) {
      scheduleConversationRenderForChat(chat);
      renderDiffViewer();
    }
  } catch (error) {
    addLog("warn", error.message || "Could not read the latest Codex patch.", "thread/patch/read");
    renderLogs();
  }
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
    const scannerController = await getScannerController();
    scannerController.stop();
    await scannerController.start({
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

async function getScannerController() {
  if (scanner) {
    return scanner;
  }

  const { createScannerController } = await import("./modules/scanner-controller.mjs");
  scanner = createScannerController({ videoElement: elements.scannerVideo });
  return scanner;
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
  const { createBrowserBridgeClient } = await ensureBridgeClientModule();
  state.client = createBrowserBridgeClient({
    pairingPayload: state.pairingPayload,
    relayBaseUrl,
    onApplicationMessage() {},
    onConnectionState(connectionState) {
      const connectionChanged = !isSameConnectionState(state.connection, connectionState);
      state.connection = connectionState;
      if (elements.scannerModal.classList.contains("is-open")) {
        setScannerStatus(`${connectionState.label}: ${connectionState.detail}`);
      }
      if (!connectionChanged) {
        return;
      }
      renderConnection();
      renderDeckSummary();
      renderThreadSpotlight(selectedChat());
      renderDiffViewer();
    },
    onLog(level, message, meta) {
      addLog(level, message, meta);
      renderLogs();
    },
    onNotification(notification) {
      handleNotification(notification);
    },
    onServerRequest(request) {
      handleServerRequest(request);
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
    renderDeckSummary();
    renderThreadSpotlight(selectedChat());
    renderDiffViewer();
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
    renderDeckSummary();
    renderThreadSpotlight(selectedChat());
    renderDiffViewer();
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
  renderAfterPairingStateChange();
  renderLogs();
  if (autoConnect) {
    await connectRelay();
    if (state.connection.status === "ready") {
      scanner?.stop();
      closeModal(elements.scannerModal);
    }
  }
}

function updatePreference(key, value) {
  state.preferences[key] = value;
  persistPreferences();
  renderAfterPreferenceChange();
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
  renderAfterChatStateChange({
    includeDiffViewer: true,
    includeSidebar: true,
  });
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
  return findChatById(state.selectedChatId);
}

function findChatById(chatId) {
  if (!chatId) {
    return null;
  }

  for (const group of state.conversations) {
    const chat = group.chats.find((candidate) => candidate.id === chatId);
    if (chat) {
      return chat;
    }
  }
  return null;
}

function selectChatById(chatId, {
  closeSidebar = true,
  focusComposerInput = true,
  hapticMs = 10,
} = {}) {
  const chat = findChatById(chatId);
  if (!chat) {
    return null;
  }

  const previousSelectedChatId = state.selectedChatId;
  state.selectedChatId = chat.id;
  applyThreadRuntimeToPreferences(chat);
  if (closeSidebar) {
    state.sidebarOpen = false;
  }
  if (isNarrowViewport()) {
    state.mobileThreadOpen = true;
  }
  if (hapticMs > 0) {
    pulseHaptic(hapticMs);
  }

  renderAfterChatSelection(previousSelectedChatId);
  if (focusComposerInput) {
    focusComposer();
  }
  if (chat.threadId && !chat.messagesLoaded) {
    void readRemoteThread(chat.threadId);
  }
  return chat;
}

function renderAfterChatSelection(previousSelectedChatId = "") {
  renderBody();
  renderSelects();
  syncSidebarSelection(previousSelectedChatId, state.selectedChatId);
  renderConversationNow();
  renderConnection();
  renderRuntimeStrip();
  renderDiffViewer();
  autosizeComposer();
  renderAppChrome();
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
  renderAfterChatStateChange({
    includeDeckSummary: true,
    includeDiffViewer: true,
  });
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
  renderAfterChatStateChange({
    includeDeckSummary: true,
    includeDiffViewer: true,
    includeSidebar: true,
  });
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
    renderAfterChatStateChange({
      includeDeckSummary: true,
      includeDiffViewer: true,
      includeSidebar: true,
    });
  }

  const latestTurn = result.thread?.turns?.[result.thread.turns.length - 1];
  if (!latestTurn || latestTurn.status !== "inProgress" || attemptsRemaining <= 1) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, 900));
  await pollThreadUntilSettled(threadId, attemptsRemaining - 1);
}

function handleServerRequest(request) {
  const method = typeof request?.method === "string" ? request.method : "";
  if (!method) {
    return;
  }

  if (method === "item/tool/requestUserInput" || method === "tool/requestUserInput") {
    applyStructuredUserInputRequest(request.id, request.params);
    return;
  }

  if (
    method === "item/commandExecution/requestApproval"
    || method === "item/fileChange/requestApproval"
    || method.endsWith("requestApproval")
  ) {
    applyApprovalRequest(request.id, method, request.params);
    return;
  }

  void state.client?.rejectServerRequest(request.id, {
    code: -32601,
    message: `Unsupported request method: ${method}`,
  }).catch((error) => {
    addLog("error", error.message || "Failed to reject an unsupported server request.", method);
    renderLogs();
  });
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

  if (method === "turn/plan/updated") {
    applyTurnPlanUpdatedNotification(notification.params);
    return;
  }

  if (method === "item/plan/delta") {
    applyPlanDeltaNotification(notification.params);
    return;
  }

  if (method === "serverRequest/resolved") {
    applyServerRequestResolvedNotification(notification.params);
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
    const threadId = resolveThreadIdFromParams(notification.params, state.threadIdByTurnId);
    const turnId = resolveTurnIdFromParams(notification.params, { allowTopLevelId: true });
    rememberThreadTurnMapping(state.threadIdByTurnId, threadId, turnId);
    if (threadId) {
      const chat = findChatByThreadId(threadId);
      if (chat) {
        chat.messages = chat.messages.filter((message) => !message.pending);
        finalizePlanMessages(chat, turnId);
        persistThreadCacheForChat(chat);
        schedulePatchCapture(threadId);
        void dispatchBrowserNotification({
          body: `${chat.title || "Thread"} is ready.`,
          tag: `remodex-web:turn:${threadId}`,
          title: "Turn completed",
        });
      }
    }
  }

  if (method === "turn/started") {
    const threadId = resolveThreadIdFromParams(notification.params, state.threadIdByTurnId);
    const turnId = resolveTurnIdFromParams(notification.params, { allowTopLevelId: true });
    rememberThreadTurnMapping(state.threadIdByTurnId, threadId, turnId);
    if (threadId) {
      const chat = findChatByThreadId(threadId);
      if (chat) {
        const pendingMessage = [...chat.messages].reverse().find((message) => message.pending);
        if (pendingMessage) {
          pendingMessage.text = "Sent. Codex started the turn.";
          pendingMessage.time = "started";
          queueChatPersistenceAndRender(chat);
        }
      }
    }
  }

  addLog("info", `Received ${method}.`, "notification");
  renderLogs();

  if (method === "turn/completed" || method.startsWith("thread/")) {
    const threadId = notification.params?.threadId || notification.params?.thread?.id || notification.params?.thread?.threadId;
    if (
      threadId
      && selectedChat()?.threadId === threadId
      && elements.diffSheet.classList.contains("is-open")
    ) {
      void refreshDiffForSelectedChat();
    }
    scheduleRefresh(threadId || selectedChat()?.threadId || null);
  }
}

function applyStructuredUserInputRequest(requestId, params) {
  const update = upsertStructuredUserInputRequest({
    findChatByThreadId,
    messageOriginForChat,
    params,
    requestId,
    threadIdByTurnId: state.threadIdByTurnId,
  });
  if (!update) {
    return;
  }

  const { chat, requestId: normalizedRequestId } = update;
  queueChatPersistenceAndRender(chat);
  void dispatchBrowserNotification({
    body: `${chat.title || "Thread"} needs a quick answer before it can continue.`,
    tag: `remodex-web:request:${normalizedRequestId}`,
    title: "Plan input needed",
  });
}

function applyApprovalRequest(requestId, method, params) {
  const update = upsertApprovalRequest({
    findChatByThreadId,
    messageOriginForChat,
    method,
    params,
    requestId,
    threadIdByTurnId: state.threadIdByTurnId,
  });
  if (!update) {
    return;
  }

  const { chat, message, requestId: normalizedRequestId } = update;
  queueChatPersistenceAndRender(chat);
  void dispatchBrowserNotification({
    body: message.approval.reason || summarizeCommandForDisplay(message.approval.command || "Pending approval"),
    tag: `remodex-web:approval:${normalizedRequestId}`,
    title: "Approval required",
  });
}

function applyTurnPlanUpdatedNotification(params) {
  const update = applyTurnPlanUpdated({
    findChatByThreadId,
    messageOriginForChat,
    params,
    threadIdByTurnId: state.threadIdByTurnId,
  });
  if (!update) {
    return;
  }

  const { chat } = update;
  queueChatPersistenceAndRender(chat);
}

function applyPlanDeltaNotification(params) {
  const update = applyPlanDelta({
    findChatByThreadId,
    messageOriginForChat,
    params,
    threadIdByTurnId: state.threadIdByTurnId,
  });
  if (!update) {
    return;
  }

  const { chat } = update;
  queueChatPersistenceAndRender(chat);
}

function applyServerRequestResolvedNotification(params) {
  const update = resolveServerRequestInChats({
    findChatByThreadId,
    flattenChats: () => flattenChats(state.conversations),
    params,
    threadIdByTurnId: state.threadIdByTurnId,
  });
  if (!update) {
    return;
  }

  const { chat } = update;
  queueChatPersistenceAndRender(chat);
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

function schedulePatchCapture(threadId) {
  if (!threadId) {
    return;
  }

  const existingTimer = patchRefreshTimers.get(threadId);
  if (existingTimer) {
    window.clearTimeout(existingTimer);
  }

  const timerId = window.setTimeout(() => {
    patchRefreshTimers.delete(threadId);
    const chat = findChatByThreadId(threadId);
    if (!chat) {
      return;
    }
    void syncLatestPatchForChat(chat);
  }, 550);

  patchRefreshTimers.set(threadId, timerId);
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
  renderAfterChatStateChange({
    includeDeckSummary: true,
    includeDiffViewer: true,
    includeSidebar: true,
  });
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

  openBranchSheet();
}

async function submitBranchCreation() {
  const chat = selectedChat();
  if (!state.client || !chat?.cwd || !elements.branchNameInput) {
    return;
  }

  const name = elements.branchNameInput.value.trim();
  if (!name) {
    showBranchError("Enter a branch name.");
    return;
  }

  if (elements.branchSubmitButton) {
    elements.branchSubmitButton.disabled = true;
    elements.branchSubmitButton.textContent = "Creating...";
  }
  showBranchError("");

  try {
    const result = await state.client.gitCreateBranch(chat.cwd, name);
    chat.branch = result.branch || name;
    await refreshBranchCatalog(chat);
    addLog("info", "Created git branch.", chat.branch);
    closeBranchSheet();
    renderAfterChatStateChange({
      includeDiffViewer: true,
      includeSidebar: false,
      includeLogs: true,
    });
  } catch (error) {
    showBranchError(error.message || "Failed to create the branch.");
    addLog("error", error.message || "Failed to create the branch.", "git/createBranch");
    renderLogs();
  } finally {
    if (elements.branchSubmitButton) {
      elements.branchSubmitButton.disabled = false;
      elements.branchSubmitButton.textContent = "Create Branch";
    }
  }
}

function showBranchError(message) {
  if (elements.branchError) {
    elements.branchError.textContent = message || "";
  }
}

function suggestBranchName(chat) {
  const repoPart = String(chat?.repo || "workspace")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const branchPart = String(chat?.branch || "main")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `web/${repoPart || "workspace"}-${branchPart || "main"}-update`;
}

function composerStatusLabel(chat) {
  if (chatHasBlockingServerRequest(chat)) {
    return "Action required";
  }
  return state.connection.label;
}

function describeNotificationStatusCopy(notificationState) {
  if (!notificationState.supported) {
    return "This browser does not expose local notifications for the web shell.";
  }
  if (notificationState.permission === "denied") {
    return "Notifications are blocked for this page. Re-enable them in browser site settings.";
  }
  if (notificationState.permission !== "granted") {
    return "Ask for permission to receive turn-complete, approval, and plan-input alerts.";
  }
  return state.preferences.notifications === false
    ? "Permission is granted, but Remodex alerts are paused for this browser shell."
    : "Completion, approval, and plan-input alerts are enabled when the page is in the background.";
}

async function dispatchBrowserNotification({
  body,
  requireHidden = true,
  tag,
  title,
} = {}) {
  if (state.preferences.notifications === false) {
    return false;
  }

  return sendBrowserNotification({
    body,
    navigatorLike: navigator,
    requireHidden,
    tag,
    title,
    windowLike: window,
  });
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
  queueChatPersistenceAndRender(chat);
}

function applyCompletedItemNotification(params) {
  const threadId = resolveThreadIdFromParams(params, state.threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  const item = params?.item;
  if (!threadId || !item?.type) {
    return;
  }
  rememberThreadTurnMapping(state.threadIdByTurnId, threadId, turnId);

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

  if (item.type === "plan") {
    const message = ensurePlanMessage(chat, {
      itemId: item.id,
      messageOrigin: messageOriginForChat(chat),
      turnId,
    });
    message.text = normalizePlanItemText(item) || message.text || "Plan updated.";
    message.planState = {
      explanation: normalizePlanExplanation(item.explanation) || message.planState?.explanation || "",
      isStreaming: false,
      presentation: "result",
      steps: normalizePlanSteps(item.plan, { completeAll: params?.turn?.status === "completed" || params?.status === "completed" }),
    };
    message.time = "completed";
  }

  queueChatPersistenceAndRender(chat);
}

function applyStartedItemNotification(params) {
  const threadId = resolveThreadIdFromParams(params, state.threadIdByTurnId);
  const turnId = resolveTurnIdFromParams(params);
  const item = params?.item;
  if (!threadId || !item?.type) {
    return;
  }
  rememberThreadTurnMapping(state.threadIdByTurnId, threadId, turnId);

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

  if (item.type === "plan") {
    const message = ensurePlanMessage(chat, {
      itemId: item.id,
      messageOrigin: messageOriginForChat(chat),
      turnId,
    });
    message.text = message.text || "Building the plan...";
    message.planState = {
      ...(message.planState || {}),
      isStreaming: true,
      presentation: "progress",
      steps: message.planState?.steps || [],
    };
    message.time = "running";
  }

  queueChatPersistenceAndRender(chat);
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
    queueChatPersistenceAndRender(chat);
    return;
  }

  if (message.text === "Thinking...") {
    message.text = "";
  }

  if (method === "item/reasoning/summaryTextDelta" && message.text && !message.text.endsWith("\n")) {
    message.text += "\n";
  }
  message.text += delta;
  queueChatPersistenceAndRender(chat);
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
  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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
  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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
  queueChatPersistenceAndRender(chat);
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
  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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

  queueChatPersistenceAndRender(chat);
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
  threadCacheWriter.schedule();
}

function persistLastThreadId(threadId) {
  const normalizedThreadId = threadId || null;
  if (persistedLastThreadId === normalizedThreadId) {
    return;
  }

  persistedLastThreadId = normalizedThreadId;
  saveStoredLastThreadId(normalizedThreadId);
}

function setOptions(select, values, selectedValue = select.value) {
  const normalizedValues = values.map((value) => String(value));
  const nextOptionsKey = normalizedValues.join("\u001f");
  if (select.__remodexOptionsKey !== nextOptionsKey) {
    select.__remodexOptionsKey = nextOptionsKey;
    select.replaceChildren(...normalizedValues.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      return option;
    }));
  }
  const normalizedSelectedValue = String(selectedValue);
  if (normalizedValues.includes(normalizedSelectedValue) && select.value !== normalizedSelectedValue) {
    select.value = normalizedSelectedValue;
  }
}

function setOptionEntries(select, entries, selectedValue = select.value) {
  const normalizedEntries = entries.map((entry) => ({
    label: String(entry.label),
    value: String(entry.value),
  }));
  const nextOptionsKey = normalizedEntries.map((entry) => `${entry.value}\u0000${entry.label}`).join("\u001f");
  if (select.__remodexOptionEntriesKey !== nextOptionsKey) {
    select.__remodexOptionEntriesKey = nextOptionsKey;
    select.replaceChildren(...normalizedEntries.map((entry) => {
      const option = document.createElement("option");
      option.value = entry.value;
      option.textContent = entry.label;
      return option;
    }));
  }
  const normalizedSelectedValue = String(selectedValue);
  if (normalizedEntries.some((entry) => entry.value === normalizedSelectedValue)) {
    if (select.value !== normalizedSelectedValue) {
      select.value = normalizedSelectedValue;
    }
  } else if (normalizedEntries[0] && select.value !== normalizedEntries[0].value) {
    select.value = normalizedEntries[0].value;
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
    return "Shared thread";
  }
  return chat.writable
    ? "Web thread"
    : "Desktop thread";
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
      return "Web";
    case "shared":
      return "Shared";
    case "desktop":
      return "Desktop";
    case "local":
      return "Draft";
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
      return "Desktop";
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
      return "Desktop";
    case "local":
      return "Local Draft";
    default:
      return "Unknown";
  }
}

function compactThreadSubtitle(chat) {
  if (chat.cwd) {
    return `${truncate(chat.cwd, 72)} | ${chat.access || "Unknown"} | ${state.connection.label}`;
  }
  if (chat.originUrl) {
    return `${truncate(chat.originUrl, 72)} | ${state.connection.label}`;
  }
  return `${chat.access || "Unknown"} | ${state.connection.label}`;
}

function workspaceSummaryLabel(chat) {
  if (chat.cwd) {
    const segments = String(chat.cwd).split(/[\\/]/).filter(Boolean);
    return truncate(segments.at(-1) || chat.cwd, 28);
  }
  if (chat.repo) {
    return truncate(chat.repo, 28);
  }
  return "Browser shell";
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

async function submitStructuredUserInputResponse(message) {
  const questions = message.structuredInput?.questions || [];
  const answersByQuestionId = {};

  for (const question of questions) {
    const answers = collectStructuredQuestionAnswers(question, message);
    if (!answers.length) {
      message.error = `Answer "${question.header || question.question}" before sending.`;
      renderConversationNow();
      return;
    }
    answersByQuestionId[question.id] = answers;
  }

  message.error = "";
  message.resolving = true;
  renderConversationNow();

  try {
    await state.client?.respondToServerRequest(
      message.requestId,
      buildStructuredUserInputResponse(answersByQuestionId)
    );
  } catch (error) {
    message.error = error.message || "Could not send the answers.";
    message.resolving = false;
    renderConversationNow();
  }
}

async function submitApprovalDecision(message, decision) {
  message.error = "";
  message.resolving = true;
  renderConversationNow();

  try {
    await state.client?.respondToServerRequest(message.requestId, {
      decision,
    });
  } catch (error) {
    message.error = error.message || "Could not send the approval decision.";
    message.resolving = false;
    renderConversationNow();
  }
}

function collectStructuredQuestionAnswers(question, message) {
  return Array.isArray(message.draftAnswers?.[question.id])
    ? message.draftAnswers[question.id]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
    : [];
}

function addLog(level, message, meta = new Date().toLocaleTimeString()) {
  state.logs.unshift({ level, message, meta });
  state.logs = state.logs.slice(0, 8);
}

function canViewDiffForChat(chat) {
  return Boolean(chat?.threadId && state.client && state.connection.status === "ready");
}

function renderDiffBodyEmpty(message) {
  const renderKey = `empty:${message}`;
  if (elements.diffBody.dataset.renderKey === renderKey) {
    return;
  }

  elements.diffBody.dataset.renderKey = renderKey;
  elements.diffBody.replaceChildren(createEmptyDiffState(message));
}

function createEmptyDiffState(message) {
  const panel = document.createElement("section");
  panel.className = "empty-panel empty-panel-diff";
  panel.innerHTML = `
    <p class="empty-kicker">Diff</p>
    <h3>${escapeHTML(message)}</h3>
    <p>When Codex captures an apply_patch edit for this thread, the exact patch will show up here.</p>
  `;
  return panel;
}

function renderUnifiedDiff(container, patch) {
  if (!patch.trim()) {
    renderDiffBodyEmpty("No exact Codex patch has been captured for this thread yet.");
    return;
  }

  if (!richMessageRendererModule) {
    renderDiffBodyEmpty("Loading the exact diff renderer...");
    return;
  }

  const renderKey = `diff:${hashString(patch)}:rich`;
  if (container.dataset.renderKey === renderKey) {
    return;
  }

  container.dataset.renderKey = renderKey;
  richMessageRendererModule.renderUnifiedDiffInto(container, patch);
}

function resolveDisplayPatchResult(result) {
  const displayPatch = typeof result?.displayPatch === "string" ? result.displayPatch : "";
  if (displayPatch.trim()) {
    return displayPatch;
  }
  return typeof result?.patch === "string" ? result.patch : "";
}

function buildDiffMeta({ threadId, turnId, callId, patch, loadedAt }) {
  const summary = summarizeDiffPatch(patch);
  const pieces = [truncate(threadId, 40)];
  if (turnId) {
    pieces.push(`turn ${truncate(turnId, 16)}`);
  }
  if (callId) {
    pieces.push(`patch ${truncate(callId, 14)}`);
  }
  if (summary.files > 0) {
    pieces.push(`${summary.files} file${summary.files === 1 ? "" : "s"}`);
  }
  if (summary.additions > 0 || summary.deletions > 0) {
    pieces.push(`+${summary.additions} -${summary.deletions}`);
  }
  if (loadedAt) {
    pieces.push(new Date(loadedAt).toLocaleTimeString());
  }
  return pieces.join(" | ");
}

function summarizeDiffPatch(patch) {
  const lines = String(patch || "").replace(/\r/g, "").split("\n");
  let files = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      files += 1;
      continue;
    }
    if (line.startsWith("+++ ") || line.startsWith("--- ")) {
      continue;
    }
    if (line.startsWith("+")) {
      additions += 1;
      continue;
    }
    if (line.startsWith("-")) {
      deletions += 1;
    }
  }

  return { additions, deletions, files };
}

function openModal(element) {
  if (!element) {
    return;
  }
  const activeElement = document.activeElement;
  modalFocusRestore.set(element, activeElement instanceof HTMLElement ? activeElement : null);
  element.classList.add("is-open");
  element.removeAttribute("inert");
  element.setAttribute("aria-hidden", "false");
  elements.body.classList.add("modal-open");
  window.requestAnimationFrame(() => {
    const focusTarget = element.querySelector("button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])");
    focusTarget?.focus();
  });
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
  if (!anyModalOpen()) {
    elements.body.classList.remove("modal-open");
  }

  const restoreTarget = modalFocusRestore.get(element);
  if (restoreTarget instanceof HTMLElement) {
    restoreTarget.focus({ preventScroll: true });
  }
}

function anyModalOpen() {
  return elements.settingsPanel.classList.contains("is-open")
    || elements.scannerModal.classList.contains("is-open")
    || elements.diffSheet.classList.contains("is-open")
    || elements.branchSheet?.classList.contains("is-open");
}

function wireSwipeGestures() {
  if (!elements.appFrame) {
    return;
  }

  elements.appFrame.addEventListener("touchstart", handleSwipeStart, { passive: true });
  elements.appFrame.addEventListener("touchmove", handleSwipeMove, { passive: false });
  elements.appFrame.addEventListener("touchend", handleSwipeEnd, { passive: true });
  elements.appFrame.addEventListener("touchcancel", resetSwipeGesture, { passive: true });
}

function handleSwipeStart(event) {
  if (!isNarrowViewport() || anyModalOpen()) {
    resetSwipeGesture();
    return;
  }

  const touch = event.touches?.[0];
  const target = event.target instanceof Element ? event.target : null;
  if (!touch || !target || isBlockedSwipeTarget(target)) {
    resetSwipeGesture();
    return;
  }

  if (state.mobileThreadOpen) {
    const startedFromEdge = touch.clientX <= 28;
    const startedFromHeader = Boolean(target.closest(".conversation-header"));
    if (!startedFromEdge && !startedFromHeader) {
      resetSwipeGesture();
      return;
    }
    swipeGesture.mode = "close";
  } else {
    const swipedChatId = target.closest(".chat-item")?.dataset.chatId || "";
    if ((!selectedChat() && !swipedChatId) || !target.closest(".sidebar")) {
      resetSwipeGesture();
      return;
    }
    swipeGesture.mode = "open";
  }

  swipeGesture.active = true;
  swipeGesture.chatId = target.closest(".chat-item")?.dataset.chatId || state.selectedChatId || "";
  swipeGesture.horizontal = false;
  swipeGesture.lastX = touch.clientX;
  swipeGesture.startX = touch.clientX;
  swipeGesture.startY = touch.clientY;
}

function handleSwipeMove(event) {
  if (!swipeGesture.active) {
    return;
  }

  const touch = event.touches?.[0];
  if (!touch) {
    return;
  }

  swipeGesture.lastX = touch.clientX;
  const deltaX = touch.clientX - swipeGesture.startX;
  const deltaY = touch.clientY - swipeGesture.startY;

  if (!swipeGesture.horizontal) {
    if (Math.abs(deltaX) < 10 && Math.abs(deltaY) < 10) {
      return;
    }
    if (Math.abs(deltaY) >= Math.abs(deltaX)) {
      resetSwipeGesture();
      return;
    }
    swipeGesture.horizontal = true;
  }

  const movingInExpectedDirection = swipeGesture.mode === "close"
    ? deltaX > 0
    : deltaX < 0;
  if (!movingInExpectedDirection) {
    return;
  }

  event.preventDefault();
  updateSwipePreview(deltaX);
}

function handleSwipeEnd(event) {
  if (!swipeGesture.active) {
    return;
  }

  const changedTouch = event.changedTouches?.[0];
  const endX = changedTouch?.clientX ?? swipeGesture.lastX;
  const deltaX = endX - swipeGesture.startX;
  const completed = swipeGesture.mode === "close"
    ? deltaX > 72
    : deltaX < -72;

  clearSwipePreview();
  if (completed) {
    pulseHaptic(10);
    if (swipeGesture.mode === "open" && swipeGesture.chatId) {
      selectChatById(swipeGesture.chatId, {
        closeSidebar: false,
        focusComposerInput: false,
        hapticMs: 0,
      });
    } else {
      state.mobileThreadOpen = false;
      renderBody();
      renderConnection();
      renderAppChrome();
    }
  }
  resetSwipeGesture();
}

function updateSwipePreview(deltaX) {
  if (!elements.sidebar || !elements.conversationShell) {
    return;
  }

  const distance = swipeGesture.mode === "close"
    ? Math.max(0, deltaX)
    : Math.max(0, -deltaX);
  const progress = Math.min(distance / 120, 1);

  elements.sidebar.classList.add("is-gesture-sliding");
  elements.conversationShell.classList.add("is-gesture-sliding");
  elements.conversationShell.style.visibility = "visible";
  elements.conversationShell.style.pointerEvents = "auto";

  if (swipeGesture.mode === "close") {
    elements.conversationShell.style.transform = `translateX(${distance}px)`;
    elements.conversationShell.style.opacity = String(1 - progress * 0.28);
    elements.sidebar.style.transform = `translateX(${Math.round(-36 + (36 * progress))}px)`;
    elements.sidebar.style.opacity = String(0.45 + progress * 0.55);
    return;
  }

  elements.conversationShell.style.transform = `translateX(${Math.max(28 - distance, 0)}px)`;
  elements.conversationShell.style.opacity = String(0.18 + progress * 0.82);
  elements.sidebar.style.transform = `translateX(${-Math.min(distance * 0.12, 24)}px)`;
  elements.sidebar.style.opacity = String(1 - progress * 0.22);
}

function clearSwipePreview() {
  if (!elements.sidebar || !elements.conversationShell) {
    return;
  }

  elements.sidebar.classList.remove("is-gesture-sliding");
  elements.conversationShell.classList.remove("is-gesture-sliding");
  elements.sidebar.style.removeProperty("transform");
  elements.sidebar.style.removeProperty("opacity");
  elements.conversationShell.style.removeProperty("transform");
  elements.conversationShell.style.removeProperty("opacity");
  elements.conversationShell.style.removeProperty("visibility");
  elements.conversationShell.style.removeProperty("pointer-events");
}

function resetSwipeGesture() {
  clearSwipePreview();
  swipeGesture.active = false;
  swipeGesture.chatId = "";
  swipeGesture.horizontal = false;
  swipeGesture.lastX = 0;
  swipeGesture.mode = "";
  swipeGesture.startX = 0;
  swipeGesture.startY = 0;
}

function isBlockedSwipeTarget(target) {
  return Boolean(target.closest("input, textarea, select, option, [contenteditable='true']"));
}

function isNarrowViewport() {
  return window.matchMedia("(max-width: 920px)").matches;
}

function handleGlobalKeydown(event) {
  if (event.key !== "Escape" || event.defaultPrevented) {
    return;
  }

  if (elements.diffSheet.classList.contains("is-open")) {
    event.preventDefault();
    closeDiff();
    return;
  }

  if (elements.branchSheet?.classList.contains("is-open")) {
    event.preventDefault();
    closeBranchSheet();
    return;
  }

  if (elements.scannerModal.classList.contains("is-open")) {
    event.preventDefault();
    closeScanner();
    return;
  }

  if (elements.settingsPanel.classList.contains("is-open")) {
    event.preventDefault();
    closeSettings();
    return;
  }

  const activeTagName = document.activeElement?.tagName || "";
  if (
    state.mobileThreadOpen
    && isNarrowViewport()
    && activeTagName !== "INPUT"
    && activeTagName !== "TEXTAREA"
    && activeTagName !== "SELECT"
  ) {
    event.preventDefault();
    setMobileThreadOpen(false);
  }
}

function toggleDockButton(element, active) {
  if (!element) {
    return;
  }

  element.classList.toggle("is-active", active);
  element.setAttribute("aria-pressed", active ? "true" : "false");
}

function syncFocusableRegion(element, interactive) {
  if (!(element instanceof HTMLElement)) {
    return;
  }

  if (!interactive && element.contains(document.activeElement)) {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  element.setAttribute("aria-hidden", interactive ? "false" : "true");
  element.toggleAttribute("inert", !interactive);

  // Preserve keyboard fallback behavior even if inert is unsupported.
  for (const focusable of element.querySelectorAll("button, [href], input, select, textarea, [tabindex]")) {
    if (!(focusable instanceof HTMLElement)) {
      continue;
    }

    if (interactive) {
      if (!Object.prototype.hasOwnProperty.call(focusable.dataset, "restoreTabindex")) {
        continue;
      }
      const restoreTabindex = focusable.dataset.restoreTabindex;
      if (restoreTabindex) {
        focusable.setAttribute("tabindex", restoreTabindex);
      } else {
        focusable.removeAttribute("tabindex");
      }
      delete focusable.dataset.restoreTabindex;
      continue;
    }

    if (!Object.prototype.hasOwnProperty.call(focusable.dataset, "restoreTabindex")) {
      focusable.dataset.restoreTabindex = focusable.getAttribute("tabindex") || "";
    }
    focusable.setAttribute("tabindex", "-1");
  }
}

function focusComposer() {
  if (isNarrowViewport()) {
    return;
  }

  window.requestAnimationFrame(() => {
    elements.composerInput.focus({ preventScroll: true });
    const end = elements.composerInput.value.length;
    elements.composerInput.setSelectionRange(end, end);
  });
}

function autosizeComposer() {
  if (!elements.composerInput) {
    return;
  }

  const minHeight = isNarrowViewport() ? 92 : 104;
  const maxHeight = isNarrowViewport() ? 224 : 280;
  elements.composerInput.style.height = "0px";
  const nextHeight = Math.min(Math.max(elements.composerInput.scrollHeight, minHeight), maxHeight);
  elements.composerInput.style.height = `${nextHeight}px`;
}

function pulseHaptic(duration = 10) {
  if (!navigator?.vibrate || duration <= 0) {
    return;
  }

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  try {
    navigator.vibrate(duration);
  } catch {}
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
