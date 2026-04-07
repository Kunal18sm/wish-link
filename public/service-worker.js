const STATIC_CACHE_NAME = "vishlink-static-v12";
const STATIC_ASSETS = [
  "/design.css?v=20260328c",
  "/homeCollectionLite.css?v=20260328c",
  "/output.css?v=20260328c",
  "/installPrompt.js?v=20260328c",
  "/script.js?v=20260328c",
  "/homeCollection.js?v=20260328c",
  "/dailyReward.js?v=20260328c",
  "/manifest.webmanifest?v=20260328c",
  "/assets/icon-192.png",
  "/assets/icon-512.png",
  "/assets/icons/coin.svg",
  "/assets/icons/check-circle.svg",
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

  // Clone immediately before the response body is consumed by the browser.
  let responseClone = null;
  try {
    responseClone = response.clone();
  } catch (_err) {
    return;
  }

  caches.open(STATIC_CACHE_NAME)
    .then((cache) => cache.put(request, responseClone))
    .catch(() => {
      // Ignore cache write failures.
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

function toPushPayload(event) {
  if (!event?.data) {
    return {
      title: "VishLink Admin",
      body: "New update available.",
      url: "/requests/dashboard#adminNotifications",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: "vishlink-admin",
    };
  }

  try {
    const data = event.data.json();
    const title = String(data?.title || "VishLink Admin").trim().slice(0, 100) || "VishLink Admin";
    const body = String(data?.body || "New update available.").trim().slice(0, 220) || "New update available.";
    const url = String(data?.url || data?.link || "/requests/dashboard#adminNotifications").trim();
    const icon = String(data?.icon || "/assets/icon-192.png").trim() || "/assets/icon-192.png";
    const badge = String(data?.badge || "/assets/icon-192.png").trim() || "/assets/icon-192.png";
    const tag = String(data?.tag || "vishlink-admin").trim().slice(0, 100);

    return {
      title,
      body,
      url: url.startsWith("/") ? url : "/requests/dashboard#adminNotifications",
      icon,
      badge,
      tag,
    };
  } catch (_err) {
    const text = String(event.data.text() || "").trim();
    return {
      title: "VishLink Admin",
      body: text || "New update available.",
      url: "/requests/dashboard#adminNotifications",
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      tag: "vishlink-admin",
    };
  }
}

self.addEventListener("push", (event) => {
  const payload = toPushPayload(event);
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: payload.icon,
      badge: payload.badge,
      tag: payload.tag,
      renotify: true,
      data: {
        url: payload.url,
      },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = String(event.notification?.data?.url || "/requests/dashboard#adminNotifications");

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if (!client || !client.url) continue;
        const clientUrl = new URL(client.url);
        if (clientUrl.origin === self.location.origin) {
          if (typeof client.navigate === "function") {
            try {
              await client.navigate(targetUrl);
            } catch (_err) {
              // Ignore navigation failure and try focus.
            }
          }
          return client.focus();
        }
      }

      return clients.openWindow(targetUrl);
    })
  );
});
