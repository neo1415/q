# Q Story S5: rendered narration evidence (2026-10-21/22)

Branch `qstory/render` (from `qstory/engine` @ 73e58df1). The audio is at `apps/web/public/story-media/EXAVITQu4vr4xnSDxMaL/`: 56 × `beat-NN.mp3` + `beat-NN.json`, plus `index.json` with `complete: true`.

## Render

- **Voice:** Sarah `EXAVITQu4vr4xnSDxMaL`, Q's existing FEMALE voice (`apps/q-api/src/voice/providers/elevenlabs-speak.ts`).
  - The environment's `ELEVENLABS_SPEECH_ENGINE_ID` is a Speech Engine id (`seng_…`), not a voice.
  - It isn't visible to this API key's workspace: `GET /v1/speech-engine/{id}` returns 404, and the engine list is empty. So it couldn't supply a voice.
- **Model:** `eleven_v3_conversational`. It honours v3 audio tags and accepts `/with-timestamps`.
- **Format:** `mp3_44100_96`, mono, 96 kbps. 4.8 MB for 6 min 24 s.
- **Timings come from ElevenLabs forced alignment** of each rendered mp3 against the beat's verbatim words, not from v3's own timestamps. v3's `/with-timestamps` alignment drifted against speech-to-text by up to 1.06 s around tags and pauses:
  - beat 31 "Weak": 1.06 s early;
  - beat 25 "Hope": 0.55 s;
  - beat 17 "Go": placed before the chuckle.

  Forced alignment matched STT within about 0.05 s on those beats. `wordsFromCharacters` still refuses any timing that doesn't spell the script.

- **Beat 26 silence:** v3's `[long pause]` produced 2.86 s. `--max-gap beat-26:1200` cut the middle of the silence, and the beat was then re-aligned. The word-to-word gap is now 1.18 s; 0.95 s of it is below −40 dB, then the whisper's breath.

## Cost (characters are ElevenLabs credits; $ at the $0.30/1k estimate)

| Run                                                   | Characters |      ≈ $ |
| ----------------------------------------------------- | ---------: | -------: |
| 3 sample beats (3, 26, 56)                            |        222 |     0.07 |
| Remaining 53 beats                                    |      5,136 |     1.54 |
| Two retakes of 35 and 56 (old tags; no audible laugh) |        578 |     0.17 |
| Final 35 and 56 after S1's tag change (73e58df1)      |        284 |     0.09 |
| **TTS total**                                         |  **6,220** | **1.87** |

Speech-to-text (`scribe_v1`, about 7 min of audio) plus forced alignment cost a few cents. The total is under the $3 cap.

## Quality pass (by measurement)

- **Verbatim:**
  - every beat's forced alignment spells the script (`wordsFromCharacters`);
  - STT on all 56 beats returned the script's words;
  - no audio-tag text was spoken in any beat.
- **Pace:**
  - 384.3 s rendered against 438.0 s planned (0.88), or 124 wpm. The plan's band is 125–135.
  - Per-beat ratios are in `measurements.json`.
  - The staccato lists run long by design: beat 6 is 1.42, beat 27 is 1.25.
- **Tags, measured in the gap where each tag sits:**
  - `[sighs]` in beat 9: 740 ms at −34 dB; STT tags it as a sigh.
  - `[chuckles]` in beat 17: 800 ms at −25.6 dB.
  - `[laughs]` at the end of beat 56: about 0.9 s at −21 dB; STT tags it `[laughs]`.
  - Beat 35's `[chuckles]`: 1.22 s at −37.7 dB. It's soft, and STT didn't tag it.
  - With the old placement (35 `[laughs softly]`, 56 `[laughs]` before "WITHOUT"), three takes each produced no audible laugh. That's why S1 moved the tags.

## Browser run

- **Recording:** `story-rendered-desktop.mp4`, 1280×800, 6 min 39 s, H.264 + AAC mono. Recorded from `/dev/story` in Chromium with the rendered narrator (`narrator: RENDERED`).
- **Audio mux:** Playwright records video without sound, so a hook on `AudioBufferSourceNode.start` logged each beat's start time.
  - All 56 beats started in order, with buffer lengths matching their files.
  - Each beat's mp3 was mixed in at its logged offset.
  - Expect up to about 50 ms of error between the page clock and the first video frame.
- **Cue-to-word offsets on the real audio:** median −84 ms, p95 111 ms (n = 164). By kind:
  - stage: median −82 ms;
  - navigate: median 751 ms (route changes);
  - light: p95 597 ms.
- **Other:** 12 safe fallbacks; preload 3.1 s. Q is gold: the harness applies the black-gold preset (`frame-beat26-silence.png`).
- **Frames:** `frame-beat08-captions.png` shows word-by-word captions on the real audio. Nit for S1: the "Photos: Pexels contributors" credit overlaps the caption band.
