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

## Regression results (workstream G, 2026-10-08/09)

**How it was run.**

- All runs are LOCAL-E2E (MOCK), at $0, in real Chromium (`/opt/pw-browsers/chromium`) against the local stack from `scripts/recovery/local-stack.sh`.
- The fit answer is code-built (no model). The turn reader is the scripted fake (`scripts/recovery/fake-vendors.mjs`).
- The duplex line runs on the RTCPeerConnection fake (`tests/recovery/support/duplex-fake.ts`), with its credential minted by the fake (`scripts/recovery/vendor-redirect.mjs`).
- Investor: `investor.savanna-seed`.
- Spec: `tests/recovery/scenarios/k-incident-top-three.spec.ts`. Command: `npx playwright test -c tests/recovery/playwright.recovery.config.ts --project=scenarios k-incident l-named pages-load`.
- Each check reads the DOM and also re-reads the stored conversation message (GET `/v1/q/conversations/:id`; for navigation, the receipt q-api accepted).
- **Baseline** = production `520bd123`, in its own worktree, run under the same harness against the same local database. That database has 183 migrations, 5 newer than production.
- **Integration** = `62aba8d6` (integration `9324df74`, including `117d32f6` G-D13 and `56b12fb2` /home).

### Browser-tested (LOCAL-E2E, MOCK model)

| Assertion                                                                                                                      | Baseline 520bd123                     | Integration 9324df74                                                                                                                                                                                                                                     | Waits on          |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| /home loads (founder, investor): no "couldn't load", no TypeError                                                              | GREEN                                 | GREEN (red before `56b12fb2`)                                                                                                                                                                                                                            | —                 |
| Exactly 3 cards, 3 unique canonical ids, DOM = stored message                                                                  | RED (stored 0: history dropped cards) | GREEN (red before `117d32f6`, G-D13)                                                                                                                                                                                                                     | —                 |
| Each card labelled **mandate fit**, with "X of Y" and source, and the tie explained                                            | RED                                   | RED. The card shows "8.0 fit, out of 10" and levels (Strong/Partial/Unknown), but no "mandate fit", no "3 of 6", no source and no tie sentence. B's `fit-integrity.ts` puts that wording in `said` and the block title, which the canvas does not render | **E** (render), B |
| (d) "rank them" keeps the same 3 ids (stored and DOM)                                                                          | RED (stored 0)                        | GREEN                                                                                                                                                                                                                                                    | —                 |
| (e) After an attention (FINDING) turn the 3 cards stay reachable (stage, Board or history)                                     | GREEN (cards stayed on stage)         | RED: card names hidden after the attention answer; Board shows 0                                                                                                                                                                                         | **E**             |
| (a) Late result: ≤1 bridge, none after the answer, the answer handed over exactly once, cards arrive                           | RED (cards never arrived on the line) | INTERMITTENT, 2 of 3 runs GREEN. The failing run had no cards after the 4 s relay delay. In passing runs the line sent `[opener, BARE {tool_choice:"none"}, answer]`: one model-worded holding line, then the answer                                     | **A**             |
| (b)+(c) Two assistant messages for one turn, plus narration while the cards show: at most one answer line, cards stay, 2 turns | RED                                   | RED: no `[data-q-turn-id]` turns rendered                                                                                                                                                                                                                | **A**, G-R3       |
| (f) Voice final fails: exactly one terminal line or error, terminal disposition, cards stay                                    | RED                                   | RED: no `role=alert/status` line after `response.done failed` plus `error`                                                                                                                                                                               | **A** (A4)        |
| (g) Reconnect: cards unchanged, no bridge or improvised reply for the old question afterwards                                  | RED                                   | GREEN (red at `117d32f6`: a BARE response after the reconnect)                                                                                                                                                                                           | —                 |

### Named-record navigation (C, the "Shiftwell" pattern; Shiftwell is not in the local world, so Ledgerfold is used)

| Ask                                                                                   | Baseline                                                       | Integration                                                                                                                                                                                                  | Waits on |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| "Take me to Ledgerfold relationship" (route, heading, DONE receipt accepted by q-api) | RED (it lands, but baseline has no receipts)                   | INTERMITTENT, GREEN 2 of 4. `open_page` is sometimes DENIED NOT_AVAILABLE for the investor's own ACCEPTED relationship. One run landed while the receipt said **FAILED** (expected = the route it landed on) | **C**    |
| "Open Ledgerfold"                                                                     | RED (does not navigate)                                        | GREEN: route, heading, DONE receipt, accepted ≥ 1                                                                                                                                                            | —        |
| "Show me the data room for Ledgerfold"                                                | RED (lands on the company page, but no Data room tab selected) | RED: `open_page COMPANY_DATA_ROOM` DENIED NOT_AVAILABLE, so the page never moves                                                                                                                             | **C**    |
| An unknown name is not navigated and not claimed                                      | GREEN                                                          | GREEN                                                                                                                                                                                                        | —        |

### Mocked and unit evidence (not browser)

- Unit: the lead reports `packages/q-runtime/test/message-result-blocks.test.ts` (G-D13) red without the fix and green with it; q-runtime 68/68. G did not rerun it.
- MOCK-only caveat: the voice rows prove the browser's own lifecycle (what it asks the realtime model to say, and when). They do not prove audio. LIVE stays **LIVE-PENDING** (`scripts/recovery/voice/LIVE-PROCEDURE.md`).
- Harness fixes during this work (void earlier voice verdicts):
  - manual browser contexts lacked the microphone grant;
  - the page fake used `#private` members, which Playwright's transpile could not run.
  - Before these fixes every MOCK duplex line fell back with CONNECT before reaching product code.
