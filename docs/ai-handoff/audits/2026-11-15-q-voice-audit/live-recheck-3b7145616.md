# Live re-check of the audit fixes on production 3b7145616 (16 Nov 2026, 01:13–01:16 UTC)

Production: web, api, q-api and workers on `3b7145616` (gate `ci-local PASS` 01:02 UTC; Railway SUCCESS for all four by 01:13 UTC; rollback point `651a3bd50`). Typed Q turns at 1440 px on fictional accounts only: investor Savanna Seed Partners, founder Watchly. The asks were reworded from the 651a3bd50 re-check, so they are not the same sentences. Nothing was approved or sent; the cheque proposal was left to expire. Model cost: 35 usage rows, USD 0.14 (ledger reservation `45f9e8e5`).

Evidence: screenshots `docs/ai-handoff/evidence/2026-11-16-recheck-3b7145616/`; counts from `q_runtime.runs.routing`, `q_runtime.conversation_tool_results` and `ai_ops.model_usage`. Conversations: investor `2bcaf38d` (T1–T3) and `ec523480` (T4, T5, T9); founder `ab80bf74` (T6, T7').

| #   | Ask                                                                                    | 651a3bd50 | 3b7145616 | Evidence                                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------------- | --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | "Among my top-ranked companies, which have real revenue coming in?"                    | FAIL      | **PASS**  | Reader lane (`lane: READER`, `STRUCTURED_QUERY`); 10 of 23 with revenue on record, 13 named as unknown rather than excluded as "no"; routing recorded.                                                         |
| T2  | "Then the worst fits outside the sectors I invest in"                                  | PARTIAL   | **PASS**  | "None of the ten companies I just showed … so I looked wider": 45 checked, Baridi 6.2 weakest first. Grammar slip "one has … and are" (fix queued).                                                            |
| T7  | revenue condition carried to T2                                                        | FAIL      | **PASS**  | T2 kept "revenue on record" from T1 without restating it.                                                                                                                                                      |
| T8  | "Why is the first one there?"                                                          | FAIL      | **PASS**  | Resolved to Baridi (first of the last list) and named MedTrail as the first of the earlier list in case that was meant.                                                                                        |
| T3  | same turn: cost of a contextual follow-up                                              | PARTIAL   | **FAIL**  | `COMPLEX_ANALYSIS`, `research: EXPLICIT`, 8 tools incl. `public_web.search`, 2 dialogue calls, 11 s, opened the company profile. The card path covers fit cards only, not a conditioned list. Fix in progress. |
| T4  | "Is Ajopot one of the companies I'm already working with?"                             | FAIL      | **PASS**  | "No … no relationship or expressed interest recorded"; diligence request of 15 Nov described as diligence, not a relationship.                                                                                 |
| T5  | "Prepare me for the Watchly meeting"                                                   | FAIL      | **PASS**  | "No meeting is booked with Watchly; the calls on 17 Nov, 19 Nov, 20 Nov and 23 Nov were cancelled."                                                                                                            |
| T9  | "Set my typical cheque to 750k"                                                        | FAIL      | **PASS**  | Mandate card: "USD from 250,000, typically 600,000, up to 1,000,000 → USD from 250,000, typically 750,000, up to 1,000,000"; approval pending, not approved.                                                   |
| T6  | (founder) "Which investors suit us best, excluding the ones we're already talking to?" | PASS      | **PASS**  | Two current investors left out; 3 ranked. Opens with an unprompted "I can't share other investors' interest or cheque sizes" line (fix queued).                                                                |
| T7' | (founder) "And which suit us worst?"                                                   | PARTIAL   | **PASS**  | Exclusion carried; says none publishes criteria that make a poor fit, and names two that publish too little.                                                                                                   |

Other findings (queued in the same fix): navigation messages read as raw page titles ("I've opened Company profile.", "I've opened Relationship.").

## Follow-up on `9913a5b64` (16 Nov, 02:27 UTC; gate PASS 1411 s; Railway SUCCESS ×4 by 02:26 UTC)

Re-asked with new wording (investor `20b55202`, founder `2997ffe6`; USD 0.16, ledger `590cea84`).

- "Why is that one at the top?" after a one-item worst-first list: answer correct and in place. Routing `CONTEXTUAL_FOLLOW_UP`, `research: NEVER`, `navigation: NONE`, `researchGuard: SHOWN_LIST_ITEM`. No web search, no page move. **Still PARTIAL on cost:** 7 record tools, 1 answer call, 9.6 s; the answer-from-card path did not fire. A fix is in progress.
- Count-one grammar: "one has revenue on record and is outside your preferred sectors". PASS.
- Founder "Which investors match us best, not counting the ones we already have conversations with?": no unprompted withholding line. PASS.
- The widened list no longer said "None of the … I just showed …, so I looked wider" on this run; this is being checked in the same fix.

## Follow-up on `cb28c00e5` (16 Nov, 03:37 UTC; gate PASS 1422 s; Railway SUCCESS ×4 by 03:36 UTC)

Investor `a7a6d845`, new wording; USD 0.19 (ledger `e3ba7982`).

- Widened list: the "None of the ten … so I looked wider" preface was present. PASS.
- "Why is it there?" (after the one-card list): the answer was correct, but the turn reader read "there" as a place. It routed `navigationDestination: DISCOVER` and `research: EXPLICIT`; the page moved to Discover with "I've opened For you."; 4 tools, 6 model calls, 14.5 s. **FAIL** (decision 98).
- "And why is MedTrail ranked first in the earlier list?": the answer was correct (tied at 9.2, ordered by mandate fit, not revenue). It ran wide: 31 tools, 8 model calls, 12.3 s. **FAIL** on cost.
- Cause: each fix covered the previous run's wording. The fix in progress enforces one principle in code after the reader:
  - A "why/how is X placed" question about any list Q showed in the conversation is answered from that card and list.
  - Such a question never researches unless the person asks about the web.
  - It never navigates unless the person asks to open a page.
  - The fix is tested on unseen paraphrases.

## Follow-up on `6f9b63cc5` (16 Nov, 05:44 UTC; gate PASS 1439 s; Railway SUCCESS ×4 by 05:43 UTC)

Investor `3594f160`, unseen wording; USD 0.16 (ledger `b8ee0890`).

| Ask                                                         | Result                                                                                                                                                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Which companies that match my mandate already make money?" | 10 of 23 with revenue on record; unknowns named. PASS                                                                                                                                       |
| "Narrow that to the weakest ones beyond my sectors"         | "None of the ten … so I looked wider"; Baridi 6.2, weakest first. PASS                                                                                                                      |
| "How come it made the list?"                                | Correct (the filter asked for; sector mismatch, partial geography). `CONTEXTUAL_FOLLOW_UP`, `research: NEVER`, `navigationGuard: SHOWN_LIST_EXPLANATION`, **0 tools**, stayed on Home. PASS |
| "What put the second one in the first list above the rest?" | Mizan, correctly not "above the rest": tied at 9.2 with three others. 0 tools, in place. PASS                                                                                               |
| "Open Baridi's profile" (negative)                          | "Opening Baridi…", moved to the profile. PASS                                                                                                                                               |

Correctness, routing and navigation now hold for unseen wording. **Latency is still open:** each explanation took 13–15 s with no tools. The time goes to:

- the reader and a third classification call (2.0 s + 0.3 s + 1.4 s);
- one answer call of 7.3–7.8 s, whose text is delivered only at `q.message.completed` (12.2 s and 14.5 s), not streamed.
  That is the next latency item (deliverable D).

## Timing on `aa4f4158f` (16 Nov, 08:13 UTC; gate PASS 1810 s; Railway SUCCESS ×4 by 08:11 UTC)

Investor `2ce90e2c`, unseen wording ("Show me my strongest fits" → "Why is the third one ranked there?" → "How come the first one leads?").

- Both explanations were correct: Silo Credit third at 9.2; MedTrail "does not lead", tied at 9.2 with three others. Both used 0 tools and stayed in place.
- Whole run, including the post-run summary call: **7.0 s and 4.4 s**, against 13–15 s on `6f9b63cc5`.
- The answer call took 2.9 s and 1.6 s, against 7.3–7.8 s. No arrival skim or second document search ran.
- The browser's first visible text arrives at about 2.6–2.8 s on every turn.
