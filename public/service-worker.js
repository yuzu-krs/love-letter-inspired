const CACHE_NAME = "secret-letter-table-v6";
const CORE_ASSETS = [
  "/",
  "/styles.css",
  "/client.js",
  "/manifest.webmanifest",
  "/assets/card-back.svg",
  "/assets/favicon.svg",
  "/assets/ogp.svg",
  "/assets/ogp.png",
  "/assets/table-pattern.svg",
  "/assets/cards/01-scout.png",
  "/assets/cards/02-seer.png",
  "/assets/cards/03-duel.png",
  "/assets/cards/04-veil.png",
  "/assets/cards/05-patron.png",
  "/assets/cards/06-envoy.png",
  "/assets/cards/07-archivist.png",
  "/assets/cards/08-sealed-letter.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/socket.io/")
  ) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/")));
    return;
  }

  if (["script", "style", "manifest"].includes(event.request.destination)) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const networkResponse = fetch(event.request)
        .then((response) => {
          if (response.ok && event.request.method === "GET") {
            const responseClone = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, responseClone));
          }
          return response;
        })
        .catch(() => cachedResponse);

      return cachedResponse || networkResponse;
    }),
  );
});

function networkFirst(request) {
  return fetch(request)
    .then((response) => {
      if (response.ok && request.method === "GET") {
        const responseClone = response.clone();
        caches
          .open(CACHE_NAME)
          .then((cache) => cache.put(request, responseClone));
      }
      return response;
    })
    .catch(() => caches.match(request));
}
