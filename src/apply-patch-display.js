// FILE: apply-patch-display.js
// Purpose: Converts captured apply_patch payloads into synthetic unified diffs with line numbers for UI display.
// Layer: Bridge helper
// Exports: buildDisplayPatchFromApplyPatch
// Depends on: fs, path

const fs = require("fs");
const path = require("path");

function buildDisplayPatchFromApplyPatch(patch, {
  cwd = process.cwd(),
  fsModule = fs,
} = {}) {
  const document = parseApplyPatchDocument(patch);
  if (!document?.files?.length) {
    return readNonEmptyString(patch) || "";
  }

  const renderedSections = [];
  for (const fileChange of document.files) {
    const rendered = renderFileChange(fileChange, { cwd, fsModule });
    if (rendered.length) {
      renderedSections.push(rendered.join("\n"));
    }
  }

  return renderedSections.join("\n");
}

function renderFileChange(fileChange, { cwd, fsModule }) {
  if (!fileChange || typeof fileChange !== "object") {
    return [];
  }

  if (fileChange.type === "add") {
    return renderAddedFile(fileChange, { cwd });
  }

  if (fileChange.type === "delete") {
    return renderDeletedFile(fileChange, { cwd });
  }

  if (fileChange.type === "update") {
    return renderUpdatedFile(fileChange, { cwd, fsModule });
  }

  return [];
}

function renderAddedFile(fileChange, { cwd }) {
  const displayPath = formatDisplayPath(fileChange.path, cwd);
  const newCount = fileChange.lines.length;
  const lines = [
    `diff --git a/${displayPath} b/${displayPath}`,
    "--- /dev/null",
    `+++ b/${displayPath}`,
  ];

  if (newCount > 0) {
    lines.push(`@@ -0,0 +${formatUnifiedRange(1, newCount)} @@`);
    for (const line of fileChange.lines) {
      lines.push(`+${line}`);
    }
  }

  return lines;
}

function renderDeletedFile(fileChange, { cwd }) {
  const displayPath = formatDisplayPath(fileChange.path, cwd);
  return [
    `diff --git a/${displayPath} b/${displayPath}`,
    `--- a/${displayPath}`,
    "+++ /dev/null",
  ];
}

function renderUpdatedFile(fileChange, { cwd, fsModule }) {
  const oldDisplayPath = formatDisplayPath(fileChange.path, cwd);
  const newDisplayPath = formatDisplayPath(fileChange.moveTo || fileChange.path, cwd);
  const currentFilePath = resolvePatchFilePath(fileChange.moveTo || fileChange.path, cwd);
  const currentFileLines = readFileLines(currentFilePath, fsModule);
  const lines = [
    `diff --git a/${oldDisplayPath} b/${newDisplayPath}`,
    `--- a/${oldDisplayPath}`,
    `+++ b/${newDisplayPath}`,
  ];

  if (!currentFileLines) {
    return lines.concat(renderRawUpdateHunks(fileChange.hunks));
  }

  let cursorNew = 0;
  let priorDelta = 0;

  for (const hunk of fileChange.hunks) {
    const matchIndex = findHunkStartIndex(currentFileLines, hunk, cursorNew);
    if (matchIndex < 0) {
      return lines.concat(renderRawUpdateHunks(fileChange.hunks));
    }

    const oldCount = hunk.lines.filter((line) => line.prefix !== "+").length;
    const newCount = hunk.lines.filter((line) => line.prefix !== "-").length;
    const oldStart = Math.max(1, (matchIndex + 1) - priorDelta);
    const newStart = matchIndex + 1;

    lines.push(`@@ -${formatUnifiedRange(oldStart, oldCount)} +${formatUnifiedRange(newStart, newCount)} @@`);
    for (const line of hunk.lines) {
      lines.push(`${line.prefix}${line.text}`);
    }

    cursorNew = matchIndex + newCount;
    priorDelta += newCount - oldCount;
  }

  return lines;
}

function renderRawUpdateHunks(hunks = []) {
  const lines = [];
  for (const hunk of hunks) {
    lines.push(hunk.header || "@@");
    for (const line of hunk.lines) {
      lines.push(`${line.prefix}${line.text}`);
    }
  }
  return lines;
}

function findHunkStartIndex(fileLines, hunk, startIndex) {
  const newPattern = hunk.lines
    .filter((line) => line.prefix !== "-")
    .map((line) => line.text);

  if (newPattern.length === 0) {
    return Math.min(Math.max(0, startIndex), fileLines.length);
  }

  const preferredMatch = findSequenceIndex(fileLines, newPattern, startIndex);
  if (preferredMatch >= 0) {
    return preferredMatch;
  }

  return startIndex > 0 ? findSequenceIndex(fileLines, newPattern, 0) : -1;
}

function findSequenceIndex(lines, pattern, startIndex = 0) {
  if (!Array.isArray(lines) || !Array.isArray(pattern) || pattern.length === 0) {
    return -1;
  }

  const lastStart = lines.length - pattern.length;
  for (let index = Math.max(0, startIndex); index <= lastStart; index += 1) {
    let matched = true;
    for (let offset = 0; offset < pattern.length; offset += 1) {
      if (lines[index + offset] !== pattern[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return index;
    }
  }
  return -1;
}

function parseApplyPatchDocument(patch) {
  const normalizedPatch = String(patch || "").replace(/\r/g, "");
  const lines = normalizedPatch.split("\n");
  if (!lines[0] || lines[0] !== "*** Begin Patch") {
    return null;
  }

  const files = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      break;
    }

    if (line.startsWith("*** Add File: ")) {
      const parsed = parseAddedFile(lines, index);
      files.push(parsed.fileChange);
      index = parsed.nextIndex;
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      files.push({
        path: line.slice("*** Delete File: ".length).trim(),
        type: "delete",
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const parsed = parseUpdatedFile(lines, index);
      files.push(parsed.fileChange);
      index = parsed.nextIndex;
      continue;
    }

    index += 1;
  }

  return { files };
}

function parseAddedFile(lines, startIndex) {
  const fileChange = {
    lines: [],
    path: lines[startIndex].slice("*** Add File: ".length).trim(),
    type: "add",
  };

  let index = startIndex + 1;
  while (index < lines.length && !isFileBoundary(lines[index]) && lines[index] !== "*** End Patch") {
    if (lines[index].startsWith("+")) {
      fileChange.lines.push(lines[index].slice(1));
    }
    index += 1;
  }

  return {
    fileChange,
    nextIndex: index,
  };
}

function parseUpdatedFile(lines, startIndex) {
  const fileChange = {
    hunks: [],
    moveTo: "",
    path: lines[startIndex].slice("*** Update File: ".length).trim(),
    type: "update",
  };

  let currentHunk = null;
  let index = startIndex + 1;
  while (index < lines.length && !isFileBoundary(lines[index]) && lines[index] !== "*** End Patch") {
    const line = lines[index];
    if (line.startsWith("*** Move to: ")) {
      fileChange.moveTo = line.slice("*** Move to: ".length).trim();
      index += 1;
      continue;
    }

    if (line.startsWith("@@")) {
      currentHunk = {
        header: line,
        lines: [],
      };
      fileChange.hunks.push(currentHunk);
      index += 1;
      continue;
    }

    if (line === "*** End of File") {
      index += 1;
      continue;
    }

    if (/^[ +\-]/.test(line)) {
      if (!currentHunk) {
        currentHunk = {
          header: "@@",
          lines: [],
        };
        fileChange.hunks.push(currentHunk);
      }
      currentHunk.lines.push({
        prefix: line[0],
        text: line.slice(1),
      });
    }

    index += 1;
  }

  return {
    fileChange,
    nextIndex: index,
  };
}

function isFileBoundary(line) {
  return line.startsWith("*** Add File: ")
    || line.startsWith("*** Delete File: ")
    || line.startsWith("*** Update File: ");
}

function resolvePatchFilePath(candidate, cwd) {
  const trimmed = readNonEmptyString(candidate);
  if (!trimmed) {
    return "";
  }

  return path.isAbsolute(trimmed)
    ? trimmed
    : path.resolve(cwd, trimmed);
}

function readFileLines(filePath, fsModule) {
  if (!filePath) {
    return null;
  }

  try {
    if (!fsModule.existsSync(filePath) || !fsModule.statSync(filePath).isFile()) {
      return null;
    }
    return splitContentLines(fsModule.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function splitContentLines(value) {
  const normalized = String(value || "").replace(/\r/g, "");
  const lines = normalized.split("\n");
  if (normalized.endsWith("\n")) {
    lines.pop();
  }
  return lines;
}

function formatDisplayPath(candidate, cwd) {
  const trimmed = readNonEmptyString(candidate);
  if (!trimmed) {
    return "unknown";
  }

  if (!path.isAbsolute(trimmed)) {
    return trimmed.replace(/\\/g, "/");
  }

  const relative = path.relative(cwd, trimmed);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.replace(/\\/g, "/");
  }

  return trimmed.replace(/\\/g, "/");
}

function formatUnifiedRange(start, count) {
  if (!Number.isFinite(start)) {
    return "1";
  }
  if (!Number.isFinite(count)) {
    return String(start);
  }
  if (count === 1) {
    return String(start);
  }
  return `${start},${Math.max(0, count)}`;
}

function readNonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

module.exports = {
  buildDisplayPatchFromApplyPatch,
};
