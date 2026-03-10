#!/usr/bin/env node
// FILE: remodex-relay.js
// Purpose: CLI entrypoint for running the bundled Remodex relay locally.
// Layer: CLI binary
// Exports: none
// Depends on: ../src/relay-server

const { startRelayServer } = require("../src/relay-server");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("Usage: remodex-relay [port]");
  console.log("Environment: REMODEX_RELAY_HOST, REMODEX_RELAY_PORT");
  process.exit(0);
}

const portArg = process.argv[2];
startRelayServer({
  port: portArg ? Number.parseInt(portArg, 10) : undefined,
});
