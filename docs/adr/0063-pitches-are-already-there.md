# ADR 0063: Pitches are already there (preload window, device cache, one stage, sound on)

Status: Accepted (founder direction 2026-10-08, repeated: "the next video or next two must always be ready", "a FIFO cache with a high budget", "Explore ... should be exactly the Discover player", "Discover sound must be on every time").
Amends: doc 20 §50 (preload window), §51 (warm buffer), §158 (service worker / PWA may not cache private signed video), §159 (offline video is not V1); CLAUDE.md "Feed and media" (one preload controller, unchanged; the window it allows widens). Extends ADR 0026 (sound on).

## Context

Measured against production on 2026-10-08 (Google Chrome, signed in as an investor, watch only):

- Every pitch started at the lowest rendition (240x426) and the player said "Slow connection · lower quality" for its first 5-8 seconds, on any link. The banner was a resolution check (short side < 360), not a measurement. The low start was the player's, not the link's: Chrome now plays HLS natively, so the app's engine was bypassed and Chrome's own player began at the lowest rung; where hls.js did run, its defaults (`testBandwidth`, a 500 kbit/s starting guess) did the same.
- The next card buffered only 4 seconds of 240p; the card after it was a poster, so two quick swipes landed on a cold pitch (about 1.9 s to first frame).
- Waiting for a first frame counted as a "stall", and two stalls in 30 s narrowed the preload window to nothing ahead: the slow start of one card left the next one cold too.
- The loop was not from memory: the seek back to exactly 0 fell in a gap before the first buffered frame, the engine fetched the first fragment again at a different rendition, the decoder raised `DEMUXER_ERROR_COULD_NOT_PARSE`, and the player asked for a new grant and reloaded the pitch (about 2.3 s, behind the same banner).
- Segments are `Cache-Control: public, max-age=864000`, but every grant carries its token in the URL path, so the browser's cache misses whenever a grant changes.
- Explore's viewer was a separate player screen and started muted by a hard-coded default; Discover's sound came back only on pointerdown or keydown, never after a swipe.

## Decision

1. **The window.** The card in view plays; the next two buffer (about 10 s each); the one behind keeps its player and buffer; the one after the next two is a poster. Four recycled players, not three. The server authorises the whole first window (four cards) when it renders Discover. Waiting for a first frame is not a stall; only a stall after playback started counts toward the constrained window (Save-Data, 2g/3g, or a link that really keeps stalling).
2. **The engine plays HLS wherever MSE exists**, even where the browser also plays HLS natively; only a browser without MSE (the iPhone) uses its own player. **The first rendition** is the smallest whose long side covers the screen, among those the link's own estimate can carry (5 Mbit/s where the browser does not say), never a test download of the lowest one; ABR still moves down when real segments arrive too slowly. The "Slow connection" banner is removed; a stall over 400 ms shows the quiet ring, and nothing blames the network. A `play()` aborted by the engine attaching is retried once the element can play.
3. **Warm-up.** For an investor, on idle on any app page except Discover, once per session and never on Save-Data or 2g/3g: the first three cards' grants, then each stream's init segments and first two fragments of the rendition the player will start on (and the one below), plus audio, into the device cache.
4. **The device cache.** A pitch's HLS segments are kept in Cache Storage (`cq-media-v1`), keyed by the media asset id and the path after the token, never by the token. Least recently used is evicted first within a budget of 40% of the origin's quota, at most 1 GiB. Playlists are always fetched from the network; the stored copy only answers when the network cannot (doc 20 §29's concern that manifests change still holds online). The cache is read only by a player that holds a grant the server issued for that asset; it creates no URL and no access. Sign-out deletes it. The cache sits in front of hls.js's loader in the page, not in the service worker: it works from the first visit and needs no worker lifecycle. The iPhone's native HLS keeps the browser's own cache.
5. **The loop** is the engine's, from the first buffered frame, with the played part kept (`backBufferLength: Infinity`) and the playing card buffering the whole pitch. A decoder error on a pitch that already played is recovered in place before any new grant.
6. **One stage.** `PitchStage` (media slots, gestures, keys, progress bar, speed, captions, options) is Discover's For You and Explore's opened pitch; the card over it is the same `FeedCard`.
7. **Sound** is on by default in both, every session; only an explicit mute is remembered, for the browser session. Where the browser refuses audible autoplay the pitch plays muted with "Tap for sound", and the first interaction that grants user activation turns the sound on. Reduced motion is unchanged: no automatic playback, audio off until enabled.

## Consequences

- More media is delivered: Cloudflare bills preloaded segments as delivered minutes (doc 20 §43). Two buffered cards of ~10 s each, plus the whole of the playing pitch, is the cost of "always ready"; the cache repays part of it on every loop and revisit.
- Pitches a viewer watched stay on that device until evicted or sign-out. They were already in the browser's HTTP cache (`public, max-age=864000`); this only makes them findable under a new grant.
- Offline: a pitch already cached plays while the page is open and its grant is held. A cold start offline still shows the offline page; caching the app shell for offline Discover is not part of this decision.
