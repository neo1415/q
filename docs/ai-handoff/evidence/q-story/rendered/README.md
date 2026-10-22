# Q Story S5: rendered narration evidence (2026-10-22)

Branch `qstory/render` (from `qstory/engine` @ 73e58df1). The audio is at `apps/web/public/story-media/EXAVITQu4vr4xnSDxMaL/`: 56 × `beat-NN.mp3` + `beat-NN.json`, plus `index.json` with `complete: true`.

## Render

- **Model:** `eleven_v4_turbo`, the owner's choice on 2026-10-22.
  - The repo had never measured whether v4 turbo honours audio tags (`apps/q-api/src/voice/providers/speech-markup.ts`), so this render measured it on the story (see the quality pass below).
  - It performs the tags: STT hears the sighs, chuckle and laughs, and no tag is read aloud.
  - Its credit rate is half of v3's (`character_cost_multiplier` 0.5).
- **Superseded take:** an earlier full take on `eleven_v3_conversational` was replaced. v4 turbo performed the reactions audibly where v3 was faint or absent, and it held the planned silence without a large cut.
- **Voice:** Sarah `EXAVITQu4vr4xnSDxMaL`, Q's existing FEMALE voice (`apps/q-api/src/voice/providers/elevenlabs-speak.ts`).
  - The environment's `ELEVENLABS_SPEECH_ENGINE_ID` is a Speech Engine id (`seng_…`), not a voice.
  - It isn't visible to this API key's workspace (`GET /v1/speech-engine/{id}` returns 404).
- **Format:** `mp3_44100_96`, mono, 96 kbps.
- **Timings come from ElevenLabs forced alignment** of each rendered mp3 against the beat's verbatim words, not from the TTS model's predicted timestamps.
  - Against speech-to-text, the predicted timestamps drifted by up to 1.06 s around tags and pauses (measured on the v3 take).
  - Forced alignment agreed with STT within about 0.05 s.
  - `wordsFromCharacters` refuses any timing that doesn't spell the script.
- **Beat 26 silence:** v4 turbo's `[long pause]` gave 1.28 s natively. `--max-gap beat-26:1200` trimmed 100 ms.

## Cost

ElevenLabs' own meter (`/v1/user/subscription` `character_count`) rose by **3,220 credits** over the whole session. That covers both full takes, the sample tests and the retakes, about $0.97 at $0.30/1k, under the $3 cap. The script's own `$0.30/1k × characters` estimate is conservative because it ignores the model's credit multiplier.

## Quality pass (by measurement, v4 turbo take)

- **Verbatim:** every beat's forced alignment spells the script. STT on all 56 beats returned the script's words, and no audio-tag text was spoken in any beat.
- **Pace:** 382.3 s rendered against 438.0 s planned (0.87), or 125 wpm, inside the plan's 125–135 band. Per-beat ratios are in `measurements.json`.
- **Reactions:** STT tags five performed reactions: `[sighs]` in beats 9 and 32, a laugh in 17, a chuckle in 35, and the laugh in 56. Measured in the gap where each tag sits:
  - beat 9 `[sighs]`: 900 ms at −30.9 dB;
  - beat 17 `[chuckles]`: 1,200 ms at −24.0 dB;
  - beat 28 `[laughs softly]`: 340 ms at −31.1 dB;
  - beat 32 `[sighs]`: 1,220 ms at −33.9 dB;
  - beat 35 `[chuckles]`: 760 ms at −25.5 dB;
  - beat 56 `[laughs]` at the end: 1,184 ms at −27.3 dB.
- **Whisper:** in beat 26, "silence" is 15 dB quieter than "Then".

## Browser run

- **Recording:** `story-rendered-desktop.mp4`, 1280×800, 6 min 35 s, H.264 + AAC mono. Recorded from `/dev/story` in Chromium with the rendered narrator (`narrator: RENDERED`).
- **Audio mux:** Playwright records video without sound, so a hook on `AudioBufferSourceNode.start` logged each beat's start time.
  - All 56 beats started in order, with buffer lengths matching their files.
  - Each beat's mp3 was mixed in at its logged offset.
  - Expect up to about 50 ms of error between the page clock and the first video frame.
- **Cue-to-word offsets on the real audio:** median −85 ms, p95 10 ms (n = 164). By kind:
  - stage: median −83 ms;
  - light: median −98 ms;
  - navigate: median 560 ms (route changes).
- **Other:** 13 safe fallbacks; preload 1.6 s.
- **Frames:**
  - `frame-beat26-silence.png`: Q is gold (the harness applies the black-gold preset).
  - `frame-beat08-captions.png`: word-by-word captions. Nit for S1: the "Photos: Pexels contributors" credit overlaps the caption band.
