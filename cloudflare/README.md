# Cloudflare Relay

This folder contains a Cloudflare Workers + Durable Objects implementation of the Remodex relay protocol.

It preserves the same session path and headers used by the bridge and iPhone client:

- path: `/relay/{sessionId}`
- required header: `x-role: mac` or `x-role: iphone`
- close code `4000`: invalid session or role
- close code `4001`: previous Mac connection replaced
- close code `4002`: session unavailable / Mac disconnected
- close code `4003`: previous iPhone connection replaced

The public health endpoint is:

- `GET /health`
