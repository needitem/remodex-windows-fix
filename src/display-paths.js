// FILE: display-paths.js
// Purpose: Shrinks user-facing workspace paths for the mobile UI while preserving local path resolution.
// Layer: Bridge helper
// Exports: sanitizeMessageForPhone, resolveDisplayPath
// Depends on: path

const path = require("path");

const WINDOWS_NAMESPACE_PREFIX = "\\\\?\\";
const displayPathRegistry = new Map();

function sanitizeMessageForPhone(rawMessage) {
  let parsed = null;
  try {
    parsed = JSON.parse(rawMessage);
  } catch {
    return rawMessage;
  }

  return JSON.stringify(sanitizeValue(parsed));
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sanitized = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = sanitizeEntry(key, item);
  }
  return sanitized;
}

function sanitizeEntry(key, value) {
  if (typeof value === "string") {
    if (key === "text") {
      return sanitizeVisibleText(value);
    }

    if (isDisplayPathKey(key)) {
      const label = rememberDisplayPath(value);
      return label || value;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return sanitizeValue(value);
}

function sanitizeVisibleText(text) {
  let sanitized = String(text);

  sanitized = sanitized.replace(/(<cwd>)([^<]+)(<\/cwd>)/g, (_match, openTag, rawPath, closeTag) => {
    const label = rememberDisplayPath(rawPath);
    return `${openTag}${label || rawPath}${closeTag}`;
  });

  sanitized = sanitized.replace(
    /^(# AGENTS\.md instructions for )(.+)$/m,
    (_match, prefix, rawPath) => {
      const label = rememberDisplayPath(rawPath);
      return `${prefix}${label || rawPath}`;
    }
  );

  return sanitized;
}

function resolveDisplayPath(candidatePath) {
  const normalized = normalizePath(candidatePath);
  if (!normalized) {
    return "";
  }

  const matches = displayPathRegistry.get(normalized);
  if (matches?.size === 1) {
    return [...matches][0];
  }

  return normalized;
}

function rememberDisplayPath(candidatePath) {
  const normalized = normalizePath(candidatePath);
  if (!normalized) {
    return "";
  }

  const label = formatDisplayPath(normalized);
  if (!label) {
    return "";
  }

  let matches = displayPathRegistry.get(label);
  if (!matches) {
    matches = new Set();
    displayPathRegistry.set(label, matches);
  }

  matches.add(normalized);
  return label;
}

function formatDisplayPath(candidatePath) {
  const normalized = normalizePath(candidatePath);
  if (!normalized) {
    return "";
  }

  const trimmed = normalized.replace(/[\\/]+$/, "");
  const label = path.win32.basename(trimmed) || path.posix.basename(trimmed);
  return label || trimmed;
}

function normalizePath(candidatePath) {
  if (typeof candidatePath !== "string") {
    return "";
  }

  const trimmed = candidatePath.trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith(WINDOWS_NAMESPACE_PREFIX)) {
    return trimmed.substring(WINDOWS_NAMESPACE_PREFIX.length);
  }

  return trimmed;
}

function isDisplayPathKey(key) {
  return key === "cwd" || key === "currentWorkingDirectory" || key === "workingDirectory";
}

module.exports = {
  sanitizeMessageForPhone,
  resolveDisplayPath,
};
