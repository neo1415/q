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

- `story-desktop.webm`: the full story, desktop 1280×800, light.
- `frames/`: 12 key frames, desktop 1440×900 and phone 390×844, light and dark.
  - Frames are reached with the Next control, so each one shows its beat's cues landing.
- `metrics.json`:
  - cue-to-word offsets (`offsets`, `offsetsByKind`): ack time on the narrator's clock minus the word's start, where negative means the act landed before its word;
  - frames seen and frames over 50 ms (`frames.long`);
  - CLS with every layout shift's page;
  - safe fallbacks;
  - preload time.

## Results

Filled in from `metrics.json` after the run (see the HANDOFF-LOG entry for the numbers).
