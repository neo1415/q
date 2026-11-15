# Deliverables C and D (investor): findings by root cause, and the latency report

This covers the owner's investor account `56e3adff` (Zino Aviation), 1–15 Nov 2026. There are 50 sessions (27 voice, 23 text) and 903 per-turn records, listed in `investor-turns.jsonl`. The inventory and reconciliation are in `investor-inventory.md`. All of this was read-only: no code was changed and no model calls were made.

**How to read the verdicts.**

- The verdicts are deterministic heuristics over stored rows: transcript coverage, number checks, correction and admission phrases, ranking templates, tool overlap and timings.
- 13 runs also got a manual verdict (the `reviewed: "manual"` field).
- `null` means the data cannot decide.
- `grounded` is `false` only where the next answer admits an error or a manual check found one. Grounding was not otherwise judged, so `true` is never asserted.
- The **I/O fix** is commit `1a512590c`, deployed with `30c99ccc5` on 15 Nov around 02:46. It makes code route every turn, makes the voice say Q's words exactly, stops the mirroring and coalesces the transcript. Only the 15 Nov sessions (4 voice sessions, 71 runs, 323 records) ran with it.

## Summary

|                                                                                              | 1–14 Nov                                                             | 15 Nov (after I/O fix)                                                                                       |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Records with any defect                                                                      | 202 of 580                                                           | 111 of 323                                                                                                   |
| Records with a P1 defect                                                                     | 75                                                                   | 12                                                                                                           |
| Voice-only lines that answered or claimed things without Q                                   | 53 voice-own lines (28 answers, 2 phantom actions, 14 own questions) | 7 short acknowledgements ("Mm.", "Noted", "I see", "I'll take that"), plus 1 work notice recorded separately |
| Substantive user utterances never routed to Q                                                | 35                                                                   | 1 (the call was replaced right after it)                                                                     |
| Voice runs whose spoken words matched Q's answer (`voice_consistent` true / false / unknown) | 23 / 21 / 6 of 50                                                    | 28 / 36 / 7 of 71                                                                                            |
| Q replies with `intent_ok` false                                                             | 20 of 171 runs                                                       | 10 of 71 runs                                                                                                |

The I/O fix removed the "second brain" pattern: the voice no longer answers on its own, mirrors itself into memory or fragments the transcript. The 15 Nov sessions show **a different set of voice defects** (RC2), which all come from words added _around_ Q's answer, plus two Q-side root causes (RC3, RC4) that the fix did not touch.

## Root causes (affected turns; severity is the worst on the turn)

### RC2 (open, P1/P2): the voice still adds words around Q's answer. 85 turns on 15 Nov, 8 earlier

| Defect                                     | Turns (15 Nov) | Mechanism and code location                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VOICE_SAID_MORE_THAN_HOLDING_LINE`        | 45 (45)        | **What happens:** the voice answers each utterance itself before code's holding line, with promises Q never made. Examples: "Okay. I'll keep them separate." (`v-ba525e32-004`), "Good angle. I'll get right to that.", "Sure. I'll frame it that way."<br>**Mechanism:** the realtime model still generates its own response at end of speech. The prompt allows "Small talk: reply in a few warm words" (`apps/q-api/src/voice/live/prompt.ts:174`). The bridge's only control is the instruction text: `HOLDING_CONTENT` (`apps/web/src/features/voice/live/bridge.ts:283-284`), sent after 5 s (`bridge.ts:445-452`). Neither the live code nor the bridge turns off the provider's automatic reply for routed turns: no `create_response`/turn-detection setting is present.                                                                  |
| `VOICE_CLAIMS_RESEARCH_NOT_IN_ANSWER`      | 23 (19)        | **What happens:** "I'm checking what's public on Halyard Security now." is spoken before almost every deep-dive answer. On 15 Nov **23 of 23** early web searches returned `PROVIDER_UNAVAILABLE` with 0 sources: Serper 402, and every provider was resting. The line was still said, often 30–60 s after it stopped being true. A second prefix, "Looking into <name> now." (`v-47e5ab44-017`: "Looking into Shiftwell now", while the answer was about Ajopot), is a streamed holding delta that is never stored.<br>**Mechanism:** `researchLead()` (`packages/model-gateway/src/q/early-lead.ts:186-190`) is published when the search call starts (`packages/model-gateway/src/q/index.ts:7455-7471`, `:8418-8422`), without checking whether any provider is available. The voice says the streamed start and the final answer as one line. |
| `VOICE_SAYS_COMING_UP`                     | 15 (10)        | **What happens:** Q said "Messages is ready to open" (an offer) and the voice said "Messages is coming up" (`v-47e5ab44-055`, run `ce9ce781`). The pre-fix cause was `prompt.ts:129`.<br>**Mechanism:** the say-exactly commentary gets the `moveNote(PENDING)` note prepended: "say it is coming up" (`apps/web/src/features/voice/live/move.ts:160`; also `live-call.ts:268`), through `beforeSpeak` (`live-call.ts:593`, `bridge.ts:456-463`). The two instructions contradict each other, so the voice adds words.                                                                                                                                                                                                                                                                                                                             |
| `VOICE_ADDED_OR_CHANGED_NUMBER`            | 7 (5)          | **What happens:** "€50,000–€100 million" became "**50 billion** to 100 million euros" (`v-47e5ab44-039`, run `2f1153d1`, a mandate the person was about to approve). Earlier cases: "four pitches" invented (1 Nov `v-f5d6c201-004`), and a raise amount added (14 Nov `v-eda5cd98-016`, D4).<br>**Mechanism:** the provider reads currency ranges aloud itself; the spoken line is not normalised for speech.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `SPOKEN_LINE_NOT_STORED` (instrumentation) | 8 (8)          | **What happens:** the voice said a line that differs substantially from Q's stored answer. Example: run `68231a5f`. The answer was "calendar expired"; the voice said "three suitable options… proposals only".<br>**Mechanism:** Q's separate spoken line (`said`/`fallback`) and the commentary sent to the voice are not persisted, so these turns cannot be checked word for word.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `VOICE_ADDED_WORDS`                        | 4 (4)          | **What happens:** short additions such as "Working on it." merged into the answer, and "good pick".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

### RC3 (open, P1): the fit lane answers constrained ranking questions with the plain mandate ranking. 5 turns, plus repeats and challenges

- **Seen:**
  - "show me the ones with actual revenue", run `e8d59713`;
  - "pre-revenue but unusually strong reasons", run `81dea17d`;
  - "outside my preferred sectors", run `30d18535`;
  - "you're not answering my question… which of t[hose]…", run `a544665e`;
  - 14 Nov "leave out the ones I'm in contact with", run `bba40261` (D1).
- **What Q said:** each got "Ranked by fit with your mandate, the top ten: Nixo at 10, Halyard Security at 10, Tensorgate at 10…".
- **What followed:** the person said "That's not the question I asked you" (`v-47e5ab44-083`), and the next run admitted the error (`ee4832ee`). 4 of the 14 `REPEATED_ANSWER` turns are this template (the other 10 are the 1 Nov "couldn't read" repeats; see RC7).
- **Mechanism:**
  - `packages/model-gateway/src/q/fit-sweep.ts:105-120`: `FIT_CUE` plus `SET_CUE` match any "strongest/best … companies" wording.
  - `:173-180`: the ask carries only scope, place, `excludeShown` and (since `949e17aa4`, 15 Nov 04:41) `excludeRelationships`.
  - `:415-428`: no revenue state, sector-out, pre-revenue or "different from what you showed" filter exists.
  - The lane answers before the turn reader's full reading is applied, and nothing checks the answer against the stated constraint (the 14 Nov audit, item 3).
- **Fixed in the meantime:** the contact exclusion (D17).

### RC4 (open, P2): latency. Every turn runs the wide read set; follow-ups repeat it. 105 turns (38 on 15 Nov)

`SLOW_SIMPLE_TURN` covers 78 records: a lookup, follow-up, navigation or consent took more than 10 s to the first useful answer. `SLOW_VOICE_TURN` covers 20: the first spoken answer came more than 20 s after the person stopped. `FOLLOW_UP_REINVESTIGATED` covers 30. `VOICE_RELAY_LAG` covers 7.

**What the 15 Nov q-api logs show:**

- Each run makes a median of **6 model calls** (p75 7, max 12):
  - the turn reader, about 2.4 s median, plus 2–3 extra `FAST_CLASSIFICATION` page-move "samples";
  - the answer model, 7.4 s median, up to 20 s;
  - post-answer `STRUCTURED_EXTRACTION`.
- Each run makes a median of **12 tool calls** (p75 15, max 21). The account digest reads run on every turn: `approvals.pending.list`, `relationship.own.list`, `q.work.list` and `schedule.list`. Deep answers offer the model 113 tools (`q answer path DEEP_ANALYSIS because UNREAD tools 113`).
- 64 of 71 runs had at least one read answered from what the person had already read, so the cache works for single company reads.
- **But** 30 of 35 short contextual follow-ups (and 163 of 208 turns within 5 min of another) repeated at least 3 of the previous turn's tools with at least 5 calls. The repeated tools were the digest reads ×30, `relationship.get` ×24, `company.get` ×15, `company.search` ×8 and `company.figures.read` ×7.
- On 15 Nov every research-category turn also tried the public web again although every provider was resting (RC2), and the turn waited on the "searched public sources" stage.

**The voice delegation itself:** the round trip has a median of 12.5 s (p75 15.9 s, max 25.6 s). The verified start of the answer is streamed to the voice early (`bridge.ts` `speakStart`), so the estimated start of the spoken answer is close to Q's first useful text: a median of −4.3 s and p75 +1.7 s (n=68). The 7 `VOICE_RELAY_LAG` turns (more than 8 s) waited for the full delegation, which includes post-answer extraction and an approval card in run `2f1153d1`. The problem is not a relay buffer. Most of the wait is upstream: the reader, the wide reads and the answer model.

### RC1 (fixed 15 Nov by `1a512590c`): the live voice decided and answered by itself. 98 turns before 15 Nov, 3 on 15 Nov

- **Defects and counts:**
  - `REQUEST_NOT_ROUTED_TO_Q` 35;
  - `VOICE_ANSWERED_WITHOUT_Q` 28;
  - `VOICE_ADLIB_QUESTION` 14 plus 9 while Q worked;
  - `VOICE_PARAPHRASE_DIVERGED` 18;
  - `VOICE_PHANTOM_PROGRESS_OR_ACTION` 2;
  - `NUDGE_NOT_ROUTED_TO_Q` 1 (14 Nov "I'm waiting", D3);
  - `VOICE_DROPPED_SCOPE_QUALIFIER` 1 (D5).
- **Examples:**
  - 1 Nov: an off-topic chat answered by the voice for 30 s (`v-f5d6c201-044…054`).
  - 5 Nov: a personal exchange answered by the voice and mirrored into Q (`v-8b1b1c60`).
  - 9 Nov: "I'm pulling your pipeline now. Anything in particular you're most concerned about?" (`v-e73f6133`).
- **Mechanism:** this is the 14 Nov audit's P0: the voice model chose whether to delegate and spoke "in your own words".
- **Evidence the fix holds on 15 Nov:** 1 unrouted substantive utterance (`v-ba525e32-087`, lost because the call was replaced 20 s later), 0 voice-own answers, 0 phantom actions.

### RC5 (fixed 15 Nov): voice lines mirrored into Q's memory, a fragmented transcript, and a resume opening that quoted fragments. 46 turns, all before 15 Nov

- `VOICE_LINE_MIRRORED_INTO_Q_MEMORY` 24: there were 55 mirrored USER copies and 99 non-published Q rows before the fix, and 0 on 15 Nov.
- `TRANSCRIPT_FRAGMENTED` 26: the 1 Nov session stored 435 segments, mostly 1–3 words.
- `RESUME_OPENING_QUOTES_FRAGMENT` 5: "We were on '…'".

### RC6 (P2, mostly 7–9 Nov text): binding references and navigation

These are 13 turns:

- `NAVIGATION_NOT_DONE` 7: "I can't open … from here", for example `t-b53f60b2-11-08_06-58-010` (Nixo's profile) and `t-524259df-11-05_07-53-016`.
- `WRONG_TARGET_NAVIGATION` 2: "take me [to] tensorgate's profile" opened the person's own profile. "Their elevator" opened Tensorgate's while Spheros was the subject.
- `WRONG_REFERENCE_BINDING` 1: "about me" became Clearwater Assurance.
- 3 others: a typo, a misheard "ate"/GateQ, and a clarification that was not needed.
- **15 Nov:** "show me the pitch for the next one" and "go back to the previous one" took 3 turns to land (`v-ba525e32-009…020`). The person corrected twice ("This is Halyard Security pitch deck. I asked…").
- **Mechanism:** "next/previous" over a shown set and possessive targets are resolved by the page-move reading and the reference binder. These logs exist only for 15 Nov.

### RC7 (fixed or historical, P1): failures and leaked internal text. 15 turns

- `TURN_NOT_READ_GENERIC_FAILURE` 9: all on 1 Nov 15:18–15:23. Every take-me-home or CRM request got "Sorry, I couldn't read that request just now". This was the OpenAI-credit outage that `b10cd6c87` (1 Nov 17:30) fixed.
- `RUN_FAILED` 1: `RUN_CANCELLED` on 10 Nov, D11.
- `PROFILE_EDIT_FAILED` 3 and `INTERNAL_TEXT_LEAKED` 4 (9 Nov): "That doesn't fit: expected at least one field to update" was shown three times. On 7 Nov there was third-person internal wording: "The user had been discussing Spheros", "on the person's screen".

### RC8 (P1/P2): grounding and account-state errors the person had to correct. 20 turns (8 on 15 Nov)

- `WRONG_OR_MISREAD_ANSWER_ADMITTED` 5:
  - 15 Nov: Q said Tensorgate "hasn't accepted" (run `a3bbe2e4`), then "You're right — I got that wrong" (`ce9ce781`).
  - 15 Nov: the pre-revenue ranking (RC3).
  - 14 Nov: the "Clearwater" ranking (D5).
- `USER_CORRECTED_OR_CHALLENGED` 12.
- `WRONG_RELATIONSHIP_STATE` 1: 9 Nov, Q said "not connected yet" and drafted an expression of interest for **Nixo, an invested relationship** (`t-55d45f25-11-09_14-53-008`).
- `RESEARCH_NOT_RUN` 1: "find paystack online now" was answered from Capital Q results.
- `OWN_FIRM_FACT_MISSED` 1.
- `PERSON_HAD_TO_REPEAT` 1.
- **Mechanism (15 Nov Tensorgate case):** the answer read relationship status ("waiting for acceptance") and not the conversation, which had moved on. The account digest added on 15 Nov had not yet reached the reasoning about that relationship.

### RC9 (P2): Q's answer never spoken. 8 turns (3 on 15 Nov)

A newer request superseded the answer, or the call ended. Examples: `bdd2ef8f` (Tensorgate's message) and the meeting proposal `4197ff94`. The bridge keeps superseded answers as "thinking" (`bridge.ts:545-556`), so the person never hears that the earlier request finished.

### Other (15 Nov)

`WORK_PRODUCT_PLACEHOLDER` (1): a background memo was announced mid-call as "Your Preliminary Investment Memo — Target Company Required is ready" (`v-ccc0cd0d-041`). The memo job ran without a subject.

## Latency report (Deliverable D, investor)

Timings are measured from the person's last transcript segment for voice, or from the typed message for text. Read the numbers with these limits:

- `spoken_at` is the browser time a final transcript segment arrived (`live-call.ts:670`), so it marks the **end** of that audio.
- On 15 Nov a whole voice line is one segment. Its audio start is therefore _estimated_ as `spoken_at − 82 ms × characters`. The rate was fitted on 15 Nov relays (lag against length, r = 0.77).
- Before 15 Nov, segments were word-level, so the start is known to within about 1 s.
- Pre-fix "first spoken answer" includes the voice's own paraphrase, which often began before Q's text.
- "Total" runs to the end of the spoken answer for voice, or to run completion for text.
- Text `X_action` totals include the time the person took to approve.

**voice, 1–14 Nov (pre I/O fix)** (50 Q runs)

| Category       | n   | first useful answer med / p75 / max (s) | first spoken answer (est.) med / p75 / max | total (to spoken end or run end) med / p75 / max | with holding line |
| -------------- | --- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------ | ----------------- |
| C_compare_rank | 4   | 21.9 / 21.9 / 28.4                      | 8.8 / 22.4 / 22.4                          | 33.6 / 33.6 / 37.0                               | 3/4               |
| F_follow_up    | 10  | 12.8 / 19.2 / 22.1                      | 7.1 / 12.6 / 21.1                          | 22.1 / 25.7 / 45.0                               | 6/10              |
| L_lookup       | 29  | 10.2 / 14.1 / 23.5                      | 5.7 / 13.2 / 20.1                          | 16.6 / 29.8 / 95.9                               | 17/29             |
| R_research     | 5   | 10.9 / 13.4 / 14.3                      | 7.6 / 9.5 / 9.7                            | 38.4 / 42.7 / 65.9                               | 5/5               |
| X_action       | 2   | 9.2 / 9.2 / 9.2                         | 10.5 / 10.5 / 10.5                         | 15.1 / 15.1 / 15.1                               | 2/2               |
| **all**        | 50  | 10.9 / 14.3 / 28.4                      | 5.8 / 10.5 / 22.4                          | 20.0 / 32.7 / 95.9                               | 33/50             |

**voice, 15 Nov (after I/O fix)** (71 Q runs)

| Category       | n   | first useful answer med / p75 / max (s) | first spoken answer (est.) med / p75 / max | total (to spoken end or run end) med / p75 / max | with holding line |
| -------------- | --- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------ | ----------------- |
| C_compare_rank | 10  | 12.5 / 18.8 / 27.7                      | 8.7 / 9.9 / 44.8                           | 28.1 / 42.0 / 85.8                               | 10/10             |
| F_follow_up    | 8   | 13.5 / 14.0 / 26.3                      | 4.7 / 12.1 / 28.8                          | 22.4 / 24.9 / 69.8                               | 7/8               |
| L_lookup       | 19  | 15.3 / 19.5 / 29.2                      | 12.0 / 16.3 / 38.2                         | 30.4 / 42.0 / 79.2                               | 19/19             |
| N_navigation   | 2   | 7.6 / 7.6 / 7.6                         | 9.3 / 9.3 / 9.3                            | 30.4 / 30.4 / 30.4                               | 2/2               |
| R_research     | 28  | 17.2 / 20.6 / 26.9                      | 10.0 / 22.6 / 43.8                         | 51.0 / 63.6 / 86.5                               | 28/28             |
| X_action       | 4   | 24.7 / 24.7 / 25.1                      | 24.5 / 30.3 / 30.3                         | 73.8 / 73.8 / 79.6                               | 4/4               |
| **all**        | 71  | 15.6 / 20.3 / 29.2                      | 9.5 / 19.3 / 44.8                          | 39.8 / 60.3 / 86.5                               | 70/71             |

**text, 1–14 Nov** (121 Q runs)

| Category       | n   | first useful answer med / p75 / max (s) | first spoken answer (est.) med / p75 / max | total (to spoken end or run end) med / p75 / max | with holding line |
| -------------- | --- | --------------------------------------- | ------------------------------------------ | ------------------------------------------------ | ----------------- |
| C_compare_rank | 6   | 8.2 / 8.4 / 11.0                        | n/a                                        | 8.3 / 8.6 / 11.2                                 | n/a               |
| F_follow_up    | 17  | 10.0 / 14.7 / 26.2                      | n/a                                        | 10.1 / 14.7 / 26.3                               | n/a               |
| L_lookup       | 66  | 9.8 / 13.2 / 29.1                       | n/a                                        | 10.0 / 13.3 / 29.2                               | n/a               |
| N_navigation   | 7   | 1.4 / 2.3 / 6.3                         | n/a                                        | 1.6 / 2.4 / 7.4                                  | n/a               |
| R_research     | 9   | 10.7 / 15.2 / 21.7                      | n/a                                        | 10.8 / 15.3 / 21.8                               | n/a               |
| X_action       | 16  | 8.4 / 116.8 / 832.2                     | n/a                                        | 145.6 / 823.7 / 83291.7                          | n/a               |
| **all**        | 121 | 9.5 / 14.0 / 832.2                      | n/a                                        | 10.0 / 15.8 / 83291.7                            | n/a               |

Holding lines: 176 voice lines while a Q run worked (53 before 15 Nov, 123 on 15 Nov; on 15 Nov 78 were only "Working on it." or a one-word acknowledgement, 45 added the voice's own words).

Short contextual follow-ups: 35; 30 re-ran the wide read set (≥5 tool calls, ≥3 tools repeated from the previous turn within 5 min). Tools most often repeated: approvals.pending.list ×30, relationship.own.list ×30, q.work.list ×30, schedule.list ×30, relationship.get ×24, company.get ×15, company.search ×8, company.figures.read ×7.
Across all categories, 163 of 208 turns that followed another turn within 5 min repeated ≥3 of its tools with ≥5 calls.

15 Nov stage timings from q-api logs (71 runs): turn reader 2.4 / 4.1 / 8.3 s (med/p75/max, n=58); answer model 7.4 / 10.9 / 20.0 s (n=45); live delegation round trip 12.5 / 15.9 / 25.6 s (n=71); model calls per run 6 / 7 / 12; tool calls per run 12 / 15 / 21; 64 runs had at least one read answered from what the person had already read (cache hit).

**Headline:**

- After the fix, a voice turn takes a **median of 15.6 s to Q's first useful text** (p75 20.3 s).
- The first spoken answer starts at about **9.5 s** (p75 19.3 s, max 44.8 s). That start is often the stale research lead or the voice's own acknowledgement, not the answer.
- A full spoken turn takes a median of **39.8 s** (p75 60.3 s).
- 70 of 71 runs had a holding line.
- Research-category turns (28 of 71) had a median total of 51 s, with 0 public sources found.
- Text turns: a median of 9.5 s to the first useful answer. Navigation took 1.4 s.

**Real compute and waits:**

- **Real compute:** the turn reader (2.4 s median), the answer model (7.4 s) and 6 model calls per turn. The page-move samples and post-answer extraction run sequentially in the delegation path.
- **Waits:** the streamed start reaches the voice early, but the rest of the answer arrives only when the whole run ends. A web search that fails instantly adds no time. Its _lead line_ is the problem: it is spoken anyway.
- **Holding lines:** 176 in total. On 15 Nov, 78 of 123 were only "Working on it." or one word, and 45 carried the voice's own commitments (RC2).

## Instrumentation gaps (named per directive)

1. **Commentary text sent to the voice is not persisted.** Without it, `voice_consistent` cannot be checked for 8 turns on 15 Nov, and it is unknown whether "Looking into X now" came from Q or from the voice.
2. **No audio start or end times.** `voice_line_turns.spoken_at` is the time the transcript arrived. Add the start of response audio and the end of playback to the transcript report.
3. **No run id on voice lines.** The relay and holding links to runs are inferred from time and text overlap. Add `run_id` (or the delegation id) to `voice_line_turns`.
4. **q-api logs are lost when a deployment rotates.** Routing, turn-reader and page-move evidence exist only for 15 Nov. Persist the per-run reading, lane, page-move decision and stage timings (for example on `run_events`).
5. **Fast-lane navigation receipts and card presses are not stored**, so 5 voice "It's open" receipts and 6 card actions are inferred.

## Files

- `investor-inventory.md`: deliverable A.
- `investor-turns.jsonl`: deliverable B, 903 records.
- `investor-findings.md`: this file, C and D for investor sessions.
