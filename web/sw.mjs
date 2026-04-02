const CACHE_NAME = "remodex-web-deck-v10";
const APP_SHELL_URLS = [
  "/app/",
  "/app/bootstrap.mjs",
  "/app/styles.css",
  "/app/main.mjs",
  "/app/manifest.webmanifest",
  "/app/icon.svg",
  "/app/vendor/jsqr.js",
  "/app/modules/browser-relay-client.mjs",
  "/app/modules/browser-bridge-client.mjs",
  "/app/modules/browser-notifications.mjs",
  "/app/modules/browser-secure-transport.mjs",
  "/app/modules/capabilities.mjs",
  "/app/modules/mock-data.mjs",
  "/app/modules/mobile-dock-state.mjs",
  "/app/modules/pairing.mjs",
  "/app/modules/preferences.mjs",
  "/app/modules/qr-decoder.mjs",
  "/app/modules/scanner-controller.mjs",
  "/app/modules/storage.mjs",
  "/app/modules/thread-chat-state.mjs",
  "/app/modules/thread-collaboration-state.mjs",
  "/app/modules/thread-command-state.mjs",
  "/app/modules/thread-conversation-state.mjs",
  "/app/modules/thread-message-renderer.mjs",
  "/app/modules/thread-message-state.mjs",
  "/app/modules/thread-send.mjs",
];

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )),
      self.clients.claim(),
    ])
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (!requestUrl.pathname.startsWith("/app/")) {
    return;
  }

  const shouldPreferNetwork = event.request.mode === "navigate"
    || event.request.destination === "script"
    || event.request.destination === "style"
    || requestUrl.pathname.endsWith(".mjs")
    || requestUrl.pathname.endsWith(".js")
    || requestUrl.pathname.endsWith(".css");

  event.respondWith(
    (shouldPreferNetwork
      ? fetch(event.request).then((networkResponse) => {
        const copy = networkResponse.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return networkResponse;
      }).catch(() => caches.match(event.request))
      : caches.match(event.request).then((cachedResponse) => (
        cachedResponse
        || fetch(event.request).then((networkResponse) => {
          const copy = networkResponse.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return networkResponse;
        })
      )))
  );
});
