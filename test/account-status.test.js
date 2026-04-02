// FILE: account-status.test.js
// Purpose: Verifies sanitized account status snapshots for the bridge-owned auth helpers.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../src/account-status

const test = require("node:test");
const assert = require("node:assert/strict");
const { version: packageVersion } = require("../package.json");

const {
  composeSanitizedAuthStatusFromSettledResults,
} = require("../src/account-status");

test("composeSanitizedAuthStatusFromSettledResults keeps explicit account login info when token status is unavailable", () => {
  const snapshot = composeSanitizedAuthStatusFromSettledResults({
    accountReadResult: {
      status: "fulfilled",
      value: {
        account: {
          email: "dev@example.com",
          planType: "pro",
          loggedIn: true,
          type: "chatgpt",
        },
        requiresOpenaiAuth: false,
      },
    },
    authStatusResult: {
      status: "rejected",
      reason: new Error("offline"),
    },
    loginInFlight: false,
    transportMode: "spawn",
  });

  assert.deepEqual(snapshot, {
    authMethod: "chatgpt",
    status: "authenticated",
    email: "dev@example.com",
    planType: "pro",
    loginInFlight: false,
    needsReauth: false,
    tokenReady: false,
    expiresAt: null,
    bridgeVersion: packageVersion,
    bridgeLatestVersion: null,
    codexTransportMode: "spawn",
  });
});

test("composeSanitizedAuthStatusFromSettledResults throws when both bridge auth reads fail", () => {
  assert.throws(
    () => composeSanitizedAuthStatusFromSettledResults({
      accountReadResult: {
        status: "rejected",
        reason: new Error("account/read failed"),
      },
      authStatusResult: {
        status: "rejected",
        reason: new Error("getAuthStatus failed"),
      },
    }),
    /Unable to read ChatGPT account status/
  );
});
