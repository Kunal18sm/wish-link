const STATIC_CACHE_NAME = "vishlink-static-v5";
const STATIC_ASSETS = [
  "/design.css",
  "/output.css",
  "/installPrompt.js?v=20260326a",
  "/script.js",
  "/manifest.webmanifest",
  "/assets/vishlink_logo.png",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName !== STATIC_CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    )
  );
  self.clients.claim();
});

function shouldHandleRequest(requestUrl) {
  if (requestUrl.origin !== self.location.origin) return false;

  return [".css", ".js", ".json", ".webmanifest", ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff", ".woff2", ".mp3"].some(
    (ext) => requestUrl.pathname.endsWith(ext)
  );
}

function shouldUseNetworkFirst(requestUrl) {
  return [".css", ".js", ".json", ".webmanifest"].some((ext) =>
    requestUrl.pathname.endsWith(ext)
  );
}

function putInCache(request, response) {
  if (!response || response.status !== 200) return;

  caches.open(STATIC_CACHE_NAME).then((cache) => {
    cache.put(request, response.clone());
  });
}

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  if (!shouldHandleRequest(requestUrl)) return;

  if (shouldUseNetworkFirst(requestUrl)) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          putInCache(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;

      return fetch(event.request)
        .then((networkResponse) => {
          putInCache(event.request, networkResponse);
          return networkResponse;
        })
        .catch(() => cachedResponse);
    })
  );
});
