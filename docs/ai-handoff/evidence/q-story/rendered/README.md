# Q Story S5: rendered narration evidence (2026-10-22)

Branch `qstory/render` (from `qstory/engine` @ 73e58df1). The audio is at `apps/web/public/story-media/pFZP5JQG7iQjIQuC4Bku/`: 56 × `beat-NN.mp3` + `beat-NN.json`, plus `index.json` with `complete: true`. `STORY_VOICE` in `apps/web/src/features/q-pitch/story/story-preload.ts` points at that folder.

## Render

- **Voice:** Lily `pFZP5JQG7iQjIQuC4Bku` (ElevenLabs premade, "velvety actress", British female).
  - The owner picked her from the voice A/B on 2026-10-22 (`../voice-ab/`).
  - She replaces Sarah `EXAVITQu4vr4xnSDxMaL`, whose files were removed (still in git history).
- **Model:** `eleven_v4_turbo`, the owner's choice on 2026-10-22.
  - The repo had never measured whether v4 turbo honours audio tags (`apps/q-api/src/voice/providers/speech-markup.ts`). Measured on the story, it performs them: STT hears the sighs and laughs, and no tag is read aloud.
  - Its credit rate is half of v3's (`character_cost_multiplier` 0.5).
  - An earlier take on `eleven_v3_conversational` was superseded: v4 turbo performed the reactions audibly where v3 was faint or absent.
- **Speech Engine id:** the environment's `ELEVENLABS_SPEECH_ENGINE_ID` (`seng_…`) isn't a voice, and it isn't visible to this API key's workspace (`GET /v1/speech-engine/{id}` returns 404).
- **Format:** `mp3_44100_96`, mono, 96 kbps. 4.9 MB in total.
- **Timings come from ElevenLabs forced alignment** of each rendered mp3 against the beat's verbatim words, not from the TTS model's predicted timestamps.
  - Against speech-to-text, the predicted timestamps drifted by up to 1.06 s around tags and pauses (measured on the v3 take).
  - Forced alignment agreed with STT within about 0.05 s.
  - `wordsFromCharacters` refuses any timing that doesn't spell the script.
- **Beat 26 silence:** `--max-gap beat-26:1200` trimmed 260 ms. "Then" to "silence" is now exactly 1.20 s.

## Cost

ElevenLabs' own meter (`/v1/user/subscription` `character_count`) rose by **5,285 credits** over the whole session, about $1.59 at $0.30/1k. That covers:

- the v3 take and the v4 turbo Sarah take;
- the voice A/B;
- this Lily take;
- the sample tests and retakes.

OpenAI's share was about $0.03 (the A/B's marin and cedar takes). The total is under the $3 cap. The script's own `$0.30/1k × characters` estimate is conservative because it ignores the model's credit multiplier.

## Quality pass (by measurement, Lily on v4 turbo)

- **Verbatim:** every beat's forced alignment spells the script. STT on all 56 beats returned the script's words, and no audio-tag text was spoken in any beat.
  - Beat 49 came back tagged only as "[outro jingle]" at first.
  - A second STT pass (`scribe_v1` and `scribe_v1_experimental`, audio-event tagging off) transcribed the full line correctly.
  - Its alignment fit (0.608) is better than the story's median (0.666), so the first result was a tagger misfire, not bad audio.
- **Pace:**
  - 394.7 s rendered against 438.0 s planned (0.90), or 121 wpm. Lily is slightly under the plan's 125–135 band.
  - Per-beat ratios are in `measurements.json`.
- **Reactions:** STT tags the sigh in beat 9 and the laughs in 17 and 56. Measured in the gap where each tag sits:
  - beat 9 `[sighs]`: 820 ms at −30.4 dB;
  - beat 17 `[chuckles]`: 1,200 ms at −27.7 dB;
  - beat 28 `[laughs softly]`: 900 ms at −36.5 dB;
  - beat 32 `[sighs]`: 1,080 ms at −37.3 dB;
  - beat 35 `[chuckles]`: 720 ms at −34.0 dB;
  - beat 56 `[laughs]` at the end: 1,184 ms at −27.6 dB.
- **Whisper:** in beat 26, "silence" is 8.8 dB quieter than "Then".

## Browser run

- **Recording:** `story-rendered-desktop.mp4`, 1280×800, 6 min 48 s, H.264 + AAC mono. Recorded from `/dev/story` in Chromium with the rendered narrator (`narrator: RENDERED`).
  - All 56 beat buffers that played match Lily's files.
- **Audio mux:** Playwright records video without sound, so a hook on `AudioBufferSourceNode.start` logged each beat's start time.
  - Each beat's mp3 was mixed in at its logged offset.
  - Expect up to about 50 ms of error between the page clock and the first video frame.
- **Cue-to-word offsets on the real audio:** median −85 ms, p95 −14 ms (n = 164). By kind:
  - stage: median −79 ms;
  - light: median −103 ms;
  - navigate: median 663 ms (route changes).
- **Other:** 13 safe fallbacks; preload 1.4 s.
- **Frames:**
  - `frame-beat26-silence.png`: Q is gold (the harness applies the black-gold preset).
  - `frame-beat08-captions.png`: word-by-word captions. Nit for S1: the "Photos: Pexels contributors" credit overlaps the caption band.

## Open: Q&A answers still use Sarah

Story Q&A answers are spoken by Q's standard voice (`apps/web/src/features/q-pitch/narrator.ts` `fetchSpeech` → q-api `VOICE_IDS.FEMALE` = Sarah), not by the narration. A viewer hears Lily tell the story and Sarah answer. Making Lily Q's voice everywhere is a q-api change (`apps/q-api/src/voice/providers/elevenlabs-speak.ts`, plus the Speech Engine resources), and the owner decides it.
