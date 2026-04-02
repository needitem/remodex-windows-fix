// FILE: web-client-static.js
// Purpose: Serves the browser client skeleton from the same origin as the relay.
// Layer: Relay utility
// Exports: serveWebClientRequest, resolveWebClientAsset
// Depends on: ./web-asset-pipeline

const {
  WEB_ROOT: WEB_CLIENT_ROOT,
  WEB_ROUTE_PREFIX,
  buildWebAssetRecords,
  matchesIfNoneMatch,
  normalizeWebAssetPath,
  normalizeWebAssetUrl,
  pickCacheControlForWebAsset,
} = require("./web-asset-pipeline");

const WEB_ASSETS = new Map(
  buildWebAssetRecords().map((asset) => [asset.path, asset])
);

function serveWebClientRequest(req, res) {
  const requestUrl = normalizeWebAssetUrl(req);
  const pathname = requestUrl?.pathname || "/";
  if (pathname === "/" || pathname === WEB_ROUTE_PREFIX) {
    res.writeHead(302, { location: `${WEB_ROUTE_PREFIX}/` });
    res.end();
    return true;
  }

  const asset = resolveWebClientAsset(requestUrl);
  if (!asset) {
    return false;
  }

  const headers = {
    "cache-control": asset.cacheControl,
    "content-type": asset.contentType,
    "etag": asset.etag,
    "x-content-type-options": "nosniff",
  };

  if (matchesIfNoneMatch(req?.headers?.["if-none-match"], asset.etag)) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  res.writeHead(200, {
    ...headers,
    "content-length": asset.contentLength,
  });
  res.end(asset.body);
  return true;
}

function resolveWebClientAsset(requestTarget) {
  const requestUrl = normalizeWebAssetUrl(requestTarget);
  const pathname = normalizeWebAssetPath(requestUrl?.pathname || "");
  if (typeof pathname !== "string" || !pathname.startsWith(`${WEB_ROUTE_PREFIX}/`)) {
    return null;
  }

  const asset = WEB_ASSETS.get(pathname);
  if (!asset) {
    return null;
  }

  return {
    ...asset,
    cacheControl: pickCacheControlForWebAsset(asset, requestUrl),
  };
}

module.exports = {
  WEB_CLIENT_ROOT,
  WEB_ROUTE_PREFIX,
  resolveWebClientAsset,
  serveWebClientRequest,
};
