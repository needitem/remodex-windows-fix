// FILE: web-asset-pipeline.js
// Purpose: Builds versioned web asset records with cache metadata for local and Cloudflare serving.
// Layer: Shared web asset utility
// Exports: asset record builders, cache helpers, request normalization
// Depends on: crypto, fs, path, esbuild

const { createHash } = require("crypto");
const fs = require("fs");
const path = require("path");
const esbuild = require("esbuild");

const WEB_ROUTE_PREFIX = "/app";
const WEB_ROOT = path.resolve(__dirname, "..", "web");
const VERSION_PLACEHOLDER = "__REMODEX_WEB_ASSET_VERSION__";
const APP_SHELL_ASSET_PATHS_BASE64_PLACEHOLDER = "__REMODEX_WEB_APP_SHELL_ASSET_PATHS_BASE64__";
const EXTRA_MODULEPRELOAD_LINKS_PLACEHOLDER = "<!-- __REMODEX_WEB_EXTRA_MODULEPRELOAD_LINKS__ -->";
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const REVALIDATE_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const BUNDLED_WEB_ENTRY_POINTS = ["bootstrap.mjs", "main.mjs"];
const INITIAL_MODULEPRELOAD_ENTRY_PATHS = new Set([
  `${WEB_ROUTE_PREFIX}/bootstrap.mjs`,
  `${WEB_ROUTE_PREFIX}/main.mjs`,
]);
const MODERN_WEB_TARGETS = [
  "chrome109",
  "edge109",
  "firefox115",
  "safari16",
];

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const MODULE_STATIC_IMPORT_RE = /(\bimport\s+(?:[^"'`]*?\s+from\s+)?)(['"])(\.[^"'`]+?)\2/g;
const MODULE_DYNAMIC_IMPORT_RE = /(\bimport\s*\(\s*)(['"])(\.[^"'`]+?)\2(\s*\))/g;
const TEXT_ASSET_EXTENSIONS = new Set(Object.keys(CONTENT_TYPES));

function resolveExtraAssets() {
  return [
    {
      absolutePath: require.resolve("jsqr"),
      requestPath: "/app/vendor/jsqr.js",
    },
  ];
}

function resolveWebAssetEntries({
  webRoot = WEB_ROOT,
  extraAssets = resolveExtraAssets(),
} = {}) {
  const sourceEntries = collectAssets(webRoot)
    .map((absolutePath) => mapSourceFileToWebAssetEntry(absolutePath, { webRoot }))
    .filter(Boolean);
  const bundledEntries = buildBundledWebScriptEntries({ webRoot });

  return [
    ...sourceEntries,
    ...bundledEntries,
    ...extraAssets.map((entry) => ({
      absolutePath: entry.absolutePath,
      requestPath: entry.requestPath,
      sourceKind: "extra-asset",
    })),
  ].sort((left, right) => left.requestPath.localeCompare(right.requestPath));
}

function mapSourceFileToWebAssetEntry(absolutePath, {
  webRoot,
} = {}) {
  const relativePath = path.relative(webRoot, absolutePath).replace(/\\/g, "/");
  if (!relativePath || shouldExcludeSourceWebAsset(relativePath)) {
    return null;
  }

  return {
    absolutePath,
    requestPath: relativePath === "index.html" ? `${WEB_ROUTE_PREFIX}/` : `${WEB_ROUTE_PREFIX}/${relativePath}`,
    sourceKind: "source-file",
  };
}

function shouldExcludeSourceWebAsset(relativePath) {
  return relativePath === "bootstrap.mjs"
    || relativePath === "main.mjs"
    || relativePath.startsWith("modules/");
}

function buildBundledWebScriptEntries({
  webRoot = WEB_ROOT,
} = {}) {
  const outdir = path.join(webRoot, ".remodex-web-build");
  const result = esbuild.buildSync({
    absWorkingDir: webRoot,
    bundle: true,
    chunkNames: "chunks/[name]-[hash]",
    entryNames: "[name]",
    entryPoints: BUNDLED_WEB_ENTRY_POINTS,
    format: "esm",
    legalComments: "none",
    logLevel: "silent",
    minify: true,
    outExtension: {
      ".js": ".mjs",
    },
    outdir,
    platform: "browser",
    splitting: true,
    target: MODERN_WEB_TARGETS,
    treeShaking: true,
    write: false,
  });

  return result.outputFiles
    .filter((outputFile) => path.extname(outputFile.path).toLowerCase() === ".mjs")
    .map((outputFile) => {
      const relativePath = path.relative(outdir, outputFile.path).replace(/\\/g, "/");
      return {
        absolutePath: path.join(webRoot, relativePath),
        requestPath: `${WEB_ROUTE_PREFIX}/${relativePath}`,
        sourceBody: Buffer.from(outputFile.contents).toString("utf8"),
        sourceKind: "esbuild-bundle",
      };
    })
    .sort((left, right) => left.requestPath.localeCompare(right.requestPath));
}

function buildWebAssetVersion({
  assetEntries = resolveWebAssetEntries(),
} = {}) {
  const hash = createHash("sha256");

  for (const entry of assetEntries) {
    hash.update(entry.requestPath);
    hash.update("\0");
    hash.update(readWebAssetSource(entry), "utf8");
    hash.update("\0");
  }

  return hash.digest("hex").slice(0, 12);
}

function buildWebAssetRecords({
  assetEntries = resolveWebAssetEntries(),
  version = buildWebAssetVersion({ assetEntries }),
} = {}) {
  return assetEntries.map((entry) => buildWebAssetRecord(entry, {
    assetEntries,
    version,
  }));
}

function buildWebAssetRecord(entry, {
  assetEntries,
  version,
} = {}) {
  const extension = path.extname(entry.absolutePath || entry.requestPath).toLowerCase();
  const contentType = CONTENT_TYPES[extension] || "application/octet-stream";
  const body = buildWebAssetBody(entry, {
    assetEntries,
    extension,
    version,
  });
  const contentLength = Buffer.byteLength(body, "utf8");
  const etag = `"${createHash("sha256").update(body, "utf8").digest("hex")}"`;

  return {
    body,
    contentLength,
    contentType,
    defaultCacheControl: cacheControlForWebAssetRequest(entry.requestPath, { version }),
    etag,
    path: entry.requestPath,
    version,
    versionedCacheControl: cacheControlForWebAssetRequest(entry.requestPath, {
      requestVersion: version,
      version,
    }),
  };
}

function buildWebAssetBody(entry, {
  assetEntries,
  extension,
  version,
} = {}) {
  if (!TEXT_ASSET_EXTENSIONS.has(extension)) {
    throw new Error(`Unsupported non-text web asset: ${entry.absolutePath || entry.requestPath}`);
  }

  const source = readWebAssetSource(entry);
  return transformWebTextAsset(source, {
    assetEntries,
    entry,
    extension,
    version,
  });
}

function readWebAssetSource(entry) {
  if (typeof entry?.sourceBody === "string") {
    return entry.sourceBody;
  }
  return fs.readFileSync(entry.absolutePath, "utf8");
}

function transformWebTextAsset(source, {
  assetEntries = [],
  entry,
  extension,
  version,
} = {}) {
  let body = source
    .split(VERSION_PLACEHOLDER)
    .join(version || "")
    .split(APP_SHELL_ASSET_PATHS_BASE64_PLACEHOLDER)
    .join(buildAppShellAssetPathsBase64({ assetEntries }))
    .split(EXTRA_MODULEPRELOAD_LINKS_PLACEHOLDER)
    .join(buildExtraModulePreloadLinks({ assetEntries, version }));

  if (extension === ".css") {
    body = minifyTextAsset(body, { loader: "css" });
  } else if (extension === ".js" || extension === ".mjs") {
    if (entry?.sourceKind !== "esbuild-bundle") {
      body = minifyTextAsset(body, { loader: "js" });
    }
    body = rewriteRelativeModuleSpecifiers(body, version);
  } else if (extension === ".webmanifest") {
    body = minifyJsonText(body);
  }

  return body;
}

function minifyTextAsset(source, {
  loader,
} = {}) {
  return esbuild.transformSync(source, {
    legalComments: "none",
    loader,
    minify: true,
    target: MODERN_WEB_TARGETS,
  }).code;
}

function minifyJsonText(source) {
  try {
    return JSON.stringify(JSON.parse(source));
  } catch {
    return source;
  }
}

function buildAppShellAssetPathsBase64({
  assetEntries = [],
} = {}) {
  return Buffer
    .from(JSON.stringify(buildAppShellAssetPaths({ assetEntries })), "utf8")
    .toString("base64");
}

function buildAppShellAssetPaths({
  assetEntries = [],
} = {}) {
  return assetEntries
    .map((entry) => entry.requestPath)
    .filter((requestPath) => requestPath !== `${WEB_ROUTE_PREFIX}/`)
    .filter((requestPath) => requestPath !== `${WEB_ROUTE_PREFIX}/sw.mjs`)
    .filter((requestPath) => !requestPath.startsWith(`${WEB_ROUTE_PREFIX}/vendor/`))
    .sort();
}

function buildExtraModulePreloadLinks({
  assetEntries = [],
  version = "",
} = {}) {
  const preloadPaths = new Set();

  for (const entry of assetEntries) {
    if (!INITIAL_MODULEPRELOAD_ENTRY_PATHS.has(entry.requestPath)) {
      continue;
    }

    for (const specifier of extractRelativeImportSpecifiers(readWebAssetSource(entry))) {
      const requestPath = resolveRelativeRequestPath(entry.requestPath, specifier);
      if (!requestPath || requestPath === `${WEB_ROUTE_PREFIX}/main.mjs`) {
        continue;
      }
      preloadPaths.add(requestPath);
    }
  }

  return Array.from(preloadPaths)
    .sort()
    .map((requestPath) => `  <link rel="modulepreload" href="${appendVersionToRequestPath(requestPath, version)}">`)
    .join("\n");
}

function extractRelativeImportSpecifiers(source) {
  const specifiers = [];
  const matcher = new RegExp(MODULE_STATIC_IMPORT_RE);
  let match = matcher.exec(source);
  while (match) {
    if (typeof match[3] === "string" && match[3].startsWith(".")) {
      specifiers.push(match[3]);
    }
    match = matcher.exec(source);
  }
  return specifiers;
}

function resolveRelativeRequestPath(baseRequestPath, specifier) {
  if (typeof specifier !== "string" || !specifier.startsWith(".")) {
    return "";
  }

  try {
    const resolved = new URL(specifier, `https://remodex.invalid${baseRequestPath}`);
    return resolved.pathname;
  } catch {
    return "";
  }
}

function rewriteRelativeModuleSpecifiers(source, version) {
  if (!version) {
    return source;
  }

  return source
    .replace(MODULE_STATIC_IMPORT_RE, (match, prefix, quote, specifier) => (
      `${prefix}${quote}${appendVersionToRelativeSpecifier(specifier, version)}${quote}`
    ))
    .replace(MODULE_DYNAMIC_IMPORT_RE, (match, prefix, quote, specifier, suffix) => (
      `${prefix}${quote}${appendVersionToRelativeSpecifier(specifier, version)}${quote}${suffix}`
    ));
}

function appendVersionToRelativeSpecifier(specifier, version) {
  if (typeof specifier !== "string" || !specifier.startsWith(".")) {
    return specifier;
  }

  const [beforeHash, hashSuffix = ""] = specifier.split("#", 2);
  const [pathname, search = ""] = beforeHash.split("?", 2);
  const searchParams = new URLSearchParams(search);
  searchParams.set("v", version);
  const serializedSearch = searchParams.toString();

  return `${pathname}${serializedSearch ? `?${serializedSearch}` : ""}${hashSuffix ? `#${hashSuffix}` : ""}`;
}

function appendVersionToRequestPath(requestPath, version) {
  const requestUrl = new URL(requestPath, "https://remodex.invalid");
  requestUrl.searchParams.set("v", version);
  return `${requestUrl.pathname}${requestUrl.search}`;
}

function collectAssets(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectAssets(absolutePath));
      continue;
    }
    files.push(absolutePath);
  }

  return files.sort();
}

function normalizeWebAssetUrl(target) {
  if (target instanceof URL) {
    return target;
  }

  const rawTarget = typeof target === "string"
    ? target
    : typeof target?.url === "string"
      ? target.url
      : "";

  if (!rawTarget) {
    return null;
  }

  try {
    return new URL(rawTarget, "http://localhost");
  } catch {
    return null;
  }
}

function normalizeWebAssetPath(pathname) {
  if (pathname === WEB_ROUTE_PREFIX) {
    return `${WEB_ROUTE_PREFIX}/`;
  }
  return pathname;
}

function cacheControlForWebAssetRequest(requestPath, {
  requestVersion = "",
  version = "",
} = {}) {
  if (!isLongLivedWebAsset(requestPath) || requestVersion !== version || !version) {
    return REVALIDATE_CACHE_CONTROL;
  }
  return IMMUTABLE_CACHE_CONTROL;
}

function pickCacheControlForWebAsset(asset, requestUrl) {
  return cacheControlForWebAssetRequest(asset.path, {
    requestVersion: requestUrl?.searchParams?.get("v") || "",
    version: asset.version,
  });
}

function isLongLivedWebAsset(requestPath) {
  return requestPath !== `${WEB_ROUTE_PREFIX}/`
    && path.posix.extname(requestPath) !== ".html";
}

function matchesIfNoneMatch(headerValue, etag) {
  if (!headerValue || !etag) {
    return false;
  }

  const normalizedValue = String(headerValue).trim();
  if (!normalizedValue) {
    return false;
  }
  if (normalizedValue === "*") {
    return true;
  }

  return normalizedValue
    .split(",")
    .map((candidate) => candidate.trim())
    .includes(etag);
}

module.exports = {
  APP_SHELL_ASSET_PATHS_BASE64_PLACEHOLDER,
  CONTENT_TYPES,
  EXTRA_MODULEPRELOAD_LINKS_PLACEHOLDER,
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  VERSION_PLACEHOLDER,
  WEB_ROOT,
  WEB_ROUTE_PREFIX,
  buildWebAssetRecord,
  buildWebAssetRecords,
  buildWebAssetVersion,
  cacheControlForWebAssetRequest,
  matchesIfNoneMatch,
  normalizeWebAssetPath,
  normalizeWebAssetUrl,
  pickCacheControlForWebAsset,
  resolveExtraAssets,
  resolveWebAssetEntries,
};
