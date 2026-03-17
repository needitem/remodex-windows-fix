// FILE: relay-hardening.test.js
// Purpose: Verifies relay hardening helpers inspired by the Rust relay behave as expected.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../relay/relay, ../src/fixed-window-rate-limiter, ../src/relay-server

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  relaySessionLogLabel,
  timingSafeSecretMatch,
} = require("../relay/relay");
const { FixedWindowRateLimiter } = require("../src/fixed-window-rate-limiter");
const {
  readOptionalBooleanEnv,
  redactRelayPathname,
} = require("../src/relay-server");

test("relaySessionLogLabel redacts raw session ids into a stable short hash", () => {
  const firstLabel = relaySessionLogLabel("session-abc-123");
  const secondLabel = relaySessionLogLabel("session-abc-123");

  assert.match(firstLabel, /^session#[0-9a-f]{8}$/);
  assert.equal(firstLabel, secondLabel);
  assert.equal(firstLabel.includes("session-abc-123"), false);
});

test("timingSafeSecretMatch only accepts identical non-empty secrets", () => {
  assert.equal(timingSafeSecretMatch("secret-token", "secret-token"), true);
  assert.equal(timingSafeSecretMatch("secret-token", "secret-other"), false);
  assert.equal(timingSafeSecretMatch("secret-token", "short"), false);
  assert.equal(timingSafeSecretMatch("", "secret-token"), false);
});

test("FixedWindowRateLimiter blocks after the configured request budget and resets on a new window", async () => {
  const limiter = new FixedWindowRateLimiter(10, 2);

  assert.equal(limiter.allow("client-a"), true);
  assert.equal(limiter.allow("client-a"), true);
  assert.equal(limiter.allow("client-a"), false);

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(limiter.allow("client-a"), true);
});

test("readOptionalBooleanEnv supports the relay boolean env flags", () => {
  const previousValue = process.env.REMODEX_TRUST_PROXY;
  process.env.REMODEX_TRUST_PROXY = "true";

  try {
    assert.equal(readOptionalBooleanEnv(["REMODEX_TRUST_PROXY"]), true);
    process.env.REMODEX_TRUST_PROXY = "off";
    assert.equal(readOptionalBooleanEnv(["REMODEX_TRUST_PROXY"]), false);
  } finally {
    if (previousValue == null) {
      delete process.env.REMODEX_TRUST_PROXY;
    } else {
      process.env.REMODEX_TRUST_PROXY = previousValue;
    }
  }
});

test("redactRelayPathname hides session ids in upgrade logs", () => {
  const redacted = redactRelayPathname("/relay/very-secret-session-id?role=mac");

  assert.match(redacted, /^\/relay\/session#[0-9a-f]{8}\?role=mac$/);
  assert.equal(redacted.includes("very-secret-session-id"), false);
});
