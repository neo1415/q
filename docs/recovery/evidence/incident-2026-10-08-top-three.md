# Incident: "top three companies" on live voice (2026-10-08 19:14–19:16 UTC)

Reconstructed by the lead from production (Railway q-api logs, `q_runtime.run_events`, `q_runtime.conversation_messages`, `q_runtime.voice_line_turns`). These were read-only queries. Company identities are shown only as md5 hashes, and no message content is reproduced beyond the turn kind. The tenant's data posture is `SYNTHETIC_DEMO`.

Duplex voice session `67c5b22a…`, conversation `c10b845f…`, build: production `recovery/2026-09-12` (before the recovery integration).

## Timeline

| t (UTC)     | Source                   | Event                                                                                                                                                                                  |
| ----------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 19:14:50.86 | `duplex/heard`           | The founder asks for the top three companies for their mandate (43 words). Routed `ask_q`.                                                                                             |
| 19:14:51.36 | `duplex/narration` #1    | A bridge line ("let me put that up").                                                                                                                                                  |
| 19:14:53.43 | q-api                    | `q answered a fit question from computed fits`: cards=3, considered=24, fitCalls=22, 153 ms                                                                                            |
| 19:14:53.79 | run `6f16fa48` COMPLETED | 2,503 ms. The stored message holds **one ANSWER_CARDS block with 3 distinct company ids**.                                                                                             |
| 19:14:54.24 | `duplex/narration` #2    | Bridge line again, **after the answer was ready**.                                                                                                                                     |
| 19:14:54.59 | q-api                    | `a code-built answer was said from its facts` (handed to the realtime model)                                                                                                           |
| 19:14:57.97 | `duplex/narration` #3    | Bridge line a third time.                                                                                                                                                              |
| 19:15:00.09 | `duplex/heard`           | The founder follows up: "rank them … pros and cons". The answer was still never spoken.                                                                                                |
| 19:15:02.04 | run `f09e650e`           | cards=**10**. The follow-up "them" was not bound to the 3; the fit path returned the whole candidate list. This is the "cards expanded to ~12".                                        |
| 19:15:13.25 | `duplex/heard`           | "find anything that needs my attention". Run `8d49fe3d` returns FINDING blocks, and the card set is replaced on screen ("cards disappeared").                                          |
| 19:15:30.73 | `duplex/said`            | The **only** thing spoken in the whole exchange: a model-only "let me find the top three … give me a moment". A stale bridge for the first question, 40 s late, after two newer turns. |
| 19:15:58.62 | `duplex/end`             | The line ends with no answer spoken ("voice stopped without a final answer").                                                                                                          |
| 19:16:10–18 | new session + `said`     | Reconnect, and the arrival greeting is replayed.                                                                                                                                       |

The server logged `voice turn timed outcome="SPOKEN"` for turns 2–4 with `ttsRequests=0, firstAudioMs=null`. **"SPOKEN" was recorded when text was handed to the realtime model, not when audio was confirmed**, so the telemetry hid the lost turn.

## Root causes

1. **Voice lifecycle (A).**
   - Bridge narration is not cancelled when the result lands, which caused the 3 narrations.
   - The realtime model was handed the answer and produced none of it; no watchdog turned that into a terminal error.
   - A stale model reply for a superseded turn was spoken.
   - The server disposition `SPOKEN` is not tied to a client `said` confirmation.

   Integration already has A4 (watchdogs), A6 (stale-reply guard) and A10, but none of these were in production. They must be proven against this exact sequence.

2. **Follow-up enlargement (B).** "rank them" after a 3-card answer should keep the same 3 canonical ids (B6 references). Instead it produced 10. There is no per-turn requested-count binding.
3. **Card replacement (E).** A newer answer of another kind (attention findings) replaced the ranked cards on stage. The earlier result is not kept reachable on the Board or in history.
4. **Score presentation (B).** The ties are genuine, not duplicates.
   - Each card: `fit {score 8.8, measured 5, of 7}`. Measure levels are STRONG×4, PARTIAL×1, UNKNOWN×2 (Cheque size and Round). `sourceCount 0`.
   - Formula (`packages/model-gateway/src/q/answer-cards.ts:23`): STRONG = 10, GOOD = 7.5, PARTIAL = 4, UNKNOWN excluded. (4×10 + 4) / 5 = **8.8**.
   - The tie needs saying ("tied on mandate fit, 5 of 7 measures known, no source documents"), and it must be labelled mandate fit, never quality.

## Fix ownership

A (voice lifecycle), B (follow-up binding, exact counts, score labelling), E (card stability), and G (real-browser regression replaying this sequence on baseline and integration). See TRACKING row INC-1.
