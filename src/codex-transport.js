// FILE: codex-transport.js
// Purpose: Abstracts the Codex-side transport so the bridge can talk to either a spawned app-server or an existing WebSocket endpoint.
// Layer: CLI helper
// Exports: createCodexTransport
// Depends on: child_process, ws

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const WebSocket = require("ws");

function createCodexTransport({ endpoint = "", env = process.env } = {}) {
  if (endpoint) {
    return createWebSocketTransport({ endpoint });
  }

  return createSpawnTransport({ env });
}

function createSpawnTransport({ env }) {
  const listeners = createListenerBag();
  const spawnConfig = resolveCodexSpawnConfig(env);

  if (spawnConfig.error) {
    process.nextTick(() => listeners.emitError(spawnConfig.error));
    return createInactiveSpawnTransport(listeners, spawnConfig);
  }

  let codex = null;
  try {
    codex = spawn(spawnConfig.command, spawnConfig.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...env },
      shell: spawnConfig.shell,
      windowsHide: true,
    });
  } catch (error) {
    process.nextTick(() => listeners.emitError(normalizeSpawnError(error, spawnConfig)));
    return createInactiveSpawnTransport(listeners, spawnConfig);
  }

  let stdoutBuffer = "";

  codex.on("error", (error) => listeners.emitError(normalizeSpawnError(error, spawnConfig)));
  codex.on("close", (code, signal) => listeners.emitClose(code, signal));
  // The bridge keeps stdout focused on connection state, so raw app-server logs stay muted here.
  codex.stderr.on("data", () => {});

  codex.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString("utf8");
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() || "";

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine) {
        listeners.emitMessage(trimmedLine);
      }
    }
  });

  return {
    mode: "spawn",
    describe() {
      return spawnConfig.description;
    },
    send(message) {
      if (!codex.stdin.writable) {
        return;
      }

      codex.stdin.write(message.endsWith("\n") ? message : `${message}\n`);
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    shutdown() {
      if (!codex.killed) {
        codex.kill("SIGTERM");
      }
    },
  };
}

function createInactiveSpawnTransport(listeners, spawnConfig) {
  return {
    mode: "spawn",
    describe() {
      return spawnConfig.description;
    },
    send() {},
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    shutdown() {},
  };
}

function resolveCodexSpawnConfig(env) {
  const commandName = "codex";
  const args = ["app-server"];
  const description = "`codex app-server`";

  if (process.platform !== "win32") {
    return {
      command: commandName,
      args,
      shell: false,
      description,
    };
  }

  const override = readFirstDefinedEnv(env, ["REMODEX_CODEX_BIN", "PHODEX_CODEX_BIN"], "");
  if (override) {
    return createWindowsSpawnConfig(override, args);
  }

  const codexCmd = findFirstOnPath(env, ["codex.cmd", "codex.bat"]);
  if (codexCmd) {
    return createWindowsSpawnConfig(codexCmd, args);
  }

  const codexExe = findFirstOnPath(env, ["codex.exe"]);
  if (codexExe) {
    return createWindowsSpawnConfig(codexExe, args);
  }

  const error = new Error("spawn codex ENOENT");
  error.code = "ENOENT";

  return {
    command: commandName,
    args,
    shell: false,
    description,
    error,
  };
}

function createWindowsSpawnConfig(command, args) {
  const normalized = String(command).trim();
  const lower = normalized.toLowerCase();
  const needsShell = lower.endsWith(".cmd") || lower.endsWith(".bat");

  return {
    command: normalized,
    args,
    shell: needsShell,
    description: `\`${normalized} ${args.join(" ")}\``,
  };
}

function normalizeSpawnError(error, spawnConfig) {
  if (!error) {
    return new Error(`Failed to start ${spawnConfig.description}.`);
  }

  if (!error.message.includes(spawnConfig.description)) {
    error.message = `${error.message} (${spawnConfig.description})`;
  }

  return error;
}

function findFirstOnPath(env, names) {
  const pathValue = readFirstDefinedEnv(env, ["PATH", "Path"], "");
  if (!pathValue) {
    return "";
  }

  const directories = pathValue
    .split(path.delimiter)
    .map((segment) => segment.trim().replace(/^"+|"+$/g, ""))
    .filter(Boolean);

  for (const directory of directories) {
    for (const name of names) {
      const candidate = path.join(directory, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          return candidate;
        }
      } catch {}
    }
  }

  return "";
}

function readFirstDefinedEnv(env, keys, fallback) {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }

  return fallback;
}

function createWebSocketTransport({ endpoint }) {
  const socket = new WebSocket(endpoint);
  const listeners = createListenerBag();

  socket.on("message", (chunk) => {
    const message = typeof chunk === "string" ? chunk : chunk.toString("utf8");
    if (message.trim()) {
      listeners.emitMessage(message);
    }
  });

  socket.on("close", (code, reason) => {
    const safeReason = reason ? reason.toString("utf8") : "no reason";
    listeners.emitClose(code, safeReason);
  });

  socket.on("error", (error) => listeners.emitError(error));

  return {
    mode: "websocket",
    describe() {
      return endpoint;
    },
    send(message) {
      if (socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(message);
    },
    onMessage(handler) {
      listeners.onMessage = handler;
    },
    onClose(handler) {
      listeners.onClose = handler;
    },
    onError(handler) {
      listeners.onError = handler;
    },
    shutdown() {
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    },
  };
}

function createListenerBag() {
  return {
    onMessage: null,
    onClose: null,
    onError: null,
    emitMessage(message) {
      this.onMessage?.(message);
    },
    emitClose(...args) {
      this.onClose?.(...args);
    },
    emitError(error) {
      this.onError?.(error);
    },
  };
}

module.exports = { createCodexTransport };
