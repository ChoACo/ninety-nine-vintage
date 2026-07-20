const CACHE_NAME = "ninetynine-public-v1";

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
self.addEventListener("message", (event) => { if (event.data?.type === "CLEAR_PUBLIC_CACHE") event.waitUntil(caches.delete(CACHE_NAME)); });
self.addEventListener("fetch", (event) => {
  if (!isCacheable(event.request)) return;
  const isProductApi = new URL(event.request.url).pathname.startsWith("/api/products");
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    const network = fetch(event.request).then(async (response) => { if (response.ok) await cache.put(event.request, response.clone()); return response; }).catch(() => null);
    if (isProductApi) return (await network) || cached || new Response("{\"products\":[]}", { headers: { "Content-Type": "application/json" } });
    return cached || (await network) || Response.error();
  })());
});

