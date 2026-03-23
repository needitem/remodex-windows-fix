// FILE: package-version-status.test.js
// Purpose: Verifies bridge package version lookups stay fast and cache the latest npm version.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, ../package.json, ../src/package-version-status

const test = require("node:test");
const assert = require("node:assert/strict");
const { version: packageVersion } = require("../package.json");

const {
  createBridgePackageVersionStatusReader,
} = require("../src/package-version-status");

test("package version reader reports the installed version and waits briefly for the first fetch", async () => {
  let fetchCalls = 0;
  const reader = createBridgePackageVersionStatusReader({
    initialFetchWaitMs: 50,
    fetchLatestPublishedVersionImpl: async () => {
      fetchCalls += 1;
      return "9.9.9";
    },
  });

  const status = await reader();

  assert.equal(fetchCalls, 1);
  assert.deepEqual(status, {
    bridgeVersion: packageVersion,
    bridgeLatestVersion: "9.9.9",
  });
});

test("package version reader reuses the cached latest version without refetching immediately", async () => {
  let fetchCalls = 0;
  const reader = createBridgePackageVersionStatusReader({
    initialFetchWaitMs: 0,
    fetchLatestPublishedVersionImpl: async () => {
      fetchCalls += 1;
      return "2.0.0";
    },
  });

  const first = await reader();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await reader();

  assert.equal(fetchCalls, 1);
  assert.equal(first.bridgeLatestVersion, null);
  assert.equal(second.bridgeLatestVersion, "2.0.0");
});
