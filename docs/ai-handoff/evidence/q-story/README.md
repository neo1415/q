# Q Story S1: engine evidence (2026-10-21)

Branch `qstory/engine`, recorded with `scripts/q-pitch/record-story.mjs` in Chromium against a local dev server.

## What was recorded, and on what

- **Surface:** the design harness `/dev/story`.
  - The story host runs over the existing dev review pages: `/dev/discover`, `/dev/crm`, `/dev/profile` and `/dev/gateq-v2`.
  - These are the real page components with their fictional fixtures.
  - No service is read and no model is called.
  - `/dev/*` returns 404 in production.
- **Narrator:** silent (fixture timings).
  - No ElevenLabs key was in this environment, so no render exists yet.
  - Cues follow the same master-clock contract a render uses. The offsets below are measured against that clock.
  - Once `render-story.mjs` has run with a key, re-record to measure against the real audio.
- **Not recorded here:** the signed-in production app (`/home?qpitch=story`).
  - Run the same script with `--path "/home?qpitch=story&new=1" --state <storage-state.json>` against a deployed build.

## Files

- `story-desktop.mp4`: the full story, desktop 1280×800, light (H.264, re-encoded from Playwright's WebM).
- `frames/`: 12 key frames, desktop 1440×900 and phone 390×844, light and dark.
  - Frames are reached with the Next control, so each one shows its beat's cues landing.
- `metrics.json`:
  - cue-to-word offsets (`offsets`, `offsetsByKind`): ack time on the narrator's clock minus the word's start, where negative means the act landed before its word;
  - frames seen and frames over 50 ms (`frames.long`);
  - CLS with every layout shift's page;
  - safe fallbacks;
  - preload time.

## Results (run 1, 20:31 UTC, `d9868fa2` + harness)

The whole story ran: 56 beats, 7 min 33 s wall time, phase DONE.

**Cue-to-word offset.** Negative means the act landed before its word.

| Acts     | Count |      Median |         p95 |
| -------- | ----: | ----------: | ----------: |
| all      |   150 |      -92 ms |      +17 ms |
| stage    |   120 |      -92 ms |      -76 ms |
| mood     |     8 |      -93 ms |      -69 ms |
| light    |    14 |     -107 ms |      -96 ms |
| navigate |     7 | **+316 ms** | **+748 ms** |

**Navigation lands late on the dev server.** It runs unoptimised and compiles on demand, even after a warm-up; production builds prefetch. Re-measure on a production build.

**Frames.** 26,217 seen while playing; 63 over 50 ms (0.24%).

**Safe fallbacks: 14.**

- The harness pages do not render every live marker: the Discover card and its "Decide" rail, the sidebar nav selectors, the Q dock, and the relationship brief in `crm?view=record`.
- Discover's dev page also opened after the navigation budget once.
- The words went on every time, as designed.

**CLS: 0.61. Not 0. Open.**

| Source                                                     |   CLS | Cause                                                                                                                                                     |
| ---------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dev/story/gateq?view=inbox`                              | 0.386 | The dev page's own load                                                                                                                                   |
| `/dev/story`                                               | 0.134 | Story overlay: captions grow upward from a bottom anchor; centred stage blocks re-centre when a label appears; the mismatch chips switch layout at step 5 |
| `gateq?view=gate`, `profile?tab=diligence`, `inbox-detail` |  0.09 | Page loads                                                                                                                                                |

Fixes for the overlay causes are in progress. The recorder now attributes each shift to its element.

**Preload: 447 ms.** Harness, no audio render: pictures and screenshots only.
