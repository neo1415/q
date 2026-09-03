/*
 * Capital Q service worker — application-shell asset cache only.
 *
 * Security decides cacheability. This worker intercepts a request only when
 * it is a same-origin GET for an explicitly allow-listed static path:
 * hashed Next.js build assets, the PWA icons, fonts and the manifest.
 * Everything else — every HTML document, every /api route, every Q or
 * signed-media URL, anything cross-origin, anything non-GET — is never
 * touched: the fetch handler returns without calling respondWith, so the
 * browser performs the request exactly as if no service worker existed.
 *
 * There is no precache of pages and no offline data. Capital Q is an online
 * intelligence system; the worker exists so the installed app shell loads
 * fast and updates cleanly.
 *
 * Authentication and session-bearing paths are additionally denied by name.
 * The allow-list already excludes them; the deny-list makes the intent
 * explicit so a future widening of the allow-list cannot quietly start
 * storing a sign-in page, a callback or an API response in Cache Storage.
 */

const VERSION = "cq-shell-v2";
const ALLOWED_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
const ALLOWED_EXACT = ["/manifest.webmanifest", "/icon.svg"];
const DENIED_PREFIXES = ["/auth/", "/api/", "/v1/"];

function isCacheable(request, origin) {
  if (request.method !== "GET") {
    return false;
  }
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.origin !== origin) {
    return false;
  }
  if (DENIED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    return false;
  }
  if (ALLOWED_EXACT.includes(url.pathname)) {
    return true;
  }
  return ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

// Exposed for tests, which load this file and exercise the real policy.
self.__cq = {
  VERSION,
  ALLOWED_PREFIXES,
  ALLOWED_EXACT,
  DENIED_PREFIXES,
  isCacheable,
};

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (!isCacheable(event.request, self.location.origin)) {
    return; // Not ours. The network handles it untouched.
  }
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(event.request);
      if (cached) {
        return cached;
      }
      const response = await fetch(event.request);
      // Only successful, same-origin ("basic") responses are stored.
      if (response.ok && response.type === "basic") {
        await cache.put(event.request, response.clone());
      }
      return response;
    }),
  );
});
