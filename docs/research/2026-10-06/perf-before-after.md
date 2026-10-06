# P9 web performance: before / after (2026-10-06)

Branch `build/perf` (from `recovery/2026-09-12-8y2j4w` at `b76d43d7`).

## Method

- `next build && next start` locally, run against the production API and Q API (reads only), signed in as the fictional seeded founder `adedaniel502+cq-tobenna-ledgerline@gmail.com` (Ledgerline). No `next dev`.
- Playwright Chromium 141 with a phone viewport (390x844, DPR 2, touch) and 4x CPU throttle. Network conditions set through CDP `Network.emulateNetworkConditions`:
  - **Slow 4G:** 200 ms RTT, 1.6 Mbps down, 750 kbps up, 1% packet loss.
  - **Fast 3G:** 400 ms RTT, 1.44 Mbps down, 675 kbps up, 5% packet loss.
- Each page loaded twice per profile in a fresh context (a cold entry, so the splash plays as it would for a new session). Each cell shows the slower of the two runs, as a stand-in for p75. A warm-up load runs first.
- **Baseline:** `b76d43d7` rebuilt and measured with the same script and metrics. **After:** HEAD of `build/perf`.
- **Metric definitions:**
  - _Content visible_ is the later of two moments: the splash no longer covering the page, and `main` holding real text with no busy indicator. It is what a person actually sees.
  - _INP (tap after load)_ is a tap 2 s after network idle.
  - _Tap during load_ is a tap at the `load` event, while the page is still hydrating.
  - _TBT_ is the sum of long-task time over 50 ms.
- Scripts are in the session scratchpad (`perf/measure.mjs`, `bundles.mjs`, `attrib.mjs`). They are not committed.

## Slow 4G (200 ms, 1.6 Mbps, 1% loss)

| Page           | TTFB            | FCP             | LCP             | Content visible | CLS           | INP (tap after load) | Tap during load | TBT             | JS transferred  |
| -------------- | --------------- | --------------- | --------------- | --------------- | ------------- | -------------------- | --------------- | --------------- | --------------- |
| /home          | 1.09 s → 1.14 s | 1.88 s → 1.90 s | 2.38 s → 2.22 s | 8.11 s → 3.63 s | 0.000 → 0.000 | 0.08 s → 0.05 s      | 1.20 s → 0.79 s | 2.97 s → 1.39 s | 694 KB → 530 KB |
| /discover      | 0.97 s → 0.73 s | 2.23 s → 1.53 s | 2.39 s → 1.53 s | 8.20 s → 3.16 s | 0.000 → 0.000 | 0.08 s → 0.04 s      | 1.25 s → 0.54 s | 3.46 s → 0.95 s | 712 KB → 522 KB |
| /explore       | 0.96 s → 0.83 s | 1.98 s → 1.71 s | 2.27 s → 3.28 s | 8.14 s → 3.40 s | 0.000 → 0.000 | 0.12 s → 0.04 s      | 1.30 s → 0.53 s | 3.00 s → 0.96 s | 698 KB → 508 KB |
| /company/:id   | 1.06 s → 0.84 s | 2.04 s → 1.70 s | 2.36 s → 1.70 s | 8.44 s → 3.25 s | 0.000 → 0.000 | 0.07 s → 0.04 s      | 1.12 s → 0.60 s | 2.98 s → 1.06 s | 715 KB → 525 KB |
| /relationships | 0.95 s → 0.80 s | 2.03 s → 1.66 s | 2.03 s → 1.66 s | 7.78 s → 3.25 s | 0.000 → 0.000 | 0.07 s → 0.03 s      | 0.80 s → 0.42 s | 2.67 s → 0.84 s | 687 KB → 497 KB |
| /work          | 0.88 s → 0.75 s | 2.00 s → 1.66 s | 2.27 s → 1.66 s | 7.66 s → 3.24 s | 0.000 → 0.000 | 0.08 s → 0.06 s      | 0.95 s → 0.43 s | 2.64 s → 0.90 s | 705 KB → 516 KB |
| /capital       | 0.85 s → 0.75 s | 1.79 s → 1.55 s | 2.25 s → 1.55 s | 7.60 s → 3.17 s | 0.000 → 0.000 | 0.09 s → 0.03 s      | 1.38 s → 0.54 s | 3.20 s → 0.92 s | 687 KB → 496 KB |
| /gateq         | 1.10 s → 0.77 s | 1.86 s → 1.54 s | 2.40 s → 1.54 s | 7.12 s → 3.21 s | 0.000 → 0.000 | 0.05 s → 0.03 s      | 1.48 s → 0.49 s | 3.21 s → 0.85 s | 702 KB → 512 KB |
| /settings      | 0.78 s → 0.65 s | 2.02 s → 1.46 s | 2.02 s → 1.46 s | 7.51 s → 3.09 s | 0.000 → 0.000 | 0.07 s → 0.05 s      | 1.03 s → 0.52 s | 2.71 s → 0.96 s | 688 KB → 498 KB |

## Fast 3G (400 ms, 1.44 Mbps, 5% loss)

| Page           | TTFB            | FCP             | LCP             | Content visible | CLS           | INP (tap after load) | Tap during load | TBT             | JS transferred  |
| -------------- | --------------- | --------------- | --------------- | --------------- | ------------- | -------------------- | --------------- | --------------- | --------------- |
| /home          | 0.86 s → 0.92 s | 1.91 s → 1.84 s | 2.21 s → 2.02 s | 8.69 s → 3.48 s | 0.000 → 0.000 | 0.08 s → 0.04 s      | 1.22 s → 0.63 s | 2.95 s → 1.03 s | 694 KB → 530 KB |
| /discover      | 0.83 s → 1.10 s | 2.00 s → 2.04 s | 2.46 s → 2.38 s | 8.51 s → 3.78 s | 0.063 → 0.000 | 0.04 s → 0.06 s      | 1.02 s → 0.50 s | 2.35 s → 0.95 s | 712 KB → 522 KB |
| /explore       | 0.78 s → 0.76 s | 1.79 s → 1.83 s | 2.22 s → 3.18 s | 8.59 s → 3.43 s | 0.000 → 0.000 | 0.08 s → 0.03 s      | 1.12 s → 0.54 s | 2.73 s → 0.94 s | 698 KB → 508 KB |
| /company/:id   | 0.83 s → 0.81 s | 2.01 s → 1.82 s | 2.28 s → 2.03 s | 8.65 s → 3.43 s | 0.000 → 0.000 | 0.06 s → 0.03 s      | 1.16 s → 1.05 s | 2.67 s → 1.15 s | 715 KB → 525 KB |
| /relationships | 0.94 s → 0.89 s | 1.94 s → 1.82 s | 2.47 s → 2.21 s | 8.45 s → 3.50 s | 0.000 → 0.000 | 0.07 s → 0.03 s      | 1.06 s → 0.54 s | 2.68 s → 0.97 s | 687 KB → 497 KB |
| /work          | 0.90 s → 0.73 s | 1.95 s → 1.64 s | 2.38 s → 1.64 s | 8.55 s → 3.29 s | 0.000 → 0.000 | 0.06 s → 0.05 s      | 0.69 s → 0.42 s | 2.15 s → 1.02 s | 705 KB → 516 KB |
| /capital       | 0.74 s → 0.75 s | 1.66 s → 1.71 s | 2.06 s → 2.02 s | 7.30 s → 3.31 s | 0.000 → 0.000 | 0.03 s → 0.03 s      | 0.48 s → 0.39 s | 1.16 s → 0.87 s | 687 KB → 496 KB |
| /gateq         | 0.76 s → 0.75 s | 1.73 s → 1.72 s | 2.01 s → 2.04 s | 7.59 s → 3.46 s | 0.000 → 0.000 | 0.03 s → 0.03 s      | 0.60 s → 0.51 s | 1.28 s → 0.94 s | 702 KB → 512 KB |
| /settings      | 0.83 s → 0.71 s | 1.75 s → 1.63 s | 2.13 s → 2.01 s | 7.46 s → 3.37 s | 0.000 → 0.000 | 0.05 s → 0.03 s      | 0.50 s → 1.07 s | 1.20 s → 1.18 s | 688 KB → 498 KB |

## Initial client JS per route (build output, entry chunks)

| Route          | Before raw / gzip | After raw / gzip |
| -------------- | ----------------- | ---------------- |
| /home          | 1889 / 548 KB     | 1254 / 383 KB    |
| /discover      | 1931 / 561 KB     | 1219 / 372 KB    |
| /explore       | 1886 / 547 KB     | 1174 / 358 KB    |
| /company/[id]  | 1952 / 563 KB     | 1240 / 374 KB    |
| /relationships | 1854 / 537 KB     | 1141 / 348 KB    |
| /work          | 1919 / 555 KB     | 1208 / 366 KB    |
| /capital       | 1855 / 537 KB     | 1142 / 347 KB    |
| /gateq         | 1902 / 552 KB     | 1189 / 362 KB    |
| /settings      | 1857 / 538 KB     | 1143 / 348 KB    |

## What the baseline showed

1. **The splash held every cold entry for 7 to 8.7 s.** The splash only started once the root layout had hydrated, then played its full formation. On a slow line that meant the hydration time plus the animation, over a page that had painted at about 2 s.
2. **Every page shipped 1.85 to 1.95 MB of JS.** The largest shell chunk, 664 KB raw, was the ElevenLabs/LiveKit and Deepgram voice SDKs, loaded on every page whether or not a call ever started. The Q side panel's conversation UI and the document viewer were also loaded eagerly.
3. **A tap during hydration took 0.5 to 1.5 s to respond, and TBT was 2.2 to 3.5 s.**
4. **Explore:** the grid showed a skeleton until hydration, because the column count was only read in the browser. After that, each poster was its own server action. Next runs server actions one at a time, so the grid made roughly 36 queued round trips. Main content arrived at about 6.3 to 7.3 s.
   - **A bug:** when the tiles changed, poster grants still in flight were dropped and never asked for again, which left boxes empty for good.
   - The sector words and the first slate were also read one after the other on the server.
5. **Shell polling competed with the page.** The notification bell and the document watch both fired a request at mount, ahead of the page's own reads in the action queue.
6. **The global loading state was a centred spinner on an empty page.**

## Fixes (commits on `build/perf`)

- **Bundle splitting:**
  - The voice SDKs now load inside `start()` of `elevenlabs-session.ts` and `deepgram-session.ts`.
  - The Q sheet conversation is behind `next/dynamic`. It is preloaded on intent (pointer or focus on the trigger) or on idle 4 s after load, and never under Save-Data.
  - `ArtifactViewer` is behind `next/dynamic` in the document-ready centre.
- **Splash:**
  - The deadline now counts from page start (`SPLASH_DEADLINE_MS`). If the code arrives late, the overlay skips the animation.
  - A CSS fallback fades the splash about 1.6 s after its first paint if JS has not taken over.
  - A tap or key skips it before hydration, through the boot script.
  - Tests are in `test/splash.test.tsx`.
- **Explore:**
  - Server reads run in parallel.
  - The first screen's posters (10 tiles, 1.2 s budget) are authorised with the page.
  - `authorisePostersAction` handles up to 24 tiles in one action. Each tile is still authorised per viewer, and refused tiles are simply absent.
  - Before hydration the grid is laid out for every breakpoint through CSS custom properties, so there is no skeleton and no shift.
  - The first-row posters use `fetchPriority="high"`.
  - The dropped-grant bug is fixed.
  - Network-video posters on Discover are batched the same way.
- **Resilient reads** (`src/pwa/resilient.ts`, `use-resilient-read.ts`, tests in `test/resilient-read.test.tsx`):
  - `withTimeout`.
  - `retryWithBackoff`: full-jitter exponential backoff. It waits for `online` while offline, never retries an answer, and is abortable.
  - `useResilientRead`: stale-while-revalidate that ends in `failed` with a retry, never an infinite loading state.
  - These are applied to Explore's page and load-more reads (a network failure now ends in the error state with Retry, not an endless skeleton), poster batches, and the notification bell.
- **Shell polling:**
  - The bell's first read and the document watch's first check now wait for the page to settle.
  - Both skip while offline and refresh on `online`.
- **Navigation:**
  - `IntentLink` is used for the sidebar, bottom tabs and More sheet. In view it does a partial prefetch (the loading shell); on hover, focus or touchstart it does a full prefetch, skipped under Save-Data.
  - `experimental.staleTimes.static` is set to 30 s, so a hover-prefetched page is never shown stale for more than 30 s.
- **Loading states:**
  - The `(app)` loading boundary is now the page frame with Q's swarm beside the heading.
  - Explore has its own frame.
- **Caching:** `/icons/*` is served with `max-age=86400, stale-while-revalidate`. `_next/static` was already immutable.

## Known limits and next steps

- **Explore LCP went up from 2.3 s to 3.3 s.** This is not a regression: before, the posters arrived after about 7 s, so LCP fell on text. Now a poster is the LCP element and arrives about 4 s earlier. Sizing poster URLs per tile (CDN width parameter) is the next win.
- **zod is still in every page's first download** (about 340 KB raw, 30% of what is left). Eleven Q-session modules import contract schemas at runtime. Moving them to lazy schema loading or `zod/mini` is a separate packet.
- **TTFB (0.7 to 1.1 s) is bound by the shell's API reads**, already parallel since L1. Further gains need API-side work or caching of `/v1/me`-style reads.
- **"Tap during load" on /settings and /company under Fast 3G is noisy** with two runs: the tap lands at a different hydration point in each run. TBT is the steadier signal.
- **Production was not redeployed.** These are local production-build numbers against the production API.
