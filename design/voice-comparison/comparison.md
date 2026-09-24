# Q voice: TTS comparison (CQ-VOICE-010, phase 2)

Measured 2026-09-24 from the developer machine in Lagos. These are not Railway europe-west4 numbers: the relay's own round trip to each vendor will be shorter. Raw data is in `results.json`. The clips are `<provider>/<case>.wav` (PCM 16-bit mono 24 kHz, the exact format the Deepgram agent socket plays). Each clip is the first of the five timed runs.

## What was compared

| Key           | Configuration                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| EL turbo v2.5 | The deployed relay config: `eleven_turbo_v2_5`, Sarah `EXAVITQu4vr4xnSDxMaL`, `pcm_24000`, voice defaults. Pauses rendered as `<break time="0.6s" />` and pace as `voice_settings.speed`, which is what this model can render. |
| EL v3 conv.   | `eleven_v3_conversational`, same voice, voice defaults (stability 0.5). Reactions rendered as `[laughs]` / `[chuckles]` / `[sighs]`, pauses as `[short pause]`, emphasis as capitals.                                          |
| DG Aura-2     | `aura-2-thalia-en` (what the agent speaks in when no ElevenLabs key is configured). Pauses rendered as an ellipsis. The Deepgram account has no other TTS family: no Flux TTS exists, Flux is STT only.                        |

Every provider received the same Q reply text. The only differences are the cue markup that provider can render, plus one untimed warm-up request per provider. Case 08 is sent exactly as the live path would send it, i.e. after `speakable()`, so its text is `…cheques of 250 thousand dollars–3m…`.

## How "cue rendered" was decided (measured, not heard)

Each clip was transcribed with Deepgram nova-3:

- A cue that was **read aloud as a word** shows up in the transcript. In a probe, turbo said `[laughs]` as "Halfs" and Aura-2 said it as "Laughs". Neither ever appeared for v3.
- A **reaction** that was rendered puts non-silent audio before the first word. The first-word onset column shows this: it is 0 to 160 ms without a reaction.
- A **pause** shows as a silent gap of at least 350 ms. Sentence boundaries alone give gaps of about 400 to 700 ms, so compare each row against 01-neutral for the same provider.
- **Pace** shows in words per second.
- **Emphasis** cannot be measured this way and needs ears.

Naturalness is the author's judgement from these properties only. **The final call on naturalness needs a human listening to the clips.**

## Results (5 timed runs each)

TTFA is time to the first audio byte in ms, as p50 / p95. Synth is total synthesis time in ms (p50). Onset is first-word onset in ms. Gaps are silent gaps of at least 350 ms. wps is words per second.

| Case                | Provider      | TTFA p50 / p95 | Synth p50 | Audio  | Cue rendered                      | Onset | Gaps ms           | wps  |
| ------------------- | ------------- | -------------- | --------- | ------ | --------------------------------- | ----- | ----------------- | ---- |
| 01-neutral          | EL turbo v2.5 | 319 / 521      | 449       | 7.1 s  | n/a                               | 0     | 460, 700          | 3.72 |
| 01-neutral          | EL v3 conv.   | 249 / 457      | 1351      | 7.0 s  | n/a                               | 0     | 400               | 3.72 |
| 01-neutral          | DG Aura-2     | 267 / 584      | 2213      | 6.6 s  | n/a                               | 160   | 760               | 3.91 |
| 02-uncertainty      | EL turbo v2.5 | 347 / 356      | 438       | 8.8 s  | yes: pause + pace                 | 0     | 800, 480          | 3.21 |
| 02-uncertainty      | EL v3 conv.   | 258 / 301      | 1468      | 10.7 s | pause yes; pace not rendered      | 0     | 1960, 360, 600    | 2.60 |
| 02-uncertainty      | DG Aura-2     | 880 / 984      | 5088      | 9.2 s  | pause weak; pace not rendered     | 0     | 380, 480          | 3.01 |
| 03-thoughtful-pause | EL turbo v2.5 | 347 / 361      | 414       | 8.6 s  | yes: pause                        | 0     | 820, 860, 380     | 2.91 |
| 03-thoughtful-pause | EL v3 conv.   | 277 / 524      | 1482      | 10.2 s | yes: pause                        | 0     | 840, 620          | 2.46 |
| 03-thoughtful-pause | DG Aura-2     | 1028 / 1430    | 5402      | 8.3 s  | **no** (the ellipsis left no gap) | 0     | none              | 2.94 |
| 04-amusement        | EL turbo v2.5 | 294 / 296      | 327       | 3.9 s  | no (dropped: not supported)       | 0     | none              | 4.07 |
| 04-amusement        | EL v3 conv.   | 249 / 520      | 1024      | 5.3 s  | **yes**: chuckle                  | 800   | 480               | 3.50 |
| 04-amusement        | DG Aura-2     | 367 / 987      | 2448      | 4.5 s  | no (dropped: not supported)       | 0     | none              | 3.24 |
| 05-laughter         | EL turbo v2.5 | 311 / 604      | 387       | 5.8 s  | no (dropped: not supported)       | 0     | 400               | 3.57 |
| 05-laughter         | EL v3 conv.   | 276 / 487      | 1228      | 8.1 s  | yes: laugh (short, needs ears)    | 240   | none              | 2.88 |
| 05-laughter         | DG Aura-2     | 352 / 387      | 3310      | 6.2 s  | no (dropped: not supported)       | 160   | none              | 3.33 |
| 06-sigh             | EL turbo v2.5 | 301 / 316      | 360       | 5.5 s  | no (dropped: not supported)       | 0     | none              | 3.65 |
| 06-sigh             | EL v3 conv.   | 252 / 541      | 1195      | 6.7 s  | yes: sigh (short, needs ears)     | 160   | 460               | 3.01 |
| 06-sigh             | DG Aura-2     | 365 / 377      | 3505      | 5.1 s  | no (dropped: not supported)       | 0     | 420               | 3.83 |
| 07-disagreement     | EL turbo v2.5 | 349 / 359      | 480       | 8.2 s  | pause yes; emphasis dropped       | 0     | 820, 560          | 2.90 |
| 07-disagreement     | EL v3 conv.   | 268 / 525      | 1539      | 10.3 s | pause yes; emphasis sent (ears)   | 0     | 1100, 600         | 2.36 |
| 07-disagreement     | DG Aura-2     | 1019 / 1199    | 4670      | 8.1 s  | pause yes; emphasis dropped       | 80    | 1180, 680         | 2.75 |
| 08-numbers          | EL turbo v2.5 | 437 / 514      | 821       | 13.3 s | n/a                               | 0     | 600               | 3.49 |
| 08-numbers          | EL v3 conv.   | 245 / 540      | 2053      | 15.6 s | n/a                               | 0     | 400, 360          | 2.94 |
| 08-numbers          | DG Aura-2     | 1067 / 1371    | 7180      | 12.7 s | n/a                               | 80    | 600               | 3.45 |
| 09-long-explanation | EL turbo v2.5 | 654 / 724      | 1549      | 49.7 s | yes: pause                        | 0     | 10 gaps, 360-840  | 2.99 |
| 09-long-explanation | EL v3 conv.   | 603 / 737      | 6693      | 50.6 s | yes: pause                        | 0     | 7 gaps, 360-1160  | 2.94 |
| 09-long-explanation | DG Aura-2     | 1109 / 1223    | 22599     | 48.6 s | yes: pause                        | 80    | 12 gaps, 380-1020 | 3.05 |
| 10-interruption     | EL turbo v2.5 | 660 / 682      | 926       | 1.5 s  | n/a                               | 0     | none              | 5.00 |
| 10-interruption     | EL v3 conv.   | 526 / 592      | 888       | 1.5 s  | n/a                               | 0     | none              | 3.75 |
| 10-interruption     | DG Aura-2     | 276 / 800      | 716       | 1.5 s  | n/a                               | 160   | none              | 4.17 |

### Interruption

Case 10 cancels the stream after 1.5 s of audio has arrived and times the cancel. Measured stop times in ms:

- EL turbo v2.5: 3.3, 1.1, 0.8, 0.9, 0.9
- EL v3 conv.: 2.2, 1.0, 1.1, 0.7, 1.4
- DG Aura-2: 2.4, 0.7, 1.1, 5.2, 1.0

On the vendor side, stopping is effectively instant for all three. In the live product, stop latency comes from the browser, not from the TTS: the barge-in detector's 260 ms sustained-sound window (`SUSTAINED_WINDOW_MS`) plus the agent dropping the think and speak requests. The relay already aborts the vendor call when the agent hangs up.

The DG Aura-2 TTFA in case 10 (276 ms) is far below the 1109 ms it took on the same text in case 09. That points to a server-side cache for repeated text, so treat Aura-2's case 10 TTFA as unrepresentative.

### Numbers (case 08, transcribed)

The input was `250 thousand dollars–3m … 1.2 million dollars … 38% … 14 March 2026`:

- **EL turbo v2.5** said "two hundred and fifty thousand dollars **three annum**".
- **DG Aura-2** said "two hundred fifty thousand dollars **three meters**".
- **EL v3 conv.** said "two hundred fifty thousand dollars **to three million**". This is the only correct reading.

All three read "1.2 million dollars", "38%" and the date correctly. The fault sits upstream in `speakable()`: it expands the lower bound of a range but leaves `–3m`. That is fixed in phase 3 whichever provider is chosen.

### v3 conversational: latency options (`v3-optimize-latency.json`)

- **`optimize_streaming_latency` is refused** with HTTP 400 `unsupported_model`: "Providing optimize_streaming_latency is not supported with the 'eleven_v3_conversational' model". This was tried at 3 and 4, on 3 cases × 5 runs. The relay must never send that parameter with v3.
- **The same three texts with no parameter, re-measured and interleaved**, had these TTFA p50 / p95 values:

  | Case            | TTFA p50 / p95 (ms) |
  | --------------- | ------------------- |
  | 01-neutral      | 260 / 563           |
  | 04-amusement    | 344 / 436           |
  | 07-disagreement | 313 / 540           |

- **The WebSocket `stream-input` endpoint refuses v3 conversational**: the socket errors on connect. On the same socket, turbo v2.5 gives TTFA p50 611 / p95 858 ms, which is worse than turbo's HTTP `/stream` at about 300 ms. The Deepgram agent hands the relay whole sentences, so HTTP `/stream` (what the relay uses) is the fastest path for both models.

## Reading of the evidence

- **Time to first audio.** On short sentences, which is what the Deepgram agent sends the relay one at a time, v3 conversational is at least as fast as turbo: p50 245 to 277 ms against 294 to 349 ms. Its p95 is wider, reaching about 520 to 540 ms against turbo's 296 to 521 ms. On one long block the two are level (603 against 654 ms). Aura-2 matches them on a single sentence but takes about 1 s to first audio on multi-sentence text.
- **Throughput.** Turbo synthesises about 30 times faster than real time, v3 conversational about 7 times, Aura-2 about 2 times. All three stay ahead of playback, so none of them will stall a stream.
- **Expressiveness.** Only v3 conversational renders laugh, chuckle and sigh without reading the tag aloud. Turbo and Aura-2 **read tags as words**. So a tag must never reach them, and `Q_VOICE_EXPRESSIVE=true` against turbo (as set in the local `.env.local`) is a defect today.
- **Pace.** Turbo honours `voice_settings.speed`. v3 conversational ignores it (in the probe, speed 0.85 and 1.0 gave identical durations of 1680 ms). Aura-2 has no pace control.
- **Pauses.** Break tags and `[short pause]` render on both ElevenLabs models. Aura-2's ellipsis is unreliable.
- **Cost.** On this account's billing the same comparison set cost about the same on both ElevenLabs models: 3,756 characters for v3 and 3,629 for turbo, according to ElevenLabs history. The whole of phase 1 and phase 2 used 7,774 of the 131,000 characters in the cycle.

## Recommendation (awaiting the lead's go, not switched)

**Move the relay from `eleven_turbo_v2_5` to `eleven_v3_conversational`, keeping the same voices.** The speech-performance layer would render reactions and pauses as v3 tags and drop pace on v3. Aura-2 stays as the no-ElevenLabs fallback with every cue except pauses stripped.

The evidence for this:

- first audio is equal or better on the per-sentence requests the agent makes;
- it is the only option that renders the non-verbal cues without speaking them;
- it reads ranges correctly;
- the cost is the same.

Conditions and risks:

1. **A human listens to `04`, `05`, `06` and `07` on v3 before the switch.** The laugh and sigh onsets (240 ms and 160 ms) are short, and I cannot judge from measurements whether they sound natural or forced.
2. **Deepgram's agent must accept the speak settings.** The agent is told `model_id` in `speak.provider`, and the relay chooses the model itself. If Deepgram rejects `eleven_v3_conversational` there, keep telling the agent `eleven_turbo_v2_5`. The relay's choice is ours, because the endpoint is ours.
3. **v3's p95 on short sentences is about 200 ms wider than turbo's.** Re-measure on Railway with the phase 4 recipe.
