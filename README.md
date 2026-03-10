# remodex-windows-fix

Windows-friendly mirror of `remodex` with a launcher fix for `codex app-server`.

## What Changed

- Fixes Windows startup when `remodex up` tries to spawn `codex` and fails with `spawn codex ENOENT`.
- Prefers `codex.cmd` or `codex.bat` on Windows and runs them with shell support.
- Falls back to `codex.exe` when a wrapper script is not present.
- Adds `REMODEX_CODEX_BIN` and `PHODEX_CODEX_BIN` overrides for explicit Codex binary selection.
- Prevents immediate uncaught startup crashes by routing launcher failures through Remodex error handling.

## Why This Exists

On Windows, `codex` is often installed through npm as a `.cmd` shim. A plain Node `spawn("codex", ["app-server"])` call can fail even when `codex` works in PowerShell. This fork resolves the executable explicitly before launching the bridge.

## Install

Install from this GitHub repository:

```bash
npm install -g github:needitem/remodex-windows-fix
```

## Usage

Start the bridge:

```bash
remodex up
```

Resume the last active thread:

```bash
remodex resume
```

Watch rollout output:

```bash
remodex watch [threadId]
```

## Windows Override

If you want to force a specific Codex binary, set one of these environment variables before running `remodex up`:

```powershell
$env:REMODEX_CODEX_BIN = "C:\Users\th072\AppData\Roaming\npm\codex.cmd"
```

Legacy alias:

```powershell
$env:PHODEX_CODEX_BIN = "C:\Users\th072\AppData\Roaming\npm\codex.cmd"
```

## Self-Hosted Relay

This repository now includes the upstream-compatible relay code and a local runner.

Start your own relay:

```bash
npm run relay
```

Or use the bundled binary directly:

```bash
remodex-relay
```

Optional relay host/port overrides:

```powershell
$env:REMODEX_RELAY_HOST = "0.0.0.0"
$env:REMODEX_RELAY_PORT = "9000"
```

Point the bridge at your relay:

```powershell
$env:REMODEX_RELAY = "ws://YOUR_HOST:9000/relay"
remodex up
```

For TLS/reverse-proxy setups, use the public `wss://YOUR_DOMAIN/relay` URL instead.

Health endpoint:

```text
GET /health
```

## Deploy From GitHub

GitHub itself does not host persistent WebSocket servers for this use case. The practical path is:

[\!\[Deploy to Render\]\(https://render.com/images/deploy-to-render-button.svg\)]\(https://render.com/deploy?repo=https://github.com/needitem/remodex-windows-fix\)

1. Push this repository to GitHub.
2. Create a new Render Web Service from that repository.
3. Render will detect the included [render.yaml](render.yaml) and run the relay as a public service.
4. After deploy, use your Render URL as the relay base:

```powershell
$env:REMODEX_RELAY = "wss://YOUR-SERVICE.onrender.com/relay"
remodex up
```

The bundled relay listens on `PORT` automatically for Render-compatible hosting.

## Validation

Typical local verification:

```bash
codex --version
codex app-server --help
remodex up
```

Expected Windows resolution after the fix:

```text
C:\Users\th072\AppData\Roaming\npm\codex.cmd app-server
```

## Project Layout

```text
bin/
src/
package.json
```

## Attribution

This repository preserves the upstream Remodex package structure and credits the original package author in `package.json`. This fork adds a Windows launcher compatibility patch and accompanying documentation.
