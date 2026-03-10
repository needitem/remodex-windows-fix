# Relay

This folder contains the thin WebSocket relay used by the default hosted Remodex pairing flow.

The implementation is copied from the upstream open-source relay so you can run the same session routing yourself.

## What It Does

- accepts WebSocket connections at `/relay/{sessionId}`
- pairs one Mac host with one live iPhone client for a session
- forwards JSON-RPC traffic between Mac and iPhone
- replays a small in-memory history buffer to a reconnecting iPhone client
- exposes lightweight stats for a health endpoint

## What It Does Not Do

- it does not run Codex
- it does not execute git commands
- it does not contain your repository checkout
- it does not persist the local workspace on the server

Codex, git, and local file operations still run on the user's machine.

## Local Runner

This repository includes a local relay runner:

```bash
npm run relay
```

Environment variables:

- `REMODEX_RELAY_HOST` defaults to `0.0.0.0`
- `REMODEX_RELAY_PORT` defaults to `9000`

Health endpoint:

- `GET /health`
