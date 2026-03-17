import {
  buildCommandPreview,
  normalizeCommandOutput,
  summarizeCommandForDisplay,
} from "./thread-message-state.mjs";

export function applyExecCommandBegin(chat, params, { messageOrigin } = {}) {
  const callId = params?.call_id || params?.callId;
  const command = typeof params?.command === "string" ? params.command : "";
  if (!callId || !command) {
    return false;
  }

  const messageId = `command:${callId}`;
  if (!chat.messages.find((entry) => entry.id === messageId)) {
    chat.messages.push({
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOrigin,
      kind: "command",
      command,
      summary: summarizeCommandForDisplay(command),
      preview: "Running...",
      rawOutput: "",
      time: "running",
      text: "",
    });
  }

  return true;
}

export function applyExecCommandOutput(chat, params, { messageOrigin } = {}) {
  const callId = params?.call_id || params?.callId;
  const delta = typeof params?.chunk === "string" ? params.chunk : "";
  if (!callId || !delta) {
    return false;
  }

  const messageId = `command:${callId}`;
  let message = chat.messages.find((entry) => entry.id === messageId);
  if (!message) {
    const command = typeof params?.command === "string" ? params.command : "";
    message = {
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOrigin,
      kind: "command",
      command,
      summary: summarizeCommandForDisplay(command || "Command"),
      preview: "Running...",
      rawOutput: "",
      time: "running",
      text: "",
    };
    chat.messages.push(message);
  }

  message.rawOutput = `${message.rawOutput || ""}${message.rawOutput ? "\n" : ""}${delta}`;
  message.preview = buildCommandPreview(message.rawOutput);
  return true;
}

export function applyExecCommandEnd(chat, params, { messageOrigin } = {}) {
  const callId = params?.call_id || params?.callId;
  const output = typeof params?.output === "string" ? params.output : "";
  if (!callId) {
    return false;
  }

  const messageId = `command:${callId}`;
  let message = chat.messages.find((entry) => entry.id === messageId);
  if (!message) {
    const command = typeof params?.command === "string" ? params.command : "";
    message = {
      id: messageId,
      role: "assistant",
      author: "Shell",
      origin: messageOrigin,
      kind: "command",
      command,
      summary: summarizeCommandForDisplay(command || "Command"),
      preview: "Completed",
      rawOutput: "",
      time: "completed",
      text: "",
    };
    chat.messages.push(message);
  }

  if (output) {
    const normalizedOutput = normalizeCommandOutput(output);
    if (normalizedOutput && !String(message.rawOutput || "").includes(normalizedOutput)) {
      message.rawOutput = `${message.rawOutput || ""}${message.rawOutput ? "\n" : ""}${normalizedOutput}`;
    }
  }
  message.preview = buildCommandPreview(message.rawOutput) || "Completed";
  message.time = "completed";
  return true;
}

export function buildCommandRawContent(message) {
  const parts = [];
  if (message?.command) {
    parts.push(message.command);
  }

  const normalizedOutput = normalizeCommandOutput(message?.rawOutput || message?.text || "");
  if (normalizedOutput) {
    parts.push(normalizedOutput);
  }

  return parts.join("\n\n").trim();
}
