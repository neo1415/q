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

/*
 * Web Push (AUTO, ADR 0029). The payload is small JSON from Capital Q's
 * own server (title, one line, a same-origin path, a tag). Every push shows
 * a notification -- iOS revokes a subscription that receives pushes
 * without one. A tap focuses an open Capital Q window on that path, or
 * opens one. Nothing here is cached, and nothing but a same-origin path is
 * ever opened.
 */

/** A same-origin app path, or the home page. */
function safePath(path) {
  return typeof path === "string" &&
    /^\/(?!\/)[A-Za-z0-9/_-]{0,200}$/.test(path)
    ? path
    : "/home";
}

function readPush(event) {
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === "string") {
      return {
        title: data.title.slice(0, 120),
        body: typeof data.body === "string" ? data.body.slice(0, 240) : "",
        path: safePath(data.path),
        tag: typeof data.tag === "string" ? data.tag.slice(0, 64) : undefined,
      };
    }
  } catch {
    // An unreadable push still shows something rather than nothing.
  }
  return {
    title: "Capital Q",
    body: "Q has an update for you.",
    path: "/home",
  };
}

self.__cq.safePath = safePath;
self.__cq.readPush = readPush;

self.addEventListener("push", (event) => {
  const push = readPush(event);
  event.waitUntil(
    self.registration.showNotification(push.title, {
      body: push.body,
      tag: push.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { path: push.path },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = safePath(
    event.notification.data && event.notification.data.path,
  );
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((windows) => {
        for (const client of windows) {
          if (
            new URL(client.url).origin === self.location.origin &&
            "focus" in client
          ) {
            return client
              .navigate(target)
              .then((navigated) => (navigated || client).focus());
          }
        }
        return self.clients.openWindow(target);
      }),
  );
});
