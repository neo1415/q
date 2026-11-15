# Live re-check of the audit fixes on production 651a3bd50 (15 Nov 2026, 23:39–23:44 UTC)

Production: web, api, q-api and workers all on `651a3bd504` (Railway deployments SUCCESS 23:18 UTC; q-api `daaaf9c3`). Typed Q turns only, through the Ask Q composer at 1440 px, on fictional accounts: investor `investor.savanna-seed@fictional.capitalq.local` (Savanna Seed Partners), founder `founder.fb0005.ama-okafor@fictional.capitalq.local` (Watchly). The asks were paraphrases of the audit's failing shapes, not the audit's own words. Nothing was approved or sent.

Evidence: screenshots `docs/ai-handoff/evidence/2026-11-15-audit-fixes-live/{savanna,ama}-t<N>.jpg`. Counts come from `q_runtime.runs` (`routing`), `q_runtime.run_events`, `q_runtime.conversation_tool_results`, `ai_ops.model_usage` (per `q_run_id`) and the q-api log lines `q turn execution class`, `q answered a ranked list under the stated conditions`, `answered from this conversation's evidence` and `q answer produced`.

Conversations: investor `d9c6b173` (turns 1–5 and 9), founder `3cf7dcee` (turns 6–8).

## Summary

| #   | Ask (paraphrase)                                                                                       | Verdict                              | Class (log)                          | Tools stored / answer-stage | Model calls (rows) | First text / Q message complete | Audit baseline   |
| --- | ------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------------------------------------ | --------------------------- | ------------------ | ------------------------------- | ---------------- |
| 1   | "Of my best-fitting companies, which ones actually bring in revenue?"                                  | **FAIL** (RC2)                       | none: fast lane `FIT_BY_CODE`        | 9 / 0 model                 | 1 (summary only)   | 5.2 s                           | 10.9 s (ranking) |
| 2   | "Now show me the weakest fits that sit outside my sectors"                                             | **PARTIAL**                          | STRUCTURED_QUERY                     | 3 / lane 2                  | 3                  | 4.3 s                           | 10.9 s           |
| 3   | "Why the first one?"                                                                                   | continuity PASS; latency **PARTIAL** | CONTEXTUAL_FOLLOW_UP (digest reused) | 7 / 7                       | 5                  | 8.4 s / 12.6 s                  | ~10 s; 8 tools   |
| 4   | "Do I already have Ajopot in my pipeline?"                                                             | **FAIL** (RC4)                       | COMPLEX_ANALYSIS                     | 11 / 11                     | 4                  | 2.4 s / 8.0 s                   | 10.0 s           |
| 5   | "Get me ready for my meeting with Watchly"                                                             | **FAIL** (RC4)                       | none logged (meeting prep)           | 10                          | 5                  | 5.0 s (move line) / 10.4 s      | 10.9 s           |
| 6   | (founder) "Which investors are a good fit for us, but skip the ones I'm already in conversation with?" | **PASS** (RC2)                       | STRUCTURED_QUERY                     | 9 / lane 2                  | 4                  | 3.5 s                           | 12.8 s (founder) |
| 7   | (founder) "And the ones that fit badly?"                                                               | **PARTIAL**                          | CONTEXTUAL_FOLLOW_UP (digest reused) | 10 / lane 2                 | 4                  | 3.0 s                           | 14.6 s           |
| 8   | (founder) "What's the biggest gap we have right now, and which investor should I approach first?"      | **PASS** with a leaked line          | MULTI_SOURCE                         | 10 / 8                      | 5                  | 8.7 s / 13.3 s                  | 12.8 s           |
| 9   | "Change my usual cheque size to 600k"                                                                  | **FAIL** (D8 not reached)            | CONSEQUENTIAL_ACTION                 | 0                           | 5                  | 11.7 s                          | 9.0 s            |

"Tools stored" is the count of `conversation_tool_results` rows for the run; "answer-stage" is `toolCalls` from `q answer produced` or the conditioned-list line. Model calls are `ai_ops.model_usage` rows for the run: they include two turn-reader classification calls and one post-run conversation-summary extraction. "First text" is the stream's `firstTextMs` where logged; "Q message complete" is run creation to the first `q.message.completed` event. The baselines are the audit's recorded medians (`latency-before-after.md`, "before" column) for the matching class.

What works: the founder's condition lane (turn 6), digest reuse on follow-ups (turns 3 and 7), and two-part questions answered without a plan job (turn 8). Routing is now kept on the run for 8 of 9 runs. Readiness blocks did not appear and no internal agent names appeared.

What is still broken:

1. The first ranking turn of a new conversation goes through the `FIT_BY_CODE` fast lane before the turn reader runs. That skips the RC2 condition entirely and also leaves `runs.routing` empty.
2. Investor conditions are applied only to the list already shown.
3. A short follow-up still runs the wide records read, so it needs 7 tools, not ≤2.
4. Turn 4 contradicts the pipeline stage it states.
5. The meeting brief treats cancelled meetings as booked.
6. A cheque change worded as "usual cheque size" goes to the onboarding answer path. That card shows only the typical value, and the value is already 600,000.

## Per turn

### 1. Revenue condition on a ranked list (investor, new conversation). FAIL

- **Answer:** "Ranked by fit with your mandate, the top ten: MedTrail at 9.2, Mizan at 9.2, Silo Credit at 9.2, Ledgerfold at 9.2, Duplo at 9.1, Bumpa at 9.1, Watchly at 8.7, Ledgerline at 8.7, Portside at 8.7 and Rankpay at 7.2." There are ten cards.
- **Condition:** not honoured. Q did not mention revenue anywhere: no revenue state, no "revenue not known" naming, and no stated condition. This is the audit's `e8d59713` shape unchanged.
- **Cause (logs):** `q fast lane {lane: FIT_BY_CODE}`, then `q answered companies of a kind from the catalog {basis: FIT, toolCalls: 3, modelCalls: 0}`. No `q turn read`, no `q turn execution class` and no `q answered a ranked list under the stated conditions` line was logged, and `runs.routing` is `null`. The fast lane runs before the reader, which is where RC2's `listConditions` are read.
- **Tools:** `relationship.own.list`, `investor_mandate.get`, 6× `fit.top_candidates` (one `FAILED RESULT_TOO_LARGE`), `discovery.companies`.
- **Navigation:** stayed on Home. **Leaks:** none.

### 2. Weakest fits outside my sectors (same conversation). PARTIAL

- **Answer:** "Of the ten companies I just showed, I can't show you any that are outside your preferred sectors."
- **Condition:** read correctly. The log line `conditions {sector: OUTSIDE, order: WORST_FIRST}` shows it, and `shown 0`.
- **Problem:** the condition was applied to the ten shown, which were in-sector by construction (a mandate ranking). The person asked for the weakest out-of-sector fits, so Q needed to search the wider catalogue. Q returned no list and no offer to look wider.
- **Navigation:** none.

### 3. "Why the first one?" (contextual follow-up). Continuity PASS, latency PARTIAL

- **Answer:** "MedTrail is first because it is a 9.2/10 · Good fit against your mandate. It matches your seed stage, a preferred sector, B2B SaaS, your African focus and your cheque range…" This resolves to the first item of the turn-1 list, which is correct. Turn 2 showed nothing, so that is the right list.
- **Class:** `CONTEXTUAL_FOLLOW_UP`. Logged as `q account digest answered from this conversation's evidence {readByRun: e82bef95, ageMs: 10047}`.
- **Problems:**
  - The records lane still ran wide (`wide: true, namedCompanies: 2`), and the answer made `toolCalls 7`: `approvals.pending.list`, `relationship.own.list`, `schedule.list`, `company.get`, `relationship.get`, `q.work.list`, `fit.profile`. The expectation was ≤2.
  - 5 model-usage rows: 2 reader, 2 answer (`modelCalls 2`), 1 summary.
  - The reader set `research: EXPLICIT` for a question about the person's own records. No web call started (`webStarted: false`).
- **Latency:** first text 8.4 s, message complete 12.6 s, against the audit's ~10 s. First text is about 1.6 s faster. The complete answer is slower.
- **Other:** a "recommendation claims removed" filter dropped one sentence.

### 4. Ajopot already in my pipeline? FAIL (contradiction)

- **Stored stage:** `IN_DILIGENCE` since 3 Oct (`network.relationships`).
- **Answer:** "Yes—but only as a diligence item, not yet as a pipeline relationship. … From your records: Ajopot is in diligence since 3 Oct."
- **Verdict:** Q states the stored stage correctly, then contradicts it in the same answer: a relationship in diligence is a pipeline relationship. This is the audit's "relationship stated wrongly" shape, now as an internal contradiction.
- **Unrequested text:**
  - an account digest preface: "You have 13 relationships on Capital Q: 1 in diligence, 9 connected and 3 interest expressed. 2 are waiting on your reply."
  - "The public web search was unavailable this turn" on a records question.
- **Class:** `COMPLEX_ANALYSIS` (answer path `DEEP_ANALYSIS because RESEARCH`), 11 tools, `sharedReads 1`.
- **Navigation:** `OFFER_ONLY`, destination CRM pipeline. It stayed on the page, which is correct under decision 98.

### 5. Prepare for my meeting with Watchly. FAIL

- **Stored meetings:** all five Savanna–Watchly meetings in `communication.meetings` are `CANCELLED` (17, 19, 20 and 23 Nov). No meeting is upcoming.
- **Answer:** the brief says "A 30-minute introductory call was booked for Tuesday 17 November at 10:00 UTC; a later proposed Thursday 19 November slot also appears in the correspondence, so confirm which meeting is current." That presents cancelled meetings as booked or pending. The brief is drawn from correspondence, not from the meeting records. The rest of the brief (who they are, relationship CONNECTED, questions to ask) is grounded.
- **Navigation:** the page moved to `/rehearsals/company/<Watchly>` without being asked ("I've opened Rehearse with a company."; `q page move decided {decision: MOVE, page: COMPANY_REHEARSAL, navigation: CONTEXT}`). Under decision 98 this is arguable: rehearsal can advance "get me ready", but the person did not ask to rehearse. Flagged for owner judgement.
- **Class:** no `q turn execution class` line for this run (meeting-prep path). `routing.meetingPrep: true`.

### 6. Founder: fits, leaving out investors in conversation. PASS

- **Answer:** "Leaving out the two investors you're already talking to. Talk to Zino Aviation, Baobab Ridge Capital (fictional) and Gulf Horizon Family Office (fictional) first."
- **Exclusion check:** Watchly's relationships are The Vaultlyne (INTEREST_EXPRESSED) and Savanna Seed (CONNECTED). Neither appears in the text or the cards (checked in `result_blocks`).
- **Logs:** `conditions {relationship: EXCLUDE_IN_CONTACT, order: BEST_FIRST}, excludedInContact 2, shown 3, toolCalls 2, modelCalls 0`. `STRUCTURED_QUERY`, 3.5 s, against a founder baseline of 12.8 s. This is the P0 founder shape, fixed.
- **Minor:** Zino is "3 of 3 … you fit their published stage", yet their quoted focus says pre-seed and Watchly is seed. Turn 8 states this caveat itself.

### 7. Founder: "And the ones that fit badly?" PARTIAL

- **Answer:** "None of the investors I can check publishes criteria that say they'd be a poor fit for your company. The Vaultlyne, Chidi Nwosu Angel Investments (fictional) and Equator Line Capital (fictional) don't publish enough to tell either way."
- **Condition:** the answer differs from turn 6 and the worst-first order was read (`order: WORST_FIRST`, `shown 0`, `unknown 3`). Unknown fit is named as unknown, not as poor, which is correct.
- **Problem:** the turn-6 exclusion was not carried over (`relationship: null`), so The Vaultlyne, which they are already talking to, is named.
- **Class:** `CONTEXTUAL_FOLLOW_UP`, digest reused from turn 6 (`ageMs 11728`). Lane `toolCalls 2`, `modelCalls 0` in the answer; 3.0 s against a 14.6 s baseline.

### 8. Founder two-part question. PASS, with one leaked line

- **Answer:** both parts are answered. The gap: "The biggest gap Watchly has right now is commercial proof…". Who to approach first: "Zino has the clearest published alignment… stage fit should be tested early." No plan job was created (`routing.teamJob: false`; no plan row).
- **Leaked text:** the answer opens with "By the first one I mean Zino Aviation, first in the last list I showed you ("Investors to talk to first")." The person never said "the first one". The continuity resolver read "approach first" as an ordinal reference and printed its resolution note (P3).
- **Class:** `MULTI_SOURCE`. 8 answer tools, 13.3 s message complete, against a founder baseline of 12.8 s.
- **Navigation:** routing `CONTEXT/CAPITAL`, but no page move was logged.

### 9. Investor: "Change my usual cheque size to 600k". FAIL (D8 path not reached), not approved

- **Card:** "Update your profile · Typical cheque: 600,000", with Approve / Change it / Keep it with me / Drop (`savanna-t9.jpg`). The card has no minimum or maximum, no currency and no before → after.
- **Action:** `onboarding.answer.revise` on step `I2.cheque_typical`, payload `{type: RANGE, value: "600000"}`. It is not the mandate update that `651a3bd50` fixed. The log shows the model first chose `change_my_mandate`, the arguments were refused ("app action refused its read arguments; arguments read for it again"), and the re-read landed on the onboarding answer.
- **No-op:** the stored `I2.cheque_typical` is already 600000, so the proposal changes nothing, and Q did not say so. The mandate keeps USD 250,000–1,000,000 (version 25, untouched).
- **Text:** "I've proposed that for your approval. The card shows the details once it's saved" is confusing wording before approval.
- **Status:** the approval is left PENDING. It was not approved or dropped, and it expires 2026-11-16 23:43 UTC.
- **Class:** `CONSEQUENTIAL_ACTION`, 11.7 s, against a baseline of 9.0 s.

## RC5: routing kept on the run

`q_runtime.runs.routing` is populated on 8 of 9 runs: kind, question, research, tool, navigation, meetingPrep and the rest. It is `null` on turn 1's fast-lane run. The routing column does not carry the execution class, which is still only in the q-api log. The meeting-prep run (turn 5) logged no class at all.

## Incident during the run (fixed)

My driver's first attempt, at 23:35 UTC, typed the three investor asks into the Board's "Add a task to your board" field, which was the page's last textbox. That created three board items on the fictional Savanna account (`workspace.board_items` 08d007b5, ff18c13f, 98ed79b8). No Q runs were created. I removed all three through the board's own "Take off your board" control at 23:38 (`archived_at` set), then re-ran the asks through the Ask Q composer (placeholder "Ask Q"). Those are the turns reported above.

## Spend

`ai_ops.model_usage` for the two fictional users since 23:34 UTC: 55 rows, **$0.1143**. Recorded against reservation `9c7c2ccc` (ceiling $0.80).
