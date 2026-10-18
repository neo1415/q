# Product verification, 2026-10-01 (evening)

## Scope and method

Base: `origin/recovery/2026-09-12` at 260c0b91. This is what was deployed at 15:14 UTC (web was
still building). Work was done on branch `build/audit` in worktree `/home/user/wt-billing`.

This audit judges each capability from the code and the test results, not from what the specs claim.
For every capability it records:

- the code entry points;
- the tests that cover it, run today;
- live evidence from the hosted database (read-only queries through
  `scripts/handoff/live/hosted-read.mjs`), Railway deployment state and logs;
- a verdict.

No Q turn and no provider call was made.

### Tests run today (all on 260c0b91)

| Suite                                                                           | Result                                          |
| ------------------------------------------------------------------------------- | ----------------------------------------------- |
| Unit (`npx vitest run`)                                                         | 2,147 suites, 6,661 passed, 0 failed, 1 skipped |
| pgTAP RLS (`supabase/tests/database/rls/*.test.sql`, local Supabase)            | 60 files, 1,468 ok, 0 failing                   |
| Integration (20 files relevant to this audit; local DB, provider keys disabled) | 97 tests, 96 passed, 1 failed                   |

The failing integration test was out of date and is fixed on `build/audit` (see "Fixed on
build/audit" below).

### Live evidence

- Hosted database: row counts in total and for the last 24 hours, plus status breakdowns.
- `ai_ops.model_usage` over 24 hours:

  | Task class            | Calls | Succeeded |
  | --------------------- | ----- | --------- |
  | NORMAL_DIALOGUE       | 1,576 | 1,535     |
  | FAST_CLASSIFICATION   | 644   | 625       |
  | STRUCTURED_EXTRACTION | 293   | 255       |
  | EVIDENCE_SYNTHESIS    | 18    | 12        |

  Failures cluster from 10:00 to 15:00 UTC (57 of about 490 calls). The ledger records an OpenAI
  credit outage in that window.

- Railway logs: the current deployments (15:14) show no warn or error lines. Older deployments'
  logs are gone. A later call to read environment variable names hit Railway's rate limit.

### Verdicts

- **WORKS:** tested, and there are live rows from real or bench use.
- **WORKS-OFFLINE:** tested, but no live evidence.
- **PARTIAL:** part of the promise is built or tested.
- **MISSING:** nothing serves it.
- **BROKEN:** fails today.

## 1. Q end to end: "this person might interest you" → "handle this for me" → "get me a meeting"

| Step                                                               | Code entry points                                                                                                                               | Tests (today)                                                                                              | Live evidence                                                                                                                                                                  | Verdict               |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| Scout surfaces a person or company ("you might be interested in…") | q-api `composition/scout.ts`; workers `network/q-work-wake-handler.ts`; Needs-you notices                                                       | `apps/q-api/test/scout.test.ts` (2), q-work wake tests                                                     | `communication.scout_findings` 37 (19 in 24 h); 13 Q_SCOUT notices, 3 read                                                                                                     | WORKS                 |
| "Handle this for me" is read as a hand-over                        | TURN_READER v23 (79cf768d); q-tool `relationship.errand.propose`; "Let Q handle this" button                                                    | errands tests (4 files, 21 tests), `relationship-errands.test.tsx`, approval-continuation integration (11) | `q_runtime.errands` 3 today (1 DONE, 1 ACTIVE, 1 STOPPED); 3 `q.errand.start` actions EXECUTED, 1 REJECTED; 3 `q.delegations` units metered                                    | WORKS                 |
| Interest expressed for the person                                  | action `relationship.interest.express`; api network-interests                                                                                   | express-interest integration (15), network-interests                                                       | 1 EXECUTED by Q; 2 interests and 3 responses today; 14 relationship events today                                                                                               | WORKS                 |
| "Get me a meeting": Q books the call                               | errand runner → schedule actions → Google Calendar `insert` (`packages/integrations/src/google/calendar.ts`); booking without Google (2201294c) | schedule (7 files, 45), schedule-postgres integration (3), errands-negotiation                             | 1 Q-booked meeting at 14:44 with a Google event but **no Meet link** (`meet_link` null); 2 MEETING_SCHEDULED and 2 TIME_PROPOSED notices; 2 `q_api.meeting_invite` emails SENT | PARTIAL (P1-1)        |
| Prep brief and reminders                                           | workers `schedule-ticker`; meeting briefs                                                                                                       | schedule-ticker test                                                                                       | 3 MEETING_PREP_READY notices; 6 reminders; 1 `workers.reminders` email SENT                                                                                                    | WORKS                 |
| Q attends the call (Recall, ADR 0027)                              | `composition/recall-bots.ts`; meeting-assistant route                                                                                           | meeting-record test                                                                                        | 1 meeting_assistant, from 09-29 only                                                                                                                                           | WORKS-OFFLINE         |
| Outreach and stand-in by delegated work (LangGraph, ADR 0030)      | q-orchestrator `work/*`; q-api `composition/work/*`; `/work`                                                                                    | `work.test.ts`, work integration (1), q-work tools                                                         | `q_runtime.delegations`, `delegation_lanes` and `delegation_steps` are all 0                                                                                                   | WORKS-OFFLINE (P1-2)  |
| Commitment stated and confirmed after the meeting                  | api `commitments.ts`; network commitments                                                                                                       | commitments (2 files, 27)                                                                                  | `network.commitments` 1, from 09-29                                                                                                                                            | WORKS-OFFLINE (stale) |
| Approvals by card or by conversation                               | q-actions engine; approve and decline tools                                                                                                     | approval-engine integration (11), approval-flow (4)                                                        | `q_runtime.approvals`: 10 APPROVED, 3 REJECTED, 2 PENDING                                                                                                                      | WORKS                 |

## 2. Emails, in-app notifications, PWA push

| Capability                                | Code                                                                           | Tests                                                                               | Live evidence                                                                                                                           | Verdict                                                   |
| ----------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Branded transactional email (Brevo API)   | `packages/integrations` Brevo sender; `recordingEmailSender`                   | brevo-api-email, app-email config                                                   | `platform_ops.email_deliveries`: 4 SENT today (2 meeting invites, 1 reminder, 1 Daily)                                                  | WORKS (spam/domain still a founder item)                  |
| Notice emails for unread "Needs you"      | `packages/communication/src/push/delivery.ts`, notice-delivery-ticker          | notice-delivery integration (1)                                                     | `emailed_at` set on 3 notices, but **none was in the email log**: these emails were not recorded                                        | WORKS (log gap fixed on build/audit)                      |
| In-app notification centre                | api `schedule.ts` NOTIFICATIONS_PATH; web `notices-panel-controls.tsx`         | schedule tests                                                                      | 36 notices (24 today) across 8 kinds; read marks present                                                                                | WORKS                                                     |
| PWA Web Push                              | `packages/communication/src/push/*`; workers notice ticker; web service worker | web-push (communication, config), push-subscription contract, service-worker-policy | 2 subscriptions, both with user agent `node` (test endpoints), both revoked; one push succeeded at 12:11; `pushed_at` set on 24 notices | PARTIAL: no real phone or browser subscription yet (P1-3) |
| Gmail send as the person; reply detection | `integrations` Gmail; workers `gmail-poller`; q-tool `propose_email`           | gmail-poller, email-tool, email-action                                              | 2 Google accounts linked (09-28); `integrations.email_messages` 0                                                                       | WORKS-OFFLINE (HANDOVER §5 #8)                            |

## 3. Rehearsals

| Capability                                                                 | Code                                                                            | Tests                                                                      | Live evidence                                                                            | Verdict                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Persona (from mandate, public presence, engagement; never private Q chats) | `composition/rehearsals.ts`; `q_runtime.persona_profiles`; ADR 0029             | `rehearsals.test.ts`, rehearsals-postgres integration, `rehearsal-lenient` | 2 persona profiles                                                                       | WORKS                                           |
| Role-play (moods, reactions, difficulty)                                   | q-api `/v1/q/rehearsals/*/turns`                                                | as above                                                                   | 1 rehearsal FINISHED today (investor, TOUGH): 21 turns with mood, reaction and intensity | WORKS                                           |
| Voice                                                                      | voice rehearsal turn (`createRehearsalAwareTurn`), ElevenLabs/Deepgram adapters | `voice-rehearsal-delivery.test.ts`; voice suites (22 files, 214)           | voice MALE set on the live rehearsal                                                     | WORKS (turn-level speech not separately logged) |
| Meet-style room                                                            | web `rehearsals/r`, `rehearsal-room`, `rehearsal-meet`                          | `rehearsal-meet.test.ts`                                                   | the same live rehearsal                                                                  | WORKS                                           |
| Screen share (vision frames)                                               | `/v1/q/rehearsals/:id/screen`                                                   | rehearsals tests                                                           | `sawScreen` true on 0 of 21 turns                                                        | WORKS-OFFLINE (P1-4)                            |
| Review and score                                                           | finish → scorecard                                                              | rehearsals tests                                                           | scorecard present, score 78, outcome DECLINED                                            | WORKS                                           |
| Plan allowance                                                             | rehearsal start route (BILLING)                                                 | billing-gates (7)                                                          | 3 units metered, 0 voided                                                                | WORKS; 2 units have no rehearsal row (P2-7)     |

## 4. Documents, Q Daily, admin, results, billing

| Capability                                                  | Code                                                                             | Tests                                                                                                         | Live evidence                                                                                                                 | Verdict                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Decks and briefs, PDF/PPTX, revisions, brand kit (ADR 0031) | q-api `q-documents.ts`, `composition/documents.ts`, `deck-render`, `q-artifacts` | documents (27 files, 242), artifact-deck-loop, artifact-repository and brand-kit integrations                 | 24 artifacts and 31 versions (2 today); `brand_kit_versions` 0                                                                | WORKS (brand kits WORKS-OFFLINE)                                    |
| AI images in documents                                      | `composition/document-images.ts` (images are enabled on q-api)                   | document-images integration (3), billing-gates                                                                | `artifacts.document_images` 0                                                                                                 | WORKS-OFFLINE (P1-5)                                                |
| Q Daily (ADR 0032)                                          | workers `daily/composition.ts`; q-api `daily.ts`; web `/daily`; Daily tools      | q-daily domain and pipeline, postgres integration, daily-routes, daily-ticker, `daily.test.tsx` (6 files, 43) | 1 edition today; 1 `workers.daily` email SENT; 61 preferences                                                                 | WORKS                                                               |
| Admin console (ADR 0033)                                    | api `admin.ts` and `admin-billing.ts`; `/admin/*`                                | admin RBAC (128 incl. billing), platform-admin integration (7), permissions                                   | `platform_ops.admin_actions` 0, `step_ups` 0; firewall decision log 263 rows today                                            | WORKS-OFFLINE for console writes (P1-6); WORKS for the firewall log |
| Results and reports                                         | api `results.ts`; q-tools results; `/results`; PDF/CSV                           | results (3 files, 13), results integration (3)                                                                | read model only; no live rows to check                                                                                        | WORKS-OFFLINE                                                       |
| Plans, entitlements, metering (ADR 0034)                    | `@capital-q/billing`; gates in api, q-api and q-tools                            | billing unit, api and q-api gates, plan-tools; billing integration (6); pgTAP 610 (22)                        | `billing.usage_events` 9 (research 3, rehearsals 3, delegations 3), none voided; 0 plan assignments, so everyone is on Launch | WORKS                                                               |
| Stripe checkout and webhooks                                | api `billing.ts`                                                                 | api `billing.test.ts` (signature, replay, 503)                                                                | no Stripe keys; 0 provider events                                                                                             | WORKS-OFFLINE (founder keys)                                        |
| Facilitation-fee ledger                                     | `/admin/billing`; `billing.fee_entries`                                          | billing integration (fees)                                                                                    | 0 entries (the one commitment is pre-ledger; accrual has not been run)                                                        | WORKS-OFFLINE                                                       |
| GateQ gateway and applications                              | api `gateq*.ts`; `/gateway`, `/g/<id>`                                           | gateq (8 files, 120)                                                                                          | 1 gateway (09-29); 0 applications                                                                                             | WORKS-OFFLINE                                                       |

## 5. Rest of the product (from the earlier capability table, re-checked against code and tests)

- **Onboarding interviews** (50 suites, 418 tests): WORKS. 906 interview turns in the 24 hours up to
  09-30 23:25, and none since.
- **Discover**: slates, filters, save/pass and why-this (43 suites, 584 tests). WORKS.
- **Q core**: firewall, gateway, turn reader, capabilities and harness (99 suites, 1,278 tests).
  WORKS: 235 runs today and 263 firewall decisions.
- **Media and pitch** (20 suites, 362 tests). Live: 12 assets, last on 09-27. WORKS-OFFLINE today.
- **Chat with block/report** (6 suites, 38 tests). Live: 10 messages (6 today); 0 blocks and 0
  reports. Chat WORKS; block/report WORKS-OFFLINE.
- **Verification** (6 suites, 43 tests): WORKS-OFFLINE today.
- **MISSING, from the specs:**
  - Capital Readiness Blueprint (PADL #85, the locked "Pro" layer).
  - Human escalation and appeals (PADL Stage 4).
  - FDN/specialist referral path.
  - KYB/KYC provider vetting.
  - Premium recommendation volume (Spec Ch.4).
  - Structured portfolio examples (PARTIAL).

## 6. Defects and gaps, ranked

| #    | Pri | Finding                                                                                                                                                                                                                                                             | Evidence                                         | Owner                                           |
| ---- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| P0-1 | P0  | Model provider failures during the day: OpenAI credit outage, about 12% of calls failing 10:00–15:00. EVIDENCE_SYNTHESIS failed 6 of 18 (INVALID_MODEL_OUTPUT and PROVIDER_OUTAGE); STRUCTURED_EXTRACTION 38 of 293 (incl. RATE_LIMIT).                             | `ai_ops.model_usage`                             | Founder (credits) + HARDEN (fallback / readers) |
| P1-1 | P1  | A Q-booked meeting has a Google event but **no Meet link**, so Q cannot attend (ADR 0027) and the invite has no link. `insert` re-reads once; the conference is still pending. Fix: a ticker re-reads events whose `meet_link` is null, or Q says there is no link. | `communication.meetings` row 2026-10-01 14:44    | AUTO                                            |
| P1-2 | P1  | LangGraph delegated work (outreach, stand-in) has never run live (0 delegations).                                                                                                                                                                                   | DB                                               | AUTO + QA                                       |
| P1-3 | P1  | No real browser or phone push subscription; only test `node` endpoints, both revoked.                                                                                                                                                                               | `communication.push_subscriptions`               | AUTO + QA (PWA on a phone)                      |
| P1-4 | P1  | Rehearsal screen share never exercised live.                                                                                                                                                                                                                        | `sawScreen` 0 of 21                              | REHEARSE                                        |
| P1-5 | P1  | AI images in documents are enabled but none was ever made live (provider key or credits, or never asked for).                                                                                                                                                       | `document_images` 0                              | DOCS                                            |
| P1-6 | P1  | No admin console write live (no step-up, no audit row); suspension, flags, verification decision and billing assign need one live run.                                                                                                                              | `platform_ops` 0 rows                            | ADMIN                                           |
| P1-7 | P1  | Gmail send-as-person, Recall in calls and GateQ applications have no live use since 09-29.                                                                                                                                                                          | DB                                               | QA                                              |
| P2-1 | P2  | Commitments: only 1 live (09-29). The fee ledger has never been accrued live.                                                                                                                                                                                       | DB                                               | QA / BILLING                                    |
| P2-2 | P2  | Brand kits never saved live.                                                                                                                                                                                                                                        | DB                                               | DOCS                                            |
| P2-3 | P2  | Block/report never used live.                                                                                                                                                                                                                                       | DB                                               | QA                                              |
| P2-4 | P2  | Capital Readiness Blueprint (PADL #85 Pro layer) is MISSING; it is the main paid feature in the locked sources.                                                                                                                                                     | code                                             | BILLING + HARDEN (scope with founder)           |
| P2-5 | P2  | Human escalation, KYB, FDN referral and premium recommendation volume are MISSING.                                                                                                                                                                                  | code                                             | Founder decision                                |
| P2-6 | P2  | Stripe off (no keys); 0 plan assignments.                                                                                                                                                                                                                           | env / DB                                         | Founder → BILLING                               |
| P2-7 | P2  | Two `q.rehearsals` units (Zino Aviation, 11:21 and 12:04) have no rehearsal row: either rows removed later, or a start path that neither created the row nor gave the unit back.                                                                                    | `billing.usage_events` vs `q_runtime.rehearsals` | BILLING                                         |
| P2-8 | P2  | Onboarding: no interview turns on 10-01 (latest 09-30 23:25). Confirm a fresh sign-up still works on the current deploy.                                                                                                                                            | DB                                               | HARDEN / QA                                     |

### Fixed on build/audit (with tests)

1. `packages/network/test/relationship-service.integration.test.ts` was out of date: its
   no-parallel-deal-table check predates `network.commitments` (migration 20261029). The allow-list
   now names commitments, with the reason. The test passes (8/8).
2. Notice emails (unread "Needs you") were sent through a sender that did not record deliveries, so
   the console's Email panel missed them. `apps/workers/src/main.ts` now wraps that sender in
   `recordingEmailSender`, with source `workers.notices`, as reminders and the Daily already do.
   Workers typecheck is clean. `recordingEmailSender` itself is covered by
   `packages/platform-admin/test/permissions.test.ts`.
