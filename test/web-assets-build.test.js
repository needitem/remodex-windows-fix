// FILE: web-assets-build.test.js
// Purpose: Verifies the Cloudflare web asset generator resolves vendor assets and writes an output file.
// Layer: Unit test
// Exports: node:test suite
// Depends on: node:test, node:assert/strict, fs, os, path, ../src/generate-web-asset-map

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const {
  generateWebAssetMap,
  resolveExtraAssets,
} = require("../src/generate-web-asset-map");
const { buildWebAssetRecords } = require("../src/web-asset-pipeline");

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
    assert.match(contents, /\/app\/chunks\//);
    assert.match(contents, /versionedCacheControl/);
    assert.match(contents, /etag/);
    assert.doesNotMatch(contents, /__REMODEX_WEB_ASSET_VERSION__/);
    assert.doesNotMatch(contents, /\/app\/modules\//);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("checked-in Cloudflare asset map stays in sync with the current web asset pipeline", async () => {
  const generatedModuleUrl = `${pathToFileURL(path.resolve(__dirname, "..", "cloudflare", "web-assets.generated.mjs")).href}?case=${Date.now()}`;
  const generatedModule = await import(generatedModuleUrl);
  const generatedAssets = Array.from(generatedModule.WEB_ASSETS.values()).map(normalizeComparableAsset);
  const freshAssets = buildWebAssetRecords().map(normalizeComparableAsset);

  assert.equal(generatedModule.WEB_ASSET_VERSION, freshAssets[0]?.version || "");
  assert.deepEqual(
    generatedAssets.map((asset) => asset.path),
    freshAssets.map((asset) => asset.path)
  );
  assert.equal(hashAssetList(generatedAssets), hashAssetList(freshAssets));
});

function normalizeComparableAsset(asset) {
  return {
    body: asset.body,
    contentLength: asset.contentLength,
    contentType: asset.contentType,
    defaultCacheControl: asset.defaultCacheControl,
    etag: asset.etag,
    path: asset.path,
    version: asset.version,
    versionedCacheControl: asset.versionedCacheControl,
  };
}

function hashAssetList(assets) {
  return createHash("sha256").update(JSON.stringify(assets)).digest("hex");
}
