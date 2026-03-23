// FILE: workspace-paths.js
// Purpose: Keeps a reversible mapping between local workspace paths and short display labels.
// Layer: Bridge helper
// Exports: path rewrite and resolution helpers for bridge traffic
// Depends on: path

const path = require("path");

const WORKSPACE_PATH_KEYS = new Set([
  "cwd",
  "currentWorkingDirectory",
  "repoRoot",
  "rolloutPath",
  "worktreePath",
  "localCheckoutPath",
]);
const aliasToPath = new Map();
const pathToAlias = new Map();

function registerWorkspacePathsFromMessage(rawMessage) {
  const parsed = safeParseJSON(rawMessage);
  if (!parsed) {
    return;
  }

  visitWorkspacePathValues(parsed, (value) => {
    if (looksLikeAbsolutePath(value)) {
      registerWorkspacePath(value);
    }
  });
}

function rewriteWorkspacePathsForDisplay(rawMessage) {
  return rewriteWorkspacePaths(rawMessage, (value) => {
    if (!looksLikeAbsolutePath(value)) {
      return value;
    }

    return getDisplayWorkspacePath(value);
  });
}

function restoreWorkspacePathsFromDisplay(rawMessage) {
  return rewriteWorkspacePaths(rawMessage, (value) => resolveWorkspacePath(value));
}

function resolveWorkspacePath(candidate) {
  if (typeof candidate !== "string") {
    return candidate;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return candidate;
  }

  if (looksLikeAbsolutePath(trimmed)) {
    registerWorkspacePath(trimmed);
    return trimmed;
  }

  return aliasToPath.get(trimmed) || trimmed;
}

function registerWorkspacePath(candidate) {
  if (typeof candidate !== "string") {
    return candidate;
  }

  const normalized = candidate.trim();
  if (!looksLikeAbsolutePath(normalized)) {
    return normalized;
  }

  const alias = extractLeafName(normalized);
  if (!alias) {
    pathToAlias.set(normalized, null);
    return normalized;
  }

  const existingPath = aliasToPath.get(alias);
  if (existingPath && existingPath !== normalized) {
    aliasToPath.delete(alias);
    pathToAlias.set(existingPath, null);
    pathToAlias.set(normalized, null);
    return normalized;
  }

  aliasToPath.set(alias, normalized);
  pathToAlias.set(normalized, alias);
  return normalized;
}

function getDisplayWorkspacePath(candidate) {
  const normalized = registerWorkspacePath(candidate);
  return pathToAlias.get(normalized) || normalized;
}

function rewriteWorkspacePaths(rawMessage, transform) {
  const parsed = safeParseJSON(rawMessage);
  if (!parsed) {
    return rawMessage;
  }

  let changed = false;
  visitWorkspacePathValues(parsed, (value, replace) => {
    const nextValue = transform(value);
    if (nextValue === value) {
      return;
    }

    replace(nextValue);
    changed = true;
  });

  return changed ? JSON.stringify(parsed) : rawMessage;
}

function visitWorkspacePathValues(value, visitor) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitWorkspacePathValues(item, visitor);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  for (const [key, currentValue] of Object.entries(value)) {
    if (typeof currentValue === "string" && WORKSPACE_PATH_KEYS.has(key)) {
      visitor(currentValue, (nextValue) => {
        value[key] = nextValue;
      });
      continue;
    }

    if (key === "worktreePathByBranch" && currentValue && typeof currentValue === "object") {
      for (const [branchName, branchPath] of Object.entries(currentValue)) {
        if (typeof branchPath !== "string") {
          continue;
        }
        visitor(branchPath, (nextValue) => {
          currentValue[branchName] = nextValue;
        });
      }
      continue;
    }

    visitWorkspacePathValues(currentValue, visitor);
  }
}

function safeParseJSON(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function looksLikeAbsolutePath(candidate) {
  if (typeof candidate !== "string") {
    return false;
  }

  const trimmed = candidate.trim();
  if (!trimmed) {
    return false;
  }

  return (
    path.win32.isAbsolute(trimmed)
    || path.posix.isAbsolute(trimmed)
    || trimmed.startsWith("\\\\")
  );
}

function extractLeafName(candidate) {
  if (typeof candidate !== "string") {
    return "";
  }

  const trimmed = candidate.trim().replace(/[\\/]+$/, "");
  if (!trimmed) {
    return "";
  }

  const segments = trimmed.split(/[\\/]+/).filter(Boolean);
  return segments[segments.length - 1] || "";
}

module.exports = {
  registerWorkspacePath,
  registerWorkspacePathsFromMessage,
  resolveWorkspacePath,
  restoreWorkspacePathsFromDisplay,
  rewriteWorkspacePathsForDisplay,
};
