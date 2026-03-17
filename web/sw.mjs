const CACHE_NAME = "remodex-web-deck-v3";
const APP_SHELL_URLS = [
  "/app/",
  "/app/styles.css",
  "/app/main.mjs",
  "/app/manifest.webmanifest",
  "/app/icon.svg",
  "/app/vendor/jsqr.js",
  "/app/modules/browser-relay-client.mjs",
  "/app/modules/browser-bridge-client.mjs",
  "/app/modules/browser-secure-transport.mjs",
  "/app/modules/capabilities.mjs",
  "/app/modules/mock-data.mjs",
  "/app/modules/pairing.mjs",
  "/app/modules/preferences.mjs",
  "/app/modules/qr-decoder.mjs",
  "/app/modules/scanner-controller.mjs",
  "/app/modules/storage.mjs",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== CACHE_NAME)
        .map((key) => caches.delete(key))
    ))
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (!requestUrl.pathname.startsWith("/app/")) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => (
      cachedResponse
      || fetch(event.request).then((networkResponse) => {
        const copy = networkResponse.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return networkResponse;
      })
    ))
  );
});
