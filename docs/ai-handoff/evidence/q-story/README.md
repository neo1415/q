# Q Story S1: engine evidence (2026-10-21)

Branch `qstory/engine`, recorded with `scripts/q-pitch/record-story.mjs` in Chromium against a local dev server.

## What was recorded, and on what

- **Surface:** the design harness `/dev/story`.
  - The story host runs over the existing dev review pages: `/dev/discover`, `/dev/crm`, `/dev/profile` and `/dev/gateq-v2`.
  - These are the real page components with their fictional fixtures.
  - No service is read and no model is called.
  - `/dev/*` returns 404 in production.
- **Build:** a production build (`next build` + `next start`, with `CQ_REVIEW_PAGES=1` for `/dev/*`), so there is no dev badge.
- **Brand:** the harness applies the default black-and-gold preset (`PublicBrandStyle`). Q is gold.
- **Narrator:** RENDERED. It plays S5's ElevenLabs render (voice `EXAVITQu4vr4xnSDxMaL`, `eleven_v3_conversational`, forced-alignment word timings, `apps/web/public/story-media/`), decoded before Start. The AudioContext clock is the master clock.
  - Playwright's video has no sound track. S5's `rendered/story-rendered-desktop.mp4` carries the sound.
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

## Results: run 6 (final, 22 Oct 01:10 UTC, `62044b81d`, production build, gold, real audio)

The whole story ran: 56 beats, 6 min 35 s, phase DONE.

**Cue-to-word offset** on the audio clock. Negative means the act landed before its word.

| Acts     | Count |  Median |     p95 |
| -------- | ----: | ------: | ------: |
| all      |   165 |  −93 ms |  −74 ms |
| stage    |   116 |  −89 ms |  −76 ms |
| mood     |     8 |  −93 ms |  −76 ms |
| light    |    21 | −108 ms |  −99 ms |
| navigate |     7 |  +12 ms | +199 ms |

Navigation is the one act that can land after its word. Its ack waits for the route to be visible, and it arrives on the word's first syllables at p95.

**Frames.** 23,267 seen while playing; 12 over 50 ms (0.05%).

**CLS: 0.0008, and 0 from the story.**

- Both shifts are `span.hidden.sm:inline-flex` in the GateQ page's own header, 0.0004 each, on `/dev/story/gateq?view=gate` and `?view=inbox`. That is GateQ's markup, not the story's.
- The story's earlier overlay sources are all gone: the caption box, re-centring stage blocks, the standing label and the presence placement.

**Safe fallbacks: 13.** The harness pages do not render some live markers: the Discover card's "Decide" rail, the sidebar nav selectors, the Q dock, and the relationship brief. The words went on every time. Re-check on the signed-in app.

**Preload: 1.1 s**: 56 decoded audio beats, alignment, 20 pictures and 8 screenshots.

## Earlier runs (for comparison)

| Run | Build            | Narrator     | All cues (median / p95) | Navigate (median / p95) | Long frames | CLS                 |
| --- | ---------------- | ------------ | ----------------------- | ----------------------- | ----------- | ------------------- |
| 1   | dev, blue        | fixture      | −92 / +17 ms            | +316 / +748 ms          | 63 / 26,217 | 0.61                |
| 4   | production, gold | fixture      | −96 / −65 ms            | +28 / +183 ms           | 8 / 26,785  | 0.022               |
| 6   | production, gold | **rendered** | −93 / −74 ms            | +12 / +199 ms           | 12 / 23,267 | 0.0008 (GateQ page) |

## Review frames

`review/07-montage.png`, `review/36-mandate.png`, `review/44-gateq-inbox.png` and `review/49-q-card.png`: production build, gold, desktop 1440×900.
