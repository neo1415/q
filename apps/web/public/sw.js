/*
 * Capital Q service worker — application-shell asset cache only.
 *
 * Security decides cacheability. This worker stores a response only when
 * the request is a same-origin GET for an explicitly allow-listed static
 * path: hashed Next.js build assets, the PWA icons, fonts, the manifest and
 * the offline page. Everything else — every HTML document, every /api or
 * /v1 route, every Q, pitch or signed-media URL, anything cross-origin,
 * anything non-GET, any ranged (media) request — is never stored.
 *
 * Navigations are the one other thing it looks at, and only to answer a
 * failed one with the static offline page. A navigation is passed to the
 * network untouched and its response is never stored; authentication and
 * API navigations are not even passed through (the browser handles them as
 * if no worker existed).
 *
 * Updates: HTML is always fetched from the network, so a reload always
 * gets the current build. A new worker installs, takes over at once and
 * drops the old shell cache; it never reloads an open page (that would cut
 * a pitch or a voice session off mid-sentence).
 *
 * Authentication and session-bearing paths are denied by name before the
 * allow-list is consulted, so a future widening of the allow-list cannot
 * quietly start storing a sign-in page, a callback or an API response.
 */

/* global Request, Response */

const VERSION = "cq-shell-v3";
const OFFLINE_URL = "/offline.html";
const ALLOWED_PREFIXES = ["/_next/static/", "/icons/", "/fonts/"];
const ALLOWED_EXACT = ["/manifest.webmanifest", "/icon.svg", OFFLINE_URL];
const DENIED_PREFIXES = ["/auth/", "/api/", "/v1/"];
// Media is never the shell's, whatever its path: a pitch is authorised per
// viewer and per request, and its bytes stay between the browser and the CDN.
const MEDIA_EXTENSIONS = /\.(?:m3u8|mpd|m4s|mp4|m4a|webm|mov|ts|vtt|aac|mp3)$/i;
const MEDIA_DESTINATIONS = ["video", "audio", "track"];

function sameOriginUrl(request, origin) {
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  return url.origin === origin ? url : null;
}

function isDenied(url) {
  return DENIED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

function isMedia(request, url) {
  if (MEDIA_DESTINATIONS.includes(request.destination)) return true;
  if (request.headers && request.headers.has && request.headers.has("range")) {
    return true;
  }
  return MEDIA_EXTENSIONS.test(url.pathname);
}

function isCacheable(request, origin) {
  if (request.method !== "GET") {
    return false;
  }
  const url = sameOriginUrl(request, origin);
  if (url === null) {
    return false;
  }
  if (isDenied(url) || isMedia(request, url)) {
    return false;
  }
  if (ALLOWED_EXACT.includes(url.pathname)) {
    return true;
  }
  return ALLOWED_PREFIXES.some((prefix) => url.pathname.startsWith(prefix));
}

/** A page navigation this worker may answer with the offline page if it fails. */
function isOfflineFallbackCandidate(request, origin) {
  if (request.method !== "GET" || request.mode !== "navigate") {
    return false;
  }
  const url = sameOriginUrl(request, origin);
  return url !== null && !isDenied(url);
}

// Exposed for tests, which load this file and exercise the real policy.
self.__cq = {
  VERSION,
  OFFLINE_URL,
  ALLOWED_PREFIXES,
  ALLOWED_EXACT,
  DENIED_PREFIXES,
  isCacheable,
  isOfflineFallbackCandidate,
};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
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
  const request = event.request;
  const origin = self.location.origin;

  if (isOfflineFallbackCandidate(request, origin)) {
    // Network only. The response is handed straight back and never stored.
    event.respondWith(
      fetch(request).catch(() =>
        caches
          .match(OFFLINE_URL)
          .then((offline) => offline || Response.error()),
      ),
    );
    return;
  }

  if (!isCacheable(request, origin)) {
    return; // Not ours. The network handles it untouched.
  }
  event.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) {
        return cached;
      }
      const response = await fetch(request);
      // Only successful, same-origin ("basic") responses are stored.
      if (response.ok && response.type === "basic") {
        await cache.put(request, response.clone());
      }
      return response;
    }),
  );
});
