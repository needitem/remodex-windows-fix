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
