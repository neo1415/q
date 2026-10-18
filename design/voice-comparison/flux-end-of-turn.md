# Listening: end of turn, and Deepgram vs ElevenLabs (voice lane, 2026-09-25)

Measured from the developer machine in Lagos. The test speech is synthetic (ElevenLabs turbo v2.5 and Deepgram Aura-2 voices, with silences inserted), streamed to each recogniser in real time in 80 ms chunks. Synthetic speech is cleaner than a person on a laptop microphone, so recognition accuracy here is optimistic. The timings and the way turns split are the useful part. Raw rows: `flux-end-of-turn.json`, `listen-comparison.json`, `speak-reliability.json`.

## Flux end of turn (3 runs per case)

"Turns" is how many end-of-turn events one utterance produced. The ideal is 1. Times are from the end of the audio to the last end of turn, median, in ms.

| Case                                                             | 0.7 / 3 s    | 0.8 / 3 s    | **0.85 / 4 s**   | 0.9 / 5 s    |
| ---------------------------------------------------------------- | ------------ | ------------ | ---------------- | ------------ |
| trailing thought ("This one. You know, so yes. See, you could…") | 2 turns      | 2 turns      | **1 turn**       | 1 turn       |
| three clauses with 1.5 s and 1.2 s pauses                        | 3 turns      | 3 turns      | **2 turns**      | 2 turns      |
| "We are raising a seed round and, um, [1.8 s] I think…"          | 1 turn, 1909 | 1 turn, 2434 | **1 turn, 2324** | 1 turn, 2401 |
| finished question ("What cheque size do you usually write?")     | 897          | 1205         | **1294**         | 1671         |
| "Okay."                                                          | 847          | 1107         | **1239**         | 1523         |

Chosen: `eot_threshold` 0.85, `eot_timeout_ms` 4000. It keeps a trailing-off thought whole, and it splits the three-clause sentence in two rather than three. The cost is about 0.4 s more on a finished sentence. 0.9 splits no less and costs another 0.4 s.

A split that remains usually ends where the recogniser left the sentence open (for example "Based on what is in aviation,"). The turn holds such an utterance for 1.5 s before acting on it (`turn.ts`, `endsUnfinished`).

## Deepgram Flux vs ElevenLabs Scribe v2 Realtime (same audio, 6 cases × 5 runs)

Settings: production Flux (0.7 / 3 s at the time) and Scribe with VAD commit.

|                                       | Flux   | Scribe v2 RT |
| ------------------------------------- | ------ | ------------ |
| end of speech → final transcript, p50 | 1.35 s | 2.42 s       |
| worst                                 | 5.9 s  | 2.8 s        |
| "What's up?"                          | 0.40 s | 2.0 s        |
| first partial                         | 0.58 s | 2.6 s        |
| errors / split turns (of 30)          | 0 / 0  | 0 / 0        |
| word errors                           | equal  | equal        |

Both recognisers missed "NEM" and misheard "Zino". Scribe writes numbers as digits.

## Speaking reliability (24 requests each, the relay's exact request shapes)

| Engine                | Failures | Time to first audio p50 / p95 (ms) | Total p50 (ms) |
| --------------------- | -------- | ---------------------------------- | -------------- |
| ElevenLabs v3 conv.   | 0        | 307 / 464                          | 910            |
| ElevenLabs turbo v2.5 | 0        | 338 / 512                          | 517            |
| Deepgram Aura-2       | 0        | 397 / 609                          | 2055           |

The ElevenLabs account stood at 16,767 of 131,000 characters.

## Reading

Deepgram listens faster. ElevenLabs v3 speaks faster and more expressively (see `comparison.md` for voice quality). The current split, Flux listening and ElevenLabs speaking through the relay, keeps the better half of each. No provider has been switched.
