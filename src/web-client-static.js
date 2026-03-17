// FILE: web-client-static.js
// Purpose: Serves the browser client skeleton from the same origin as the relay.
// Layer: Relay utility
// Exports: serveWebClientRequest, resolveWebClientAsset
// Depends on: fs, path

const fs = require("fs");
const path = require("path");

const WEB_ROUTE_PREFIX = "/app";
const WEB_CLIENT_ROOT = path.resolve(__dirname, "..", "web");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function serveWebClientRequest(req, res) {
  const pathname = safePathnameFromRequest(req);
  if (pathname === WEB_ROUTE_PREFIX) {
    res.writeHead(302, { location: `${WEB_ROUTE_PREFIX}/` });
    res.end();
    return true;
  }

  const asset = resolveWebClientAsset(pathname);
  if (!asset) {
    return false;
  }

  const body = fs.readFileSync(asset.filePath);
  res.writeHead(200, {
    "cache-control": asset.isHtml ? "no-cache" : "public, max-age=300",
    "content-length": body.length,
    "content-type": asset.contentType,
  });
  res.end(body);
  return true;
}

function resolveWebClientAsset(pathname) {
  if (typeof pathname !== "string" || !pathname.startsWith(`${WEB_ROUTE_PREFIX}/`)) {
    return null;
  }

  const relativePath = pathname === `${WEB_ROUTE_PREFIX}/`
    ? "index.html"
    : pathname.slice(`${WEB_ROUTE_PREFIX}/`.length);
  const normalizedRelativePath = path.posix.normalize(relativePath);
  if (
    !normalizedRelativePath
    || normalizedRelativePath.startsWith("..")
    || path.isAbsolute(normalizedRelativePath)
  ) {
    return null;
  }

  const filePath = path.resolve(WEB_CLIENT_ROOT, normalizedRelativePath);
  if (!filePath.startsWith(WEB_CLIENT_ROOT + path.sep) && filePath !== WEB_CLIENT_ROOT) {
    return null;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  return {
    filePath,
    contentType: contentTypeForPath(filePath),
    isHtml: path.extname(filePath).toLowerCase() === ".html",
  };
}

function safePathnameFromRequest(req) {
  try {
    return new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function contentTypeForPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[extension] || "application/octet-stream";
}

module.exports = {
  WEB_CLIENT_ROOT,
  WEB_ROUTE_PREFIX,
  resolveWebClientAsset,
  serveWebClientRequest,
};
