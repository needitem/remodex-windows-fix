// FILE: bridge-trace.js
// Purpose: Appends bridge-side JSONL traces for incoming/outgoing app payload debugging.
// Layer: Bridge utility
// Exports: traceBridgePayload
// Depends on: fs, os, path

const fs = require("fs");
const os = require("os");
const path = require("path");

const TRACE_DIR = path.join(os.homedir(), ".remodex");
const TRACE_FILE = path.join(TRACE_DIR, "web-bridge-trace.jsonl");

function traceBridgePayload(direction, rawMessage) {
  const parsed = safeParseJSON(rawMessage);
  const payload = {
    timestamp: new Date().toISOString(),
    direction,
    id: parsed?.id ?? null,
    kind: parsed?.kind ?? null,
    method: typeof parsed?.method === "string" ? parsed.method : null,
    params: summarizeParams(parsed?.params),
    resultKeys: parsed?.result && typeof parsed.result === "object" ? Object.keys(parsed.result).slice(0, 12) : null,
    error: parsed?.error?.message || null,
    rawPreview: typeof rawMessage === "string" ? rawMessage.slice(0, 600) : "",
  };

  try {
    fs.mkdirSync(TRACE_DIR, { recursive: true });
    fs.appendFileSync(TRACE_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {}
}

function summarizeParams(params) {
  if (!params || typeof params !== "object") {
    return null;
  }

  const summary = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "input" && Array.isArray(value)) {
      summary.input = value.map((entry) => (
        entry && typeof entry === "object"
          ? {
            type: entry.type || null,
            text: typeof entry.text === "string" ? entry.text.slice(0, 200) : null,
          }
          : null
      ));
      continue;
    }
    if (typeof value === "string") {
      summary[key] = value.slice(0, 200);
      continue;
    }
    if (typeof value === "number" || typeof value === "boolean" || value == null) {
      summary[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      summary[key] = `[array:${value.length}]`;
      continue;
    }
    if (typeof value === "object") {
      summary[key] = `{${Object.keys(value).slice(0, 8).join(",")}}`;
    }
  }

  return summary;
}

function safeParseJSON(value) {
  if (typeof value !== "string") {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

module.exports = {
  traceBridgePayload,
};
