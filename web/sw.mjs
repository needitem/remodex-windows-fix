const APP_VERSION = "__REMODEX_WEB_ASSET_VERSION__";
const APP_SHELL_ASSET_PATHS = JSON.parse(atob("__REMODEX_WEB_APP_SHELL_ASSET_PATHS_BASE64__"));
const CACHE_NAME = `remodex-web-deck-${APP_VERSION}`;
const VERSIONED_APP_SHELL_URLS = APP_SHELL_ASSET_PATHS.map((assetPath) => withAssetVersion(assetPath));

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      "/app/",
      ...VERSIONED_APP_SHELL_URLS,
    ]))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        await self.registration?.navigationPreload?.enable();
      } catch {}

      await Promise.all([
        caches.keys().then((keys) => Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )),
        self.clients.claim(),
      ]);
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (!requestUrl.pathname.startsWith("/app/")) {
    return;
  }

  if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(networkFirst(event.request, {
      preloadResponsePromise: event.preloadResponse,
    }));
    return;
  }

  if (requestUrl.searchParams.get("v") === APP_VERSION) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(networkFirst(event.request));
});

function withAssetVersion(assetPath) {
  const requestUrl = new URL(assetPath, "https://remodex.invalid");
  requestUrl.searchParams.set("v", APP_VERSION);
  return `${requestUrl.pathname}${requestUrl.search}`;
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  await cacheResponseIfEligible(cache, request, networkResponse);
  return networkResponse;
}

async function networkFirst(request, {
  preloadResponsePromise = null,
} = {}) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const preloadResponse = preloadResponsePromise ? await preloadResponsePromise : null;
    if (preloadResponse) {
      await cacheResponseIfEligible(cache, request, preloadResponse);
      return preloadResponse;
    }

    const networkResponse = await fetch(request);
    await cacheResponseIfEligible(cache, request, networkResponse);
    return networkResponse;
  } catch {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }
    throw new Error("Network request failed and no cached app shell asset was available.");
  }
}

async function cacheResponseIfEligible(cache, request, response) {
  if (!shouldCacheResponse(request, response)) {
    return;
  }
  await cache.put(request, response.clone());
}

function shouldCacheResponse(request, response) {
  return request.method === "GET"
    && Boolean(response)
    && response.ok;
}
