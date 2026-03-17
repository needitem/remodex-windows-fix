import { createBrowserRelayClient, inferRelayBaseUrl } from "./modules/browser-relay-client.mjs";
import { prepareBrowserSecureTransport } from "./modules/browser-secure-transport.mjs";
import { collectBrowserCapabilities } from "./modules/capabilities.mjs";
import { decodePairingPayloadFromFile, describePairingPayload, parsePairingPayload } from "./modules/pairing.mjs";
import { clearStoredPairingPayload, loadStoredPairingPayload, loadStoredRelayOverride, saveStoredPairingPayload, saveStoredRelayOverride } from "./modules/storage.mjs";
import { ACCESS_OPTIONS, DEFAULT_CONVERSATIONS, MODEL_OPTIONS, REASONING_OPTIONS, REPOSITORY_BRANCHES, SPEED_OPTIONS } from "./modules/mock-data.mjs";
import { loadPreferences, savePreferences } from "./modules/preferences.mjs";
import { createScannerController } from "./modules/scanner-controller.mjs";

const initialPairingPayload = loadStoredPairingPayload();

const state = {
  browserTransport: prepareBrowserSecureTransport({ pairingPayload: initialPairingPayload }),
  capabilities: collectBrowserCapabilities(window, navigator),
  client: null,
  connection: { detail: "Load a QR or pairing JSON to connect the browser client.", label: "Waiting for pairing", status: "warning" },
  conversations: structuredClone(DEFAULT_CONVERSATIONS),
  logs: [],
  pairingPayload: initialPairingPayload,
  preferences: loadPreferences({ accessOptions: ACCESS_OPTIONS, modelOptions: MODEL_OPTIONS, reasoningOptions: REASONING_OPTIONS, speedOptions: SPEED_OPTIONS }),
  relayOverride: loadStoredRelayOverride(),
  searchQuery: "",
  selectedChatId: "remodex-pull",
  sidebarOpen: false,
};

const elements = mapElements();
const scanner = createScannerController({ videoElement: elements.scannerVideo });

init();

function init() {
  seedLogs();
  wireEvents();
  renderAll();
}

function mapElements() {
  return {
    accessSelect: document.querySelector("#access-select"),
    body: document.body,
    branchSelect: document.querySelector("#branch-select"),
    clearPairingButton: document.querySelector("#clear-pairing-button"),
    closeScannerButton: document.querySelector("#close-scanner-button"),
    closeSettingsButton: document.querySelector("#close-settings-button"),
    composerInput: document.querySelector("#composer-input"),
    composerStatus: document.querySelector("#composer-status"),
    connectButton: document.querySelector("#connect-button"),
    connectionDot: document.querySelector("#connection-dot"),
    connectionLabel: document.querySelector("#connection-label"),
    connectionMeta: document.querySelector("#connection-meta"),
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
    newChatButton: document.querySelector("#new-chat-button"),
    openScannerButton: document.querySelector("#open-scanner-button"),
    openSettingsButton: document.querySelector("#open-settings-button"),
    pairingFileInput: document.querySelector("#pairing-file-input"),
    pairingJsonInput: document.querySelector("#pairing-json-input"),
    pushStatusLabel: document.querySelector("#push-status-label"),
    reasoningSelect: document.querySelector("#reasoning-select"),
    relayUrlInput: document.querySelector("#relay-url-input"),
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
  elements.newChatButton.addEventListener("click", () => createChat());
  elements.sendButton.addEventListener("click", sendMessage);
  elements.composerInput.addEventListener("keydown", (event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); sendMessage(); } });
  elements.repoSelect.addEventListener("change", (event) => mutateSelectedChat((chat) => { chat.repo = event.target.value; chat.branch = (REPOSITORY_BRANCHES[chat.repo] || ["main"])[0]; }));
  elements.branchSelect.addEventListener("change", (event) => mutateSelectedChat((chat) => { chat.branch = event.target.value; }));
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
  elements.importFileButton.addEventListener("click", () => elements.pairingFileInput.click());
  elements.pairingFileInput.addEventListener("change", importPairingFile);
  elements.loadPairingButton.addEventListener("click", loadPairingFromTextarea);
  elements.clearPairingButton.addEventListener("click", clearPairing);
  elements.relayUrlInput.addEventListener("change", (event) => { state.relayOverride = event.target.value.trim(); saveStoredRelayOverride(state.relayOverride); addLog("info", "Updated relay base URL.", state.relayOverride || "inferred"); renderConnection(); });
  elements.connectButton.addEventListener("click", connectRelay);
  elements.disconnectButton.addEventListener("click", () => disconnectRelay(false));
  document.querySelector("[data-open-sidebar]")?.addEventListener("click", () => { state.sidebarOpen = true; renderBody(); });
  document.querySelector("[data-close-sidebar]")?.addEventListener("click", () => { state.sidebarOpen = false; renderBody(); });
}

function renderAll() {
  renderBody();
  renderSelects();
  renderSidebar();
  renderConversation();
  renderPairing();
  renderConnection();
  renderSettings();
  renderLogs();
}

function renderBody() {
  elements.body.classList.toggle("sidebar-open", state.sidebarOpen);
  elements.body.classList.toggle("font-rounded", state.preferences.font === "rounded");
  elements.body.classList.toggle("no-glass", state.preferences.glass === false);
}

function renderSelects() {
  setOptions(elements.modelSelect, MODEL_OPTIONS, state.preferences.model);
  setOptions(elements.reasoningSelect, REASONING_OPTIONS, state.preferences.reasoning);
  setOptions(elements.speedSelect, SPEED_OPTIONS, state.preferences.speed);
  setOptions(elements.settingsModelSelect, MODEL_OPTIONS, state.preferences.model);
  setOptions(elements.settingsReasoningSelect, REASONING_OPTIONS, state.preferences.reasoning);
  setOptions(elements.settingsSpeedSelect, SPEED_OPTIONS, state.preferences.speed);
  setOptions(elements.settingsAccessSelect, ACCESS_OPTIONS, state.preferences.access);
  setOptions(elements.repoSelect, state.conversations.map((group) => group.folder));
}

function renderSidebar() {
  const fragment = document.createDocumentFragment();
  for (const group of state.conversations) {
    const chats = group.chats.filter((chat) => [chat.title, chat.snippet, chat.repo].join(" ").toLowerCase().includes(state.searchQuery));
    if (!chats.length) { continue; }
    const section = document.createElement("section");
    section.className = "folder-section";
    section.innerHTML = '<div class="folder-heading"><div class="folder-label"><span class="folder-icon" aria-hidden="true"></span><span></span></div><button class="folder-plus" type="button">+</button></div><div class="chat-list"></div>';
    section.querySelector(".folder-label span:last-child").textContent = group.folder;
    section.querySelector(".folder-plus").addEventListener("click", () => createChat(group.folder));
    const list = section.querySelector(".chat-list");
    for (const chat of chats) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-item${chat.id === state.selectedChatId ? " is-active" : ""}`;
      button.innerHTML = `<div class="chat-item-head"><span class="chat-item-title">${escapeHTML(chat.title)}</span><span class="chat-item-timestamp">${escapeHTML(chat.timestamp)}</span></div><div class="chat-item-meta"><span class="chat-item-snippet">${escapeHTML(chat.snippet)}</span><span class="chat-item-dot"${chat.id === state.selectedChatId ? "" : " hidden"}></span></div>`;
      button.addEventListener("click", () => { state.selectedChatId = chat.id; state.sidebarOpen = false; renderAll(); });
      list.append(button);
    }
    fragment.append(section);
  }
  elements.folderList.replaceChildren(fragment);
}

function renderConversation() {
  const chat = selectedChat();
  if (!chat) { return; }
  elements.threadRepoLabel.textContent = chat.repo;
  elements.threadTitle.textContent = chat.title;
  elements.threadSubtitle.textContent = `Branch ${chat.branch} • ${chat.access} • ${state.connection.label}`;
  setOptions(elements.branchSelect, REPOSITORY_BRANCHES[chat.repo] || ["main"], chat.branch);
  elements.repoSelect.value = chat.repo;
  elements.accessSelect.value = chat.access;
  const fragment = document.createDocumentFragment();
  for (const message of chat.messages) {
    const card = document.createElement("article");
    card.className = `message-card ${message.role === "user" ? "user" : "assistant"}`;
    card.innerHTML = `<div class="message-meta">${escapeHTML(message.author)} • ${escapeHTML(message.time)}</div><div class="message-bubble"></div>`;
    card.querySelector(".message-bubble").textContent = message.text;
    fragment.append(card);
  }
  elements.messageList.replaceChildren(fragment);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
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
    ? `${state.connection.detail} Session ${truncate(state.pairingPayload.sessionId, 18)} • ${truncate(state.relayOverride || state.pairingPayload.relay, 34)}`
    : state.connection.detail;
  elements.connectionDot.className = "connection-dot";
  elements.connectionDot.classList.add(`state-${state.connection.status}`);
  elements.composerStatus.textContent = state.connection.label;
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
  addLog("info", "Prepared browser secure transport scaffold.", state.browserTransport.deviceState.phoneDeviceId);
  if (state.pairingPayload) {
    state.connection = { detail: "Pairing restored from local storage.", label: "Pairing loaded", status: "warning" };
    addLog("info", "Restored pairing payload from local storage.", state.pairingPayload.sessionId);
  }
  if (state.relayOverride) {
    addLog("info", "Restored relay override.", state.relayOverride);
  }
}

function createChat(folderName = selectedChat()?.repo || state.conversations[0]?.folder) {
  const group = state.conversations.find((candidate) => candidate.folder === folderName) || state.conversations[0];
  const chat = {
    id: `chat-${Date.now()}`,
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
        text: "New browser thread created. Pair the relay, then use the composer to drive future turns.",
      },
    ],
  };
  group.chats.unshift(chat);
  state.selectedChatId = chat.id;
  addLog("info", "Created a new chat thread.", group.folder);
  renderAll();
}

function sendMessage() {
  const chat = selectedChat();
  const text = elements.composerInput.value.trim();
  if (!chat || !text) { return; }
  chat.messages.push({ role: "user", author: "You", time: "now", text });
  chat.snippet = text;
  chat.timestamp = "now";
  chat.access = elements.accessSelect.value;
  elements.composerInput.value = "";
  addLog("info", "Queued a local browser turn.", truncate(text, 48));
  window.setTimeout(() => {
    chat.messages.push({
      role: "assistant",
      author: "Codex",
      time: "now",
      text: [
        `Draft response for "${chat.title}".`,
        "",
        state.client ? "Relay socket is open. Browser secure transport is the remaining missing piece." : "Relay socket is not open yet.",
        `Defaults: ${state.preferences.model}, ${state.preferences.reasoning}, ${chat.access}.`
      ].join("\n"),
    });
    renderAll();
  }, 160);
  renderAll();
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
  if (!file) { return; }
  try {
    applyPairing(await decodePairingPayloadFromFile(file, window), `Imported pairing from ${file.name}.`);
    closeScanner();
  } catch (error) {
    elements.scannerStatus.textContent = error.message || "Import failed.";
    addLog("error", error.message || "Could not decode the selected file.", file.name);
    renderLogs();
  } finally {
    event.target.value = "";
  }
}

function clearPairing() {
  disconnectRelay(true);
  state.pairingPayload = null;
  state.browserTransport = prepareBrowserSecureTransport();
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
    elements.scannerStatus.textContent = "Camera access requires HTTPS or localhost.";
    addLog("warn", "Scanner blocked because the page is not in a secure context.", "camera");
    renderLogs();
    return;
  }

  try {
    scanner.stop();
    await scanner.start({
      onDetect(rawValue) {
        applyPairing(parsePairingPayload(rawValue), "Captured pairing payload from the live scanner.");
        window.setTimeout(closeScanner, 280);
      },
      onError(error) {
        elements.scannerStatus.textContent = error.message || "Camera scan failed.";
        addLog("error", "Camera scan failed.", error.message || "scanner");
        renderLogs();
      },
      onStatus(statusText) {
        elements.scannerStatus.textContent = statusText;
      },
    });
    addLog("info", "Started the camera scanner.", "scanner");
    renderLogs();
  } catch (error) {
    elements.scannerStatus.textContent = error.message || "Could not start the camera.";
    addLog("error", "Failed to start the camera scanner.", error.message || "scanner");
    renderLogs();
  }
}

function connectRelay() {
  if (!state.pairingPayload) {
    openScanner();
    addLog("warn", "Open the scanner or load pairing JSON before connecting.", "relay");
    renderLogs();
    return;
  }

  disconnectRelay(true);
  const relayBaseUrl = state.relayOverride || state.pairingPayload.relay || inferRelayBaseUrl(window.location);
  try {
    state.client = createBrowserRelayClient({
      pairingPayload: state.pairingPayload,
      relayBaseUrl,
      onClose(event) {
        state.connection = { detail: event.reason || "Socket closed by the relay.", label: "Disconnected", status: "warning" };
        addLog("warn", "Relay socket closed.", event.reason || `code=${event.code}`);
        renderConnection();
        renderLogs();
      },
      onError() {
        state.connection = { detail: "The relay socket failed before the secure handshake started.", label: "Socket error", status: "error" };
        addLog("error", "Relay socket error.", relayBaseUrl);
        renderConnection();
        renderLogs();
      },
      onMessage(message) {
        addLog("info", "Received relay message.", truncate(message, 64));
        renderLogs();
      },
      onOpen(url) {
        state.connection = { detail: "Relay socket is open. Browser secure transport still needs clientHello and clientAuth.", label: "Relay socket open", status: "ready" };
        addLog("info", "Opened relay socket.", url);
        renderConnection();
        renderLogs();
      },
    });
    state.connection = { detail: "Opening relay socket from the web client.", label: "Connecting", status: "warning" };
    addLog("info", "Connecting to relay.", relayBaseUrl);
    state.client.connect();
  } catch (error) {
    state.connection = { detail: error.message || "Failed to open the relay socket.", label: "Connect failed", status: "error" };
    addLog("error", "Could not open the relay socket.", error.message || "relay");
  }
  renderConnection();
  renderLogs();
}

function disconnectRelay(silent) {
  if (state.client) {
    state.client.disconnect();
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

function applyPairing(payload, note) {
  state.pairingPayload = payload;
  saveStoredPairingPayload(payload);
  state.browserTransport = prepareBrowserSecureTransport({ pairingPayload: payload });
  if (!state.relayOverride) {
    state.relayOverride = payload.relay;
    saveStoredRelayOverride(payload.relay);
  }
  state.connection = { detail: "Pairing loaded. You can now connect the relay socket from the sidebar footer.", label: "Pairing loaded", status: "warning" };
  addLog("info", note, payload.sessionId);
  addLog("info", "Updated browser handshake scaffold.", state.browserTransport.handshake.trustedMacFingerprint);
  renderAll();
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

function mutateSelectedChat(mutate) {
  const chat = selectedChat();
  if (!chat) { return; }
  mutate(chat);
  renderAll();
}

function selectedChat() {
  for (const group of state.conversations) {
    const chat = group.chats.find((candidate) => candidate.id === state.selectedChatId);
    if (chat) { return chat; }
  }
  return null;
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

function addLog(level, message, meta = new Date().toLocaleTimeString()) {
  state.logs.unshift({ level, message, meta });
  state.logs = state.logs.slice(0, 8);
}

function truncate(value, maxLength) {
  const normalized = String(value || "");
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function escapeHTML(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
