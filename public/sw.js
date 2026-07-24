const CACHE_NAME = "ninetynine-public-v2";
const CACHE_CONSENT_NAME = "ninetynine-cache-consent-v1";
const CACHE_CONSENT_KEY = "/__cache-consent__";

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
self.addEventListener("activate", (event) => { event.waitUntil(self.clients.claim()); });
self.addEventListener("message", (event) => {
  if (event.data?.type === "ENABLE_PUBLIC_CACHE") {
    event.waitUntil((async () => {
      const marker = await caches.open(CACHE_CONSENT_NAME);
      await marker.put(CACHE_CONSENT_KEY, new Response("accepted"));
    })());
  }
  if (event.data?.type === "CLEAR_PUBLIC_CACHE") {
    event.waitUntil(Promise.all([
      caches.delete(CACHE_NAME),
      caches.delete(CACHE_CONSENT_NAME),
    ]));
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
    const network = fetch(event.request).then(async (response) => { if (response.ok) await cache.put(event.request, response.clone()); return response; }).catch(() => null);
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
  event.waitUntil(self.registration.showNotification(title, {
    body: payload.body || "새로운 소식이 있습니다.",
    icon: "/pwa-icon-192.png",
    badge: "/pwa-icon-192.png",
    tag: payload.tag || "ninety-nine-notification",
    renotify: true,
    data: { url: payload.url || "/m/home" },
  }));
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

