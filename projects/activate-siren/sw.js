const CACHE_NAME = "activate-siren-shell-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/activate-siren.svg",
  "./audio/siren-44k-v2.wav",
  "./audio/high-44k-v2.wav",
  "./audio/pulse-44k-v2.wav",
  "./audio/sos-44k-v2.wav",
  "./audio/siren-ios-v3.m4a",
  "./audio/high-ios-v3.m4a",
  "./audio/pulse-ios-v3.m4a",
  "./audio/sos-ios-v3.m4a",
  "./audio/siren-fallback-v3.mp3",
  "./audio/high-fallback-v3.mp3",
  "./audio/pulse-fallback-v3.mp3",
  "./audio/sos-fallback-v3.mp3"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Safety Sessions, notifications, and official alerts must always be live.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("./index.html", copy));
          }
          return response;
        })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    })
  );
});
