// FILE: web-assets-build.test.js
// Purpose: Verifies the Cloudflare web asset generator resolves vendor assets and writes an output file.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/generate-web-asset-map

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  generateWebAssetMap,
  resolveExtraAssets,
} = require("../src/generate-web-asset-map");

test("resolveExtraAssets points at an installed jsqr bundle", () => {
  const assets = resolveExtraAssets();
  const jsqrAsset = assets.find((entry) => entry.requestPath === "/app/vendor/jsqr.js");

  assert.ok(jsqrAsset);
  assert.ok(fs.existsSync(jsqrAsset.absolutePath));
  assert.match(jsqrAsset.absolutePath, /jsQR\.js$/);
});

test("generateWebAssetMap writes a worker asset map to the requested output file", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "remodex-web-assets-"));
  const outputFile = path.join(tempDir, "web-assets.generated.mjs");

  try {
    const writtenPath = generateWebAssetMap({ outputFile });
    assert.equal(writtenPath, outputFile);
    assert.ok(fs.existsSync(outputFile));

    const contents = fs.readFileSync(outputFile, "utf8");
    assert.match(contents, /WEB_ASSETS/);
    assert.match(contents, /\/app\/vendor\/jsqr\.js/);
    assert.match(contents, /\/app\//);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
