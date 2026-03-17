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

const state = {
  accountSummary: "Account: Unknown",
  branchCatalog: [],
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

init();

function init() {
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
    searchInput: document.querySelector("#search-input"),
    sendButton: document.querySelector("#send-button"),
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
    threadRepoLabel: document.querySelector("#thread-repo-label"),
    threadSubtitle: document.querySelector("#thread-subtitle"),
    threadTitle: document.querySelector("#thread-title"),
  };
}

function wireEvents() {
  elements.searchInput.addEventListener("input", (event) => { state.searchQuery = event.target.value.trim().toLowerCase(); renderSidebar(); });
  elements.newChatButton.addEventListener("click", () => createLocalChat());
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
  const modelOptions = state.modelCatalog.map((entry) => ({
    label: entry.displayName,
    value: entry.model,
  }));
  const reasoningOptions = currentReasoningOptions();

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
  let hasChats = false;
  for (const group of state.conversations) {
    const chats = group.chats.filter((chat) => [chat.title, chat.snippet, chat.repo].join(" ").toLowerCase().includes(state.searchQuery));
    if (!chats.length) {
      continue;
    }
    hasChats = true;
    const section = document.createElement("section");
    section.className = "folder-section";
    section.innerHTML = '<div class="folder-heading"><div class="folder-label"><span class="folder-icon" aria-hidden="true"></span><span></span></div><button class="folder-plus" type="button">+</button></div><div class="chat-list"></div>';
    section.querySelector(".folder-label span:last-child").textContent = group.folder;
    section.querySelector(".folder-plus").addEventListener("click", () => createLocalChat(group.folder));
    const list = section.querySelector(".chat-list");
    for (const chat of chats) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-item${chat.id === state.selectedChatId ? " is-active" : ""}`;
      button.innerHTML = `<div class="chat-item-head"><span class="chat-item-title">${escapeHTML(chat.title)}</span><span class="chat-item-timestamp">${escapeHTML(chat.timestamp)}</span></div><div class="chat-item-meta"><span class="chat-item-snippet">${escapeHTML(chat.snippet)}</span><span class="chat-item-dot"${chat.id === state.selectedChatId ? "" : " hidden"}></span></div>`;
      button.addEventListener("click", () => {
        state.selectedChatId = chat.id;
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
      <p class="empty-kicker">No Chats Yet</p>
      <h3>Connect the bridge to load your real threads</h3>
      <p>Pair the browser client, then your actual Remodex thread list will appear here instead of demo content.</p>
    `;
    fragment.append(emptyState);
  }
  elements.folderList.replaceChildren(fragment);
}

function renderConversation() {
  const chat = selectedChat();
  if (!chat) {
    elements.threadRepoLabel.textContent = "Remodex";
    elements.threadTitle.textContent = "No thread selected";
    elements.threadSubtitle.textContent = "Connect the relay and pick a real thread from the chat list.";
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
  elements.threadSubtitle.textContent = `Branch ${chat.branch} | ${chat.access} | ${state.connection.label}`;
  const branchOptions = state.branchCatalog.length ? state.branchCatalog : (REPOSITORY_BRANCHES[chat.repo] || [chat.branch || "main"]);
  setOptions(elements.branchSelect, branchOptions, chat.branch);
  elements.repoSelect.value = chat.repo;
  elements.accessSelect.value = chat.access;
  persistLastThreadId(chat.id);

  const fragment = document.createDocumentFragment();
  for (const message of chat.messages) {
    const card = document.createElement("article");
    card.className = `message-card ${message.role === "user" ? "user" : "assistant"}`;
    card.innerHTML = `<div class="message-meta">${escapeHTML(message.author)} | ${escapeHTML(message.time)}</div><div class="message-bubble"></div>`;
    card.querySelector(".message-bubble").textContent = message.text;
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
}

function renderRuntimeStrip() {
  const chat = selectedChat();
  const repoLocation = chat?.cwd ? "Repo: Local" : "Repo: Cloud";
  elements.repoLocationChip.textContent = repoLocation;
  elements.rateLimitChip.textContent = state.rateLimitSummary;
  elements.accountChip.textContent = state.accountSummary;
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

function createLocalChat(folderName = selectedChat()?.repo || state.conversations[0]?.folder) {
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
    messages: [
      {
        role: "assistant",
        author: "Codex",
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
  addLog("info", "Created a new local draft thread.", group.folder);
  renderAll();
}

async function sendMessage() {
  const chat = selectedChat();
  const text = elements.composerInput.value.trim();
  if (!chat || !text) {
    return;
  }

  chat.messages.push({ id: `local-user-${Date.now()}`, role: "user", author: "You", time: "now", text });
  chat.messages.push({ id: `pending-${Date.now()}`, pending: true, role: "assistant", author: "Codex", time: "pending", text: "Sending to Codex..." });
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
      chat.threadId = threadResponse.thread.id;
      chat.id = threadResponse.thread.id;
      chat.cwd = threadResponse.thread.cwd;
      chat.originUrl = threadResponse.thread.gitInfo?.originUrl || null;
      chat.repo = repoLabelFromThread(threadResponse.thread);
      chat.branch = threadResponse.thread.gitInfo?.branch || chat.branch;
      chat.title = threadResponse.thread.name || threadResponse.thread.preview || chat.title;
      state.selectedChatId = chat.id;
      await refreshThreadList(chat.threadId);
    }

    addLog("info", "Started a real remote turn.", truncate(text, 42));
    renderLogs();
    state.connection = { detail: "Turn submitted. Waiting for turn notifications and refreshed thread state.", label: "Running turn", status: "ready" };
    renderConnection();

    await state.client.startTurn({
      approvalPolicy: approvalPolicyForAccess(chat.access),
      cwd: chat.cwd || null,
      effort: state.preferences.reasoning || undefined,
      input: [{ text, type: "text" }],
      model: state.preferences.model,
      threadId: chat.threadId,
    });

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
    setScannerStatus("Connected. Closing scanner...");
    window.setTimeout(closeScanner, 480);
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
  elements.settingsPanel.classList.add("is-open");
  elements.settingsPanel.setAttribute("aria-hidden", "false");
}

function closeSettings() {
  elements.settingsPanel.classList.remove("is-open");
  elements.settingsPanel.setAttribute("aria-hidden", "true");
}

function openScanner() {
  elements.scannerModal.classList.add("is-open");
  elements.scannerModal.setAttribute("aria-hidden", "false");
  elements.scannerStatus.textContent = state.capabilities.secureContext
    ? "Use the rear camera or import a QR image."
    : "This page needs HTTPS or localhost for camera access.";
}

function closeScanner() {
  scanner.stop();
  elements.scannerModal.classList.remove("is-open");
  elements.scannerModal.setAttribute("aria-hidden", "true");
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
          setScannerStatus("Connected. Closing scanner...");
          window.setTimeout(closeScanner, 480);
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
    await refreshModelCatalog();
    await refreshRuntimeSummaries();
    await refreshThreadList(restoreThread ? loadStoredLastThreadId() : state.selectedChatId);
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
  const result = await state.client.listThreads({ archived: false, limit: 100, sortKey: "updated_at" });
  state.conversations = groupRemoteThreads(result.data);
  if (preferredThreadId && findChatByThreadId(preferredThreadId)) {
    state.selectedChatId = preferredThreadId;
  } else if (state.conversations[0]?.chats[0]) {
    state.selectedChatId = state.conversations[0].chats[0].id;
  }
  if (state.selectedChatId) {
    persistLastThreadId(state.selectedChatId);
  }
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
  renderAll();
  await refreshBranchCatalog(chat);
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

  addLog("info", `Received ${method}.`, "notification");
  renderLogs();

  if (method.startsWith("thread/") || method.startsWith("turn/")) {
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

function threadToChat(thread) {
  const nextChat = {
    access: state.preferences.access,
    branch: thread.gitInfo?.branch || "main",
    cwd: thread.cwd,
    id: thread.id,
    messages: extractMessagesFromThread(thread),
    messagesLoaded: false,
    originUrl: thread.gitInfo?.originUrl || null,
    repo: repoLabelFromThread(thread),
    snippet: thread.preview || "No preview",
    threadId: thread.id,
    timestamp: relativeTimeFromUnix(thread.updatedAt),
    title: thread.name || thread.preview || "Untitled thread",
  };
  return mergeChatWithCache(nextChat);
}

function hydrateChatFromThread(chat, thread) {
  chat.branch = thread.gitInfo?.branch || chat.branch;
  chat.cwd = thread.cwd;
  chat.messages = mergeMessagesWithCache(thread.id, extractMessagesFromThread(thread));
  chat.messagesLoaded = true;
  chat.originUrl = thread.gitInfo?.originUrl || chat.originUrl || null;
  chat.repo = repoLabelFromThread(thread);
  chat.snippet = thread.preview || chat.snippet;
  chat.timestamp = relativeTimeFromUnix(thread.updatedAt);
  chat.title = thread.name || thread.preview || chat.title;
  persistThreadCacheForChat(chat);
}

function extractMessagesFromThread(thread) {
  const messages = [];
  for (const turn of thread.turns || []) {
    for (const item of turn.items || []) {
      if (item.type === "userMessage") {
        const text = (item.content || []).filter((entry) => entry.type === "text").map((entry) => entry.text).join("\n\n");
        if (text) {
          messages.push({ role: "user", author: "You", time: turn.status, text });
        }
      } else if (item.type === "agentMessage") {
        messages.push({ role: "assistant", author: "Codex", time: item.phase || turn.status, text: item.text });
      } else if (item.type === "reasoning" && item.summary?.length) {
        messages.push({ role: "assistant", author: "Reasoning", time: turn.status, text: item.summary.join("\n") });
      }
    }
  }
  return messages.length ? messages : [{ role: "assistant", author: "Codex", time: "idle", text: "This thread has no materialized turns yet." }];
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

function approvalPolicyForAccess(access) {
  return access === "Workspace Write" ? "never" : "on-request";
}

function sandboxForAccess(access) {
  return access === "Read Only" ? "read-only" : "workspace-write";
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
  for (const group of state.conversations) {
    const chat = group.chats.find((candidate) => candidate.threadId === threadId || candidate.id === threadId);
    if (chat) {
      return chat;
    }
  }
  return null;
}

function representativeThreadInfo(repo) {
  for (const group of state.conversations) {
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
      existing.text = item.text || existing.text;
      existing.time = item.phase || "completed";
    } else {
      chat.messages.push({
        id: item.id,
        role: "assistant",
        author: "Codex",
        time: item.phase || "completed",
        text: item.text || "",
      });
    }
    chat.snippet = item.text || chat.snippet;
  }

  if (item.type === "reasoning" && Array.isArray(item.summary) && item.summary.length) {
    chat.messages.push({
      id: item.id,
      role: "assistant",
      author: "Reasoning",
      time: "completed",
      text: item.summary.join("\n"),
    });
  }

  persistThreadCacheForChat(chat);
  if (selectedChat()?.id === chat.id) {
    renderConversation();
  }
}

function mergeChatWithCache(chat) {
  const cached = state.threadCache[chat.threadId || chat.id];
  if (!cached) {
    return chat;
  }

  return {
    ...chat,
    access: cached.access || chat.access,
    branch: cached.branch || chat.branch,
    cwd: cached.cwd || chat.cwd,
    messages: mergeMessagesWithCache(chat.threadId || chat.id, chat.messages),
    originUrl: cached.originUrl || chat.originUrl || null,
    repo: cached.repo || chat.repo,
    snippet: cached.snippet || chat.snippet,
    title: cached.title || chat.title,
  };
}

function mergeMessagesWithCache(threadId, serverMessages) {
  const cached = state.threadCache[threadId];
  if (!cached?.messages?.length) {
    return serverMessages;
  }
  if (!serverMessages.length) {
    return cached.messages;
  }

  return cached.messages.length > serverMessages.length ? cached.messages : serverMessages;
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
    messages: chat.messages,
    originUrl: chat.originUrl || null,
    repo: chat.repo,
    snippet: chat.snippet,
    title: chat.title,
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

function currentReasoningOptions() {
  const selectedModel = state.modelCatalog.find((entry) => entry.model === state.preferences.model) || state.modelCatalog[0];
  if (!selectedModel) {
    return REASONING_OPTIONS.map((value) => ({ label: value, value }));
  }

  return selectedModel.supportedReasoningEfforts.map((entry) => ({
    label: labelForReasoningEffort(entry.reasoningEffort),
    value: entry.reasoningEffort,
  }));
}

function addLog(level, message, meta = new Date().toLocaleTimeString()) {
  state.logs.unshift({ level, message, meta });
  state.logs = state.logs.slice(0, 8);
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
