# Can Lily be Q's live voice? Duplex capability test (2026-10-22)

The owner's condition: Lily (ElevenLabs `pFZP5JQG7iQjIQuC4Bku`) becomes Q's voice across the app only if she does what GPT-Live does live. That means emotion and laughs, "hmm" while you talk, being interruptible, and filler or real talk while work runs.

The result is a measured A/B on identical inputs. Branch `voice/lily-duplex` from `speed/q-oct20` @ a65f8ba8b. No product code changed.

## What ran

- **GPT-Live (baseline):**
  - The repo's own harness, `scripts/recovery/live/harness.mjs --provider live --scenario 2,3,4,7 --backend offline`, running `gpt-live-1`.
  - Spend is logged in `docs/recovery/evidence/gpt-live/spend.md`.
- **Lily:**
  - A temporary ElevenLabs Agent (`tools/test-agent.json`) with Lily on `eleven_v3_conversational`, which turns expressive mode on. It used Scribe realtime ASR, the `turn_v3` turn model with speculative turns, a soft-timeout filler at 2 s, and one client tool that the driver answers after a deliberate 6 s delay.
  - It was driven by `tools/el-run.mjs` with **the same cached user recordings** (synthetic Nigerian-English speakers from the harness) and the same step rules.
  - The agent was deleted after the test.
- **Stand-in brain:** the Lily agent's brain was a stand-in LLM (`gemini-2.5-flash`), told to act as Q.
  - ADR 0010 forbids a hosted ElevenLabs LLM as Q's brain in the product. The allowed path is the Speech Engine with Q's own server producing every word.
  - So this measures ElevenLabs' **voice pipeline**: listening, turn-taking, interruption, expressive speech, filler.
  - It does not measure Q's brain.
- **Measurement, the same for both:**
  - one speaker-separated transcript per clip (`stt/`, Scribe with diarization and audio-event tags), giving word times per speaker;
  - each side's own latency numbers.
  - `metrics.json` is produced by `tools/metrics.py`.

## Result

| Feature                                                | Lily (ElevenLabs)                                                                                                                                                                                               | GPT-Live (`gpt-live-1`)                                                                                                                                                      |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) Emotion and laughs in live replies                 | **YES.** Humour clip: a performed `[chuckles]`, which the transcript tags as a sound. Even the stand-in's invented tags (`[direct]`, `[practical]`) were never spoken.                                          | **PARTIAL.** Natural "Mm." openers, but no laugh at the same joke in this take.                                                                                              |
| (b) Backchannel while the user is speaking             | **NO.** Silent through every user turn and pause, in all 4 clips. ElevenLabs documents _tolerating_ the user's "mm-hmm" (`interruption_ignore_terms`), not producing its own.                                   | **PARTIAL.** Said "That's all right." in the user's pause mid-interruption (`04`, 13.58 s). No "mm-hmm" during the hesitant pauses (`03`).                                   |
| (c) Barge-in: stops when interrupted                   | **YES, ~0.65 s.** Cut mid-word ("inv-"). ElevenLabs' `interruption` event came 652 ms after the user's voice began. Then she waited for the user to finish.                                                     | **YES, about the same.** Cut mid-word ("round-") at the same transcript point. It has no interruption event, so there is no exact number. Then it acknowledged and answered. |
| (d) Talk or filler while work runs                     | **YES (stand-in brain).** During the 6 s tool wait she said she was checking, answered the side question, then gave the result. Longest gap inside the reply: 0.66 s.                                           | **YES.** Answered the side question while the delegation ran. Longest gap inside the reply: 0.68 s.                                                                          |
| (e) End of user speech → first audio                   | **1.5 s median** (1.0–1.6 s, n = 6) **with a fast stand-in LLM**. On the allowed architecture (Speech Engine + Q Brain), first words are **1.9–5.0 s** (Q Brain harness, `TURN-LATENCY-2026-10-21-HANDOFF.md`). | **1.19 s median** (0.93–1.76 s, n = 6). The speech model talks itself and delegates facts.                                                                                   |
| Holding a conversation while Q works (beyond a filler) | Not native: Q's server would have to run the background job and answer side turns itself.                                                                                                                       | Native: the bridge delegates and keeps talking (`live/bridge.ts`).                                                                                                           |

Clips (both sides mixed, as heard): `gpt-live/0N-*.mp3` and `lily/0N-*.mp3`. Event logs are next to each clip.

## Verdict against the bar

The bar was: match GPT-Live on emotion, barge-in, filler during work and latency, with at most backchannel PARTIAL.

- **Matched:** emotion (Lily is better), barge-in (equal) and talk during work (equal, with the stand-in brain).
- **Missed, backchannel:** Lily is **NO**, and the platform has no setting that produces one.
- **Missed, latency on the allowed path:** Q Brain's 1.9–5.0 s to first words against GPT-Live's ~1.2 s. The 1.5 s Lily figure needs a hosted fast LLM as the brain, which ADR 0010 rules out.

So per the slice, **nothing was implemented**. The hybrid is the honest option: **GPT-Live for live duplex conversation, Lily for narration** (the Q Story, the one-way spoken answers and the story's own Q&A voice). The owner decides.

## Blockers and limits

- The owner's `ELEVENLABS_SPEECH_ENGINE_ID` (`seng_…`) **still isn't visible** to this API key's workspace: GET returns 404, and the workspace lists zero engines. Lily with Q's real brain could not be tested here. That also needs a Speech Engine pointing at a public q-api WebSocket.
- **Synthetic users:** the users are synthetic TTS voices, not people. Each side ran one take per scenario (two retakes on Lily's research scenario while fixing the stand-in prompt and the driver's stop rule).
- **Barge-in timing:** transcript word boundaries lag the acoustic onset by about 0.7 s, so the exact ~0.65 s comes from Lily's own event log. GPT-Live has no such event. "About the same" means both cut at the same transcript point.
- **Spend:**
  - GPT-Live: $0.137 (ledger running total $2.106 of $2.50).
  - ElevenLabs: 1,840 credits for agent minutes, user prompts and transcripts, about $0.55.
  - About $0.69 in total, under the $1 cap.
