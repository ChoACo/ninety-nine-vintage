const CACHE_NAME = "ninetynine-public-v3";
const CACHE_PREFIX = "ninetynine-public-";
const CACHE_CONSENT_NAME = "ninetynine-cache-consent-v1";
const CACHE_CONSENT_KEY = "/__cache-consent__";
const MAX_PUBLIC_CACHE_ENTRIES = 160;

async function deletePublicCaches({ includeCurrent = false } = {}) {
  const names = await caches.keys();
  await Promise.all(names
    .filter((name) => name.startsWith(CACHE_PREFIX)
      && (includeCurrent || name !== CACHE_NAME))
    .map((name) => caches.delete(name)));
}

async function trimPublicCache(cache) {
  const keys = await cache.keys();
  const overflow = keys.length - MAX_PUBLIC_CACHE_ENTRIES;
  if (overflow <= 0) return;
  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function cachePublicResponse(cache, request, response) {
  await cache.put(request, response);
  await trimPublicCache(cache);
}

function isCacheable(request) {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (request.destination === "document") return false;
  return url.pathname.startsWith("/_next/static/")
    || url.pathname.startsWith("/_next/image")
    || url.pathname.startsWith("/api/products")
    || request.destination === "image"
    || request.destination === "font";
}

self.addEventListener("install", (event) => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await deletePublicCaches();
    await self.clients.claim();
  })());
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "ENABLE_PUBLIC_CACHE") {
    event.waitUntil((async () => {
      const marker = await caches.open(CACHE_CONSENT_NAME);
      await marker.put(CACHE_CONSENT_KEY, new Response("accepted"));
    })());
  }
  if (event.data?.type === "CLEAR_PUBLIC_CACHE") {
    event.waitUntil((async () => {
      await deletePublicCaches({ includeCurrent: true });
      await caches.delete(CACHE_CONSENT_NAME);
    })());
  }
});
self.addEventListener("fetch", (event) => {
  if (!isCacheable(event.request)) return;
  const isProductApi = new URL(event.request.url).pathname.startsWith("/api/products");
  event.respondWith((async () => {
    const marker = await caches.open(CACHE_CONSENT_NAME);
    const consent = await marker.match(CACHE_CONSENT_KEY);
    if (!consent) return fetch(event.request);
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then(async (response) => {
      if (response.ok) {
        await cachePublicResponse(cache, event.request, response.clone());
      }
      return response;
    }).catch(() => null);
    if (isProductApi) return (await network) || cached || new Response("{\"products\":[]}", { headers: { "Content-Type": "application/json" } });
    return cached || (await network) || Response.error();
  })());
});

self.addEventListener("push", (event) => {
  const payload = (() => {
    try {
      return event.data?.json() || {};
    } catch {
      return { body: event.data?.text() || "" };
    }
  })();
  const title = payload.title || "NINETY-NINE VINTAGE";
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    if (clients.some((client) => client.visibilityState === "visible")) return;
    await self.registration.showNotification(title, {
      body: payload.body || "새로운 소식이 있습니다.",
      icon: "/pwa-icon-192.png",
      badge: "/pwa-icon-192.png",
      tag: payload.tag || "ninety-nine-notification",
      renotify: true,
      data: { url: payload.url || "/m/home" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = new URL(event.notification.data?.url || "/m/home", self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(targetUrl);
        return client.focus();
      }
    }
    return self.clients.openWindow(targetUrl);
  })());
});

