# K Tests 1–7: first run, integration e4565008

**Label: LOCAL-E2E (MOCK).** Provider keys were `disabled-locally-000000000000`, the egress guard was on, and no live calls were made. The world was seeded locally. The run was `--project knowledge` on 2026-10-09, 17:46–18:00 UTC. B and D are not merged yet, and the budgets are provisional (`BUDGET` in `tests/recovery/support/knowledge.ts`).

| Test                               | Result                     | Why                                                                                                                                                                                                                     |
| ---------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1 as seeded (11 declared fintech) | EXPECTED RED               | The turn calls the analyst (TURN_READER + COMPANY_ANALYST), and no cards come back.                                                                                                                                     |
| K1 0 / 1 / 2 fintech               | EXPECTED RED               | No cards come back. For 1 and 2, the answer does not say there are fewer than three. 0 is honest (the analyst's text names none).                                                                                       |
| K1 browser, first card             | EXPECTED RED               | No card renders within 90 s.                                                                                                                                                                                            |
| K2 mandate recall                  | EXPECTED RED               | One analyst call per ask, and the declared sectors are not named.                                                                                                                                                       |
| K3 current page                    | GREEN (annotation removed) | The run's subjects and the model's context carry the page's company, and the turn is within budget.                                                                                                                     |
| K4 change propagation              | **UNEXPECTED RED, G-D23**  | `propose_profile_answer_change` returns `PREPARED`, "Update your profile", yet no `q_runtime.actions` or approvals row is written and the run ends COMPLETED. There is nothing to approve, so the change cannot happen. |
| K5 continuity                      | EXPECTED RED               | No cards to click (blocked behind K1).                                                                                                                                                                                  |
| K6 ×3 security                     | GREEN                      | No sentinel appears in another person's model input or run, cold or warm. Cross-tenant reads are refused.                                                                                                               |
| K7 idempotent double submit        | GREEN                      | Two submits with the same key produce one run.                                                                                                                                                                          |
| K7 three concurrent discoveries    | EXPECTED RED               | Each run made its own analyst call (3 in total), and no cards came back.                                                                                                                                                |
| K7 discovery during a model outage | EXPECTED RED               | The run does not complete without a model.                                                                                                                                                                              |
| K7 run caught by a q-api restart   | **UNEXPECTED RED, G-D24**  | The run stayed in `SYNTHESIS` for more than 6 minutes after q-api restarted, with no terminal state and no failure code. An orphaned run is never ended.                                                                |

## Defects

- **G-D23 (owner B or D).** Repro:
  1. Script the analyst to call `propose_profile_answer_change {field:"sectors", value:["Agritech"]}` for the investor `savanna-seed`.
  2. The tool output is `{"status":"PREPARED","awaitingApprovalOf":"Update your profile"}`.
  3. GET /v1/q/approvals has nothing new, and `q_runtime.actions` has no row after 02:03Z.
- **G-D24 (owner F).** Repro:
  1. Start a run whose analyst request hangs.
  2. Run `local-stack.sh stop q-api`, then `start q-api`.
  3. The run never reaches a terminal state.

## Harness notes

- The first run's K1 0/1/2 fixture tripped over psql's `UPDATE n` tag. It was fixed and the run repeated, and the rows were restored and verified (11 declared fintech, no duplicate ACTIVE rows).
- K2 and K4 restrict sectors to the industry, product_category and technology vocabularies. Geography was excluded.
- The analyst is a scripted fake, so a red sector-naming check in K2 reflects the fake's canned text until the recall path is code-built.
- The egress guard refused calls to generativelanguage.googleapis.com, elevenlabs and deepgram from the services. Nothing left the machine.

## Pre-deploy gate: int-merge 9050c90f (B, D, F, V and G merged), 18:57–19:36 UTC

**Label: LOCAL-E2E (MOCK).** Provider keys were `disabled-locally-000000000000` and the egress guard was on. Migrations were applied with `supabase migration up --local --include-all`. `20261220181000_knowledge_projections` had been half-applied earlier by hand (`knowledge.version_seq` already existed), so the local `knowledge` schema was dropped and the migration re-applied. The world was seeded locally. GPT-Live specs ran with `CQ_RECOVERY_GPT_LIVE=1`.

Harness change: the turn reader is a model, so its correct reading is now scripted in MOCK (`DISCOVER_COMPANIES` for "three fintech companies", `subject: MANDATE` for "what is my mandate"). Whether the live reader reads real words this way is LIVE-PENDING. Recall allows reader + 1 analyst call with no tool round, which is B's K8 design.

| Test                                                 | Result                                                                                                                                                 |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| K1 as seeded, and the 0, 1 and 2 cases               | GREEN. Now regression guards.                                                                                                                          |
| K1 browser first card                                | RED on the provisional 3 s budget: 5.0 and 6.6 s from send to first card, while the server finishes in under 2 s. The cards are correct.               |
| K2 mandate recall                                    | GREEN. Now a guard.                                                                                                                                    |
| K3 current page; K6 ×3 security                      | GREEN                                                                                                                                                  |
| K4 change propagation                                | GREEN. G-D23 no longer reproduces.                                                                                                                     |
| K5 continuity                                        | EXPECTED RED (C Part 5). Answer cards focus on click and have no link to the company.                                                                  |
| K7 idempotency, concurrency, analyst outage, restart | GREEN (4/4). G-D24 no longer reproduces.                                                                                                               |
| l-named-navigation ×4, m-fast-navigation ×3          | GREEN                                                                                                                                                  |
| n-founder-strings                                    | 5/6 GREEN. "quick rehearsal … still opens Rehearsals" was red once (no /rehearsals within 30 s) and green on a diagnostic rerun: flaky, **G-D25 (C)**. |
| voice/gpt-live ×7                                    | GREEN with `CQ_RECOVERY_GPT_LIVE=1`. Without that flag all 7 fail their precondition, which is a harness setting and not a product failure.            |
