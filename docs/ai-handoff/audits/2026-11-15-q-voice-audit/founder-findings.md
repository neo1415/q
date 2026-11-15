# Deliverables C and D (founder): root causes, latency and speech recognition

Scope: the 7 founder sessions (F1–F7) in `founder-inventory.md` and 70 per-turn records in `founder-turns.jsonl`.

Method:

- Read-only hosted SQL and Railway logs. No model calls.
- Causes marked **hypothesis** are inferred from the data and code, not reproduced.
- Code locations are on the current checkout.
- Deployed SHA for the main voice session (F7): `84ac9afa7`.

## 1. Headline

- **Turns audited.** There are 60 owner turns:
  - 51 Q turns;
  - 2 voice-only turns;
  - 7 approvals.

  There are also 10 Q-initiated records.

- **Defects.** 66 defects were recorded on 46 records:
  - 1 P0;
  - 13 P1;
  - 27 P2;
  - 25 P3.
- **Verdicts over the 60 owner turns:**

  | Verdict          | False               |
  | ---------------- | ------------------- |
  | intent_ok        | 8                   |
  | answered         | 5                   |
  | grounded         | 7                   |
  | continuity_ok    | 12                  |
  | voice_consistent | 5 of 28 voice turns |
  | repeated         | 8                   |
  | action_state_ok  | 4                   |
  | asked_known      | 0                   |

- **Voice (F7, 15 Nov):** all 25 delegations were code-routed (the 14 Nov "code routes it" fix is live). Q's own answers were mostly grounded, and the Context Firewall held on all three private-information probes (F7-24..26).

  The failures sit in four places:
  1. **Fast lanes** that ignore the qualifier in the question.
  2. **Referent resolution** ("the first company").
  3. **Utterance segmentation**.
  4. **What the voice says around Q**: stacked holding lines, voice-only answers, and spoken text that differs from Q's final text.

## 2. Root causes, grouped (affected turns)

| #    | Root cause                                                                            | Turns                                                               | Severity     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Mechanism and code                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| RC1  | **Founder-side prospect fast lane ignores qualifiers (exclusion, inversion)**         | 2 (F7-09, F7-13); F7-14 follows from it                             | P0/P1        | F7-13 "leave out companies I'm already talking to" → Zino listed first (in diligence, messaged 1 min earlier). F7-09 "which would be poor fits" → the identical shortlist                                                                                                                                                                                                                                                                                                                                                         | The founder ranking is `packages/model-gateway/src/q/investor-prospects-answer.ts`, through `investor.prospects`. It deliberately puts already-interested investors first (`:23`, `:324`) and has no exclusion input. The v88 `excludeRelationships` fix (`fit-sweep.ts:79,231-242`; `index.ts:5346-5400`) covers the investor fit sweep only. Nothing checks the request's constraint against the answer. This is the founder twin of the 14 Nov audit's D1 |
| RC2  | **Ordinal or referent resolution not tied to a list; Q gives way when corrected**     | 4 (F7-20, F7-21, F7-22, F7-23)                                      | P1           | "The first company" became Chidi (first card of the latest list), then "Chidi was first in the earlier shortlist" (false). When the owner offered "Zino first, Chidi second", Q agreed (Chidi was third), then recorded that as the owner's correction                                                                                                                                                                                                                                                                            | No list-scoped referent in conversation state. The reply never says which list it means. A correction from the person is accepted without checking the stored shortlist (`msgs 44143374, 6aa4165d, 6577f83d, 341511c6`)                                                                                                                                                                                                                                      |
| RC3  | **Intent captured by the wrong specific path**                                        | 4 (F7-04, F7-05, F7-11, F5-02)                                      | P1           | "If you were preparing me for an investor meeting…" produced a call brief for QInvest, which has no relationship or meeting on record (twice). "I want to apply to Zino Aviation" produced a drafted chat reply that commits the founder to a 16 Nov 10:00 call. A two-part question became a plan job with no answer                                                                                                                                                                                                             | Call-prep port (`packages/q-specialists/src/call-prep.ts`, wired in `answer.ts:1077`). **Hypothesis:** the counterpart was picked from the word "investor/invest". Nothing routes "apply to <gateway owner>" to GateQ. The plan offer captured a question (F5-02)                                                                                                                                                                                            |
| RC4  | **Utterance segmentation**                                                            | 5 (F7-03, F7-05, F7-17, F4-04, F7-06)                               | P1–P3        | A corrected utterance was split in two (F7-05). It became two runs, `fddd8aa9` (QInvest again, spoken) and `5a30559e` (the correct answer, never spoken). A pause split "Thank you. Um. So" from its request (7.4 s handoff). Three utterances were bundled into one objective (F7-17). On 9 Nov one utterance was stored as 8 fragments                                                                                                                                                                                          | `apps/web/src/features/voice/live/bridge.ts:297` (quiet window before code routes) and `:299` (join window). A delegation is started on a partial utterance, and the continuation starts a second run instead of replacing the first                                                                                                                                                                                                                         |
| RC5  | **The voice says words Q did not decide**                                             | 9 records                                                           | P1–P3        | <ul><li>**Voice-only answers:** F7-15 and F7-16; the voice added "wasn't actually supported by complete evidence".</li><li>**Spoken differs from Q's final text** (F7-14): the voice admitted the failure, while the stored text says "I excluded Zino". The log shows first text at 8.4 s and the final answer at 30.6 s. **Hypothesis:** the early streamed draft was spoken and the final was then rewritten.</li><li>**Pre-announced navigation** (F4-04).</li><li>**Opening re-quoting the last request** (F4-02).</li></ul> | <ul><li>A "repeat that" request is handled by the voice model alone (no delegation).</li><li>Early partial words are spoken (`apps/q-api/src/voice/live/broker.ts:1603-1619`, `partialCommentary`) without reconciliation once the final arrives.</li><li>`apps/web/src/features/q/continuation.ts:73-91`.</li></ul>                                                                                                                                         |
| RC6  | **Holding lines from four sources stack up**                                          | 23 of 28 voice turns had ≥2; 13 had ≥3. 65 holding lines in total   | P3 (adds up) | Typical sequence: "Mm." / "Right." (model), then "Working on it." (bridge), then "Looking into Zino Aviation now." (Q stream), then "I'm checking what's public on Zino Aviation now." (research lead), then the answer                                                                                                                                                                                                                                                                                                           | <ul><li>`bridge.ts:283` (`HOLDING_LINE`, after 5 s, `:323`).</li><li>`packages/q-specialists/src/answer.ts:331` (`holdingLine`).</li><li>`packages/model-gateway/src/q/early-lead.ts:186-190` (`researchLead`).</li><li>The model's own acknowledgements.</li></ul> No single owner decides "at most one"                                                                                                                                                    |
| RC7  | **Long written answers read aloud in full**                                           | 4 (F7-01, -02, -03, -08)                                            | P1/P2        | F7-03: Q text at 17:25:47, spoken until 17:27:38 (1 min 51 s). Markdown headings and lists were read aloud                                                                                                                                                                                                                                                                                                                                                                                                                        | There is no separate concise spoken form. The voice speaks the whole text                                                                                                                                                                                                                                                                                                                                                                                    |
| RC8  | **Every follow-up re-runs the full context and often the public web**                 | 33 of 42 turns with a Q run                                         | P2 (latency) | <ul><li>33 of the 42 turns with a Q run re-read approvals, relationships, schedule and Q work.</li><li>39 of those turns re-ran `company.get` and `company.figures.read`.</li><li>25 of those turns re-ran `company.deck.read`.</li><li>8 turns ran `public_web.search`. Four were recall or ordering follow-ups (F4-03, F7-18, F7-20, F7-22). Three were private-information probes (F7-24..26; in F7-26 Q then said "public sources couldn't be checked"). One was a document edit (F1-18).</li></ul>                           | Wide reads are rebuilt per turn (`index.ts:4063-4080` per the 14 Nov audit). There is no turn-level reuse of the previous run's reads. Research lead fires on named-entity follow-ups                                                                                                                                                                                                                                                                        |
| RC9  | **Readiness block prepended to unrelated answers**                                    | 4 (F1-04, F1-13, F7-05, F7-06), plus F7-01 by design                | P2           | "What to do next for your raise, most important first: 1… 2… 3…" opens answers to "match each profile field" and "what would improve in 3 months". `5a30559e` and `52adfaf0` repeat steps 2–3 twice inside one message                                                                                                                                                                                                                                                                                                            | `packages/q-core/src/readiness-lead-copy.ts:112` (`planHeading`). The prefix is applied by answer type, not by request                                                                                                                                                                                                                                                                                                                                       |
| RC10 | **Unrequested navigation on follow-up questions**                                     | 4 (F1-11, F7-03, F7-06, F7-25); also inconsistent nav copy in F1-17 | P2/P3        | "I've opened Capital." was sent for "which problems are documentation fixes", and "I've opened Overview." for "how many people is Zino talking to". The voice then says "The page is coming up."                                                                                                                                                                                                                                                                                                                                  | Open owner decision (13 Nov C10 v85). The voice line comes from `apps/web/src/features/voice/live/move.ts:160`                                                                                                                                                                                                                                                                                                                                               |
| RC11 | **Voice approval of content that was not read aloud**                                 | 1 (F7-12)                                                           | P1           | The spoken line was cut at "on the card for your ap…". The person said "Yes", which was delegated (4.2 s), approved at 17:33:25 and sent at 17:33:26. The message body added a new commitment ("16 Nov 10:00 works for me") the person never stated or heard                                                                                                                                                                                                                                                                      | The approval binds to the payload, which is correct. But a spoken yes is accepted without the body or its consequential terms being spoken first. Related: D85 voice-yes (`held-accept.ts`)                                                                                                                                                                                                                                                                  |
| RC12 | **Two paths for one outbound reply; status messages contradict**                      | 3 (F1-03, F1-05, F1-08), plus the F1-10 digest                      | P2           | The direct draft was sent at 08:35:07. The plan step "approve, edit or decline the pending reply" then reported "replied to 0 people; 1 reply didn't send". The attention digest then listed both a due reminder and a failure for a reply already sent                                                                                                                                                                                                                                                                           | Workforce plan step and chat draft are not de-duplicated against the relationship's sent messages                                                                                                                                                                                                                                                                                                                                                            |
| RC13 | **GateQ interview takes facts without confirmation and without the canonical record** | 2 (F3-04, F3-06), plus F6-00                                        | P2/P3        | The revenue read-back "USD 2,300,000 … right?" was unanswered, the application was submitted 41 s later, and the fact was already stored. 50,000 customers and $2.3M revenue were accepted although the Nixo record says the users are not paying. Form amounts were stored keystroke by keystroke (2 → 20000 → 2000000)                                                                                                                                                                                                          | Submission is not gated on open read-backs. The interview context lacks the company's canonical figures                                                                                                                                                                                                                                                                                                                                                      |
| RC14 | **Session end and interruption**                                                      | 2 (F7-26, F4-04)                                                    | P2           | F7: `live voice line ended reason max_length recordedSeconds 1202` at 17:42:13, with no warning recorded. F4: the person spoke over Q, but the answer continued afterwards (**hypothesis:** barge-in did not cancel playback). Q's final answer was never spoken                                                                                                                                                                                                                                                                  | 20-minute live line cap                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| RC15 | **B1 mirror pollution (9 Nov, historical)**                                           | 2 (F4-02, F4-03)                                                    | P2           | One-word Q and USER fragments were written into the conversation                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Removed since: `broker.ts` comment "the voice's own lines are never written into Q's conversation"                                                                                                                                                                                                                                                                                                                                                           |
| RC16 | **Stale attention items**                                                             | 3 (F1-00, F1-01, F1-10)                                             | P2/P3        | A 6 Oct calendar invite was shown as "waiting for your reply" on 9 Nov                                                                                                                                                                                                                                                                                                                                                                                                                                                            | No staleness rule for attention items                                                                                                                                                                                                                                                                                                                                                                                                                        |

Smaller one-off defects are in the JSONL:

- a PDF document card for a 3-line reply;
- a plan title that is the raw typed text;
- a rehearsal left with status ACTIVE although adjourned;
- a triple greeting in the opening;
- a plan result not announced on the voice line;
- a decline that was not acknowledged.

## 3. Latency report (deliverable D)

### 3.1 How each timing was measured

Times are in seconds from the person's final transcript (voice) or the stored message (typed).

| Timing              | How it was measured                                                                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| End of speech       | **Not observable**                                                                                                                                              |
| Transcript final    | `voice_line_turns.spoken_at` (browser clock, clamped to the server's)                                                                                           |
| Handoff             | Run `created_at`                                                                                                                                                |
| First useful answer | First non-navigation Q message                                                                                                                                  |
| Artifact            | First finding, card or proposal                                                                                                                                 |
| First audio         | **Not observable.** The live line reports none; `voice turn timed` has `firstAudioMs null`, and `live-call.ts:622-645` sends turn latencies only for rehearsals |
| Spoken end          | `spoken_at` of the last Q segment                                                                                                                               |
| Total               | The later of spoken end and the final Q text                                                                                                                    |

### 3.2 Voice: 28 owner utterances

Values are median / p75 / max.

| Measure                  | Seconds                 |
| ------------------------ | ----------------------- |
| Handoff                  | 2.6 / 2.7 / 6.6         |
| **First useful answer**  | **14.2 / 17.9 / 33.1**  |
| **Total, to spoken end** | **25.9 / 45.6 / 135.2** |

From the q-api log, turns 10–25 only:

| Measure             | Seconds                      |
| ------------------- | ---------------------------- |
| Delegation time     | median 10.7, max 30.6 (n=15) |
| First streamed text | median 6.9, max 12.3 (n=13)  |

### 3.3 Typed: 17 owner turns

| Measure             | Seconds            |
| ------------------- | ------------------ |
| First useful answer | 11.1 / 16.0 / 24.2 |

### 3.4 By execution category

| Category                             | Channel | Turns | First useful answer s (med / p75 / max)  | Total s (med / p75 / max) | Holding lines |
| ------------------------------------ | ------- | ----- | ---------------------------------------- | ------------------------- | ------------- |
| A conversational (voice-only, no Q)  | voice   | 2     | —                                        | 13.1 / 14.5 / 15.9        | 0             |
| B account-state read                 | typed   | 3     | 3.4 / 6.8 / 10.3                         | 3.4 / 6.8 / 10.3          | 0             |
| C contextual follow-up               | typed   | 4     | 14.0 / 16.4 / 17.4                       | 14.0 / 16.4 / 17.4        | 0             |
| C contextual follow-up               | voice   | 12    | 15.6 / 17.7 / 33.1                       | 25.2 / 37.5 / 67.9        | 32            |
| D single-entity analysis             | typed   | 4     | 16.8 / 18.9 / 24.2                       | 16.8 / 18.9 / 24.2        | 0             |
| D single-entity analysis             | voice   | 4     | 23.3 / 25.0 / 25.4                       | **76.2 / 92.5 / 135.2**   | 10            |
| E multi-entity ranking (fast lane)   | typed   | 1     | 3.1                                      | 3.1                       | 0             |
| E multi-entity ranking (fast lane)   | voice   | 3     | 7.6 / 8.9 / 10.2                         | 23.3 / 36.9 / 50.5        | 6             |
| F external research / firewall probe | voice   | 3     | 12.5 / 14.4 / 16.4                       | 37.6 / 38.1 / 38.6        | 11            |
| G action draft / approval            | typed   | 2     | 9.4 / 10.3 / 11.1                        | 9.4 / 10.3 / 11.1         | 0             |
| G action draft / approval            | voice   | 2     | 13.8 / 17.6 / 21.3                       | 26.8 / 35.4 / 44.0        | 3             |
| H long-running job (acknowledgement) | typed   | 2     | 5.2 / 6.4 / 7.7                          | —                         | 0             |
| H long-running job (acknowledgement) | voice   | 1     | 5.4                                      | 17.4                      | 2             |
| I navigation                         | typed   | 1     | 11.2                                     | 11.2                      | 0             |
| I navigation                         | voice   | 1     | 11.3                                     | 11.3                      | 1             |
| J GateQ interview turn               | text    | 6     | 2.2 / 2.4 / 2.6 (`latency_ms` 2.0–2.7 s) | same                      | 0             |
| K rehearsal turn                     | voice   | 3     | 2.4 / 2.5 / 2.7                          | same                      | 0             |

Plan jobs: plan ready in 3 min 31 s (F5) and 3 min 30 s (F1); delivered 3 min 37 s after consent (F7).

### 3.5 Where the time goes

- **Real compute dominates time to answer.**
  - Each Q turn runs 4–13 model calls in sequence.
  - FAST_CLASSIFICATION calls take 1–2.5 s each, two to four per turn, before the answer model runs.
  - The answer itself takes 8–17.9 s: NORMAL_DIALOGUE up to 13.3 s, EVIDENCE_SYNTHESIS up to 17.9 s.
- **Reading the answer aloud dominates total time.** Single-entity analyses took a median of 76 s, against 23 s to the text answer.
- **Artificial waits are small.** Handoff is a median of 2.6 s (the quiet window). They grow with split utterances: 6.6 s, and 7.4 s in F7-03.
- **Some model calls are not linked to a run.** 131 classifier and dialogue calls in the F7 window have `q_run_id` null (purpose OTHER). They are a likely per-utterance routing cost that cannot be attributed: an instrumentation gap.

### 3.6 Holding lines

- 65 holding lines were spoken across 28 voice utterances.
- 23 utterances had two or more; 13 had three or more.
- None of them asked questions (the 14 Nov D6 fix holds). But "at most one" is not enforced across the four sources (RC6).

### 3.7 Follow-ups that re-ran a full investigation

- **Wide reads on almost every follow-up.** 15 of the 16 contextual follow-ups re-ran the full wide reads:
  - `approvals.pending.list`
  - `relationship.own.list`
  - `schedule.list`
  - `q.work.list`
  - `company.get` and `company.figures.read` (all 16)
- **Public-web searches.** Four follow-ups ran `public_web.search`:
  - F4-03 "run through them" (23.6 s, versus 3.1 s for the original answer);
  - F7-18 "main concern you raised";
  - F7-20 "back to the first company";
  - F7-22 "confirm the order".
- **What they could reuse.** None of them needed new external data. All of them could reuse the previous run's authorised reads and the stored shortlist. Any reuse must keep a permission re-check and a reads-since watermark.
- **Repeated answers (`repeated` = true, 8 turns).** These are the fast-lane re-answer (F7-09) and the readiness prefix (RC9).

## 4. Speech recognition and Nigerian-English distortions

| Heard                                                                                                  | Meant                                                                       | Turn              | Effect                                                      |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| "four deployed engineers" (×2)                                                                         | "forward-deployed engineers"                                                | F2-03 (rehearsal) | Persona tolerated it; would corrupt a saved fact            |
| "I'm not really telling me anything"                                                                   | "You're not really telling me anything"                                     | F7-11             | Harmless here; the complaint was not recognised as feedback |
| "That would also be an interference with the already laid down"                                        | Probably declining the offer as conflicting with the plan already laid down | F4-04             | The decline was not acknowledged                            |
| "Q invest"                                                                                             | QInvest (Q's own wrong counterpart, repeated back by the person)            | F7-06             | Shows the person heard Q's mistake correctly                |
| "Thank you. Um. So" / ", which problems…"; "I thought Zino Aviation was the first" / ". Just confirm…" | One utterance each                                                          | F7-03, F7-22      | Split at hesitation pauses ("Um."), which caused RC4        |
| "Um ." / "Uh ." with a space before the full stop; fillers kept in objectives                          | —                                                                           | 8 F7 turns        | Run objectives and plan titles carry the fillers            |

Names were transcribed correctly every time: Zino Aviation, Cape Meridian Growth, Chidi Nwosu, Tensorgate, Nixo. So were the figures ("$4m" spoken as "four million dollars"; "2.3 million", "50,000" in GateQ).

The failures are **pause segmentation on hesitation markers**, plus one domain-term distortion ("forward-deployed"). There is no evidence of misheard commands; the 14 Nov D12 kind did not recur.

## 5. Completeness (inventory vs audited records)

| Session   | Stored rows (messages + voice segments + GateQ + rehearsal) | Runs   | Records | Rows mapped | Missing |
| --------- | ----------------------------------------------------------- | ------ | ------- | ----------- | ------- |
| F1        | 55 messages                                                 | 17     | 19      | 55          | 0       |
| F2        | 8 rehearsal turns                                           | 0      | 5       | 8           | 0       |
| F3        | 13 GateQ turns                                              | 0      | 7       | 13          | 0       |
| F4        | 24 messages + 22 voice segments                             | 3      | 5       | 46          | 0       |
| F5        | 14 messages                                                 | 5      | 6       | 14          | 0       |
| F6        | 1 GateQ turn                                                | 0      | 1       | 1           | 0       |
| F7        | 57 messages + 102 voice segments                            | 25     | 27      | 159         | 0       |
| **Total** | **296**                                                     | **50** | **70**  | **296**     | **0**   |

Not audited as turns:

- 3 standing-instruction runs on Marcus Delgado (system-initiated, no owner input; listed in the inventory).
- 9 contactless GateQ applications with 0 turns (ownership unconfirmed).

Partially observable:

- end of speech and first audio, for every voice turn;
- q-api logs for F7 turns 1–9 and for all sessions before 15 Nov;
- the approval channel (card tap or voice), inferred for card approvals because `approvals` has no channel column;
- UI render times.

## 6. Missing instrumentation (named)

1. **Live-line timings.** The live line should send `stats.latenciesMs` and first audio for every line (`live-call.ts:622-645` sends them for rehearsals only), together with VAD speech-end.
2. **Run links for model calls.** `ai_ops.model_usage` should carry `q_run_id` (or the voice session) for per-utterance routing and classifier calls.
3. **Approval channel.** Add `channel` (CARD | VOICE | TEXT) to `q_runtime.approvals`.
4. **Spoken text per delegation.** Store the text the voice actually spoke for each delegation, so it can be compared with Q's final text (needed for RC5).
5. **Log retention.** Railway keeps only the last 5,000 log lines of the current deployment. Key voice timing lines should be persisted to the database.
