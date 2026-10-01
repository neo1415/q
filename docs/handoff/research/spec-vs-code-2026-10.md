# Spec vs code, 2026-10-01: capabilities and revenue points (BILLING step 1)

## Sources and method

**Sources:**

- PADL, Product Specification, Final System Review and the GateQ spec (docx text extracted; the
  monetisation passages were read in full).
- Doc 10 §14 and docs 12 §51.1, 13 and 15.
- The prior audit `spec-audit-2026-09-27.md` (48 rows).
- The ledger and HANDOVER deploy lines through f4184aed, and QA `qa-2026-10.md`.

**Status meanings:**

- LIVE: code and tests exist, and the ledger or HANDOVER records it working in production.
- PARTLY: built but not live-verified, or part of the promise is missing.
- MISSING: nothing serves it.

**Plan column:** whether the capability can carry a plan control without breaking a locked decision.

- **free**: never gated (PADL #85 Layer 1, #106, neutrality).
- **metered**: a paid volume lever.
- **pro**: Layer 2.
- **fee**: a success-fee basis.

## 1. Capability table

| Area         | Capability (source)                                                                                 | Status                                                     | Evidence                                                               | Plan                                         |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------- |
| Onboarding   | Founder interview, deck read, research prefill, review (Spec Ch.3, doc 10 §5)                       | LIVE                                                       | HANDOVER §3-§5, bench Nixo/Flutterwave/Chowdeck COMPLETE               | free                                         |
| Onboarding   | Investor mandate interview → Discover (Spec Ch.4)                                                   | LIVE                                                       | Ventures Platform bench COMPLETE                                       | free                                         |
| Onboarding   | Portfolio import / structured examples (doc 10 §5.4)                                                | PARTLY                                                     | prose only (audit #7)                                                  | free                                         |
| Intelligence | InvestIQ diagnosis: pillars, strengths, gaps, confidence (PADL #106)                                | LIVE                                                       | q-specialists company analysis, `read_my_record`                       | **free (locked)**                            |
| Intelligence | Capital Readiness Blueprint: roadmap, sequencing, investor-specific plan (PADL #85 Layer 2 "Pro")   | MISSING                                                    | no blueprint artifact or route; only next-step offers (HARDEN)         | **pro** (first paid feature to build)        |
| Intelligence | Contradictions and evidence axes (Spec 6.x, ADR-001)                                                | LIVE                                                       | evidence package, truth/evidence/lifecycle axes                        | free                                         |
| Q            | One Q, text and voice, Context Firewall, typed tools, approvals (FSR, doc 12)                       | LIVE                                                       | q-api, q-firewall, q-actions; 477-check capability harness (HARDEN)    | free                                         |
| Q            | External web research with sources (doc 12 §51.1 "external research allowance")                     | LIVE                                                       | `research.public_web`, PUBLIC_SOURCE blocks                            | **metered** `q.research`                     |
| Q            | Memory, personalities, small-talk policy                                                            | LIVE                                                       | ledger 2026-09-30                                                      | free                                         |
| Discover     | Precomputed slates, deterministic ranking, why-this, save/pass (doc 19/20)                          | LIVE                                                       | audit #8-#12, #44-45                                                   | **free; never pay-to-rank**                  |
| Discover     | Filters                                                                                             | LIVE                                                       | `discover-filter-facts.ts`                                             | free                                         |
| Discover     | More AI recommendations for premium tiers (Spec: "volume and frequency … without reducing quality") | MISSING                                                    | slate size is fixed                                                    | metered (future; volume only, never order)   |
| Discover     | Compare 2-5 companies                                                                               | PARTLY                                                     | via Q from Saved (audit #13)                                           | free                                         |
| Network      | Express interest, accept, relationship projection (Spec 6.6)                                        | LIVE                                                       | NET-010/011/012                                                        | free                                         |
| Network      | Chat with block/report                                                                              | LIVE                                                       | `20261020090000_communication_chat_safety`                             | free                                         |
| Network      | Meetings: Meet links, reminders, Q attends, record, money mentioned (ADR 0027)                      | PARTLY                                                     | coded and deployed; Recall/Gmail live check open (HANDOVER §5 #8)      | free (bot minutes could later be metered)    |
| Network      | Commitments: stated, other side confirms; detected in calls (Spec 6.6.14-15)                        | LIVE                                                       | `network.commitments`, Capital raise view, admin disputes              | **fee basis**                                |
| Network      | Attribution ledger: intro source, meetings, detected and confirmed money                            | LIVE                                                       | `/v1/admin/attribution`, `/admin/attribution.csv`                      | fee basis                                    |
| Delegation   | "Let Q handle it" errands (ADR 0028)                                                                | LIVE                                                       | c8c788db, `q_runtime.errands`                                          | **metered** `q.delegations`                  |
| Delegation   | LangGraph delegated work: outreach, interview report, booking, stand-in (ADR 0030)                  | PARTLY                                                     | deployed 978aff38; end-to-end bench pending                            | **metered** `q.delegations`                  |
| Rehearsal    | Investor/founder twin rehearsal, Meet-style room, personas, reviews (ADR 0029)                      | PARTLY                                                     | deployed 508571c4; QA P0 (model type) fixed; LCP 4.6 s open            | **metered** `q.rehearsals`                   |
| Documents    | Deck and brief generation, PDF, brand kit (ADR 0031)                                                | LIVE                                                       | deck generation and PDF verified (ledger)                              | free (generation)                            |
| Documents    | AI images in documents                                                                              | PARTLY                                                     | `20261113010000_document_images`; QA P0 broke model calls, since fixed | **metered** `documents.ai_images`            |
| Q Daily      | News edition, weekly default and daily opt-in (ADR 0032)                                            | PARTLY                                                     | DAILY branch, not merged in this base                                  | **metered** `q.daily_editions` (cadence)     |
| GateQ        | Investor gateway: public apply, embed, QR, inbox (GateQ spec)                                       | LIVE                                                       | bd09085b `/gateway`, `/g/<id>`                                         | **metered (count)** `gateq.gateways`         |
| GateQ        | Scored applications, thesis match, reports (GateQ spec §4-§9)                                       | PARTLY                                                     | qualification reasons, no score by design                              | investor pro (reports)                       |
| Trust        | Verification, auto-verify, admin queue (Spec Ch.8)                                                  | LIVE                                                       | `/verification`, R43, ADMIN queue                                      | free                                         |
| Trust        | KYB/KYC provider vetting                                                                            | MISSING                                                    | ledger B8                                                              | cost pass-through later                      |
| Trust        | Human escalation / appeal to FDN (PADL "Stage 4")                                                   | MISSING                                                    | no workflow                                                            | pro or paid add-on (PADL allows)             |
| Advisory     | FDN Advisory / approved specialists (PADL #85 Layer 3, Spec #126)                                   | MISSING                                                    | no referral path                                                       | referral revenue (disclosed, never steering) |
| Admin        | Ops console: roles, step-up, audit, Q monitor, kill switches (ADR 0033)                             | LIVE                                                       | deployed f4184aed                                                      | internal                                     |
| Admin        | Results dashboards and CSV/PDF reports                                                              | PARTLY                                                     | ADMIN block results route                                              | free                                         |
| Billing      | Plans, entitlements, metering, payments                                                             | built in this packet (see `docs/specs/2026-10/billing.md`) | —                                                                      | —                                            |

Counts: LIVE 18 · PARTLY 11 · MISSING 6 (excluding the billing row).

## 2. Revenue points the sources name

1. **Subscriptions: Pro, Layer 2** (PADL #85, LOCKED).
   - Paid users get the Capital Readiness Blueprint: roadmap, implementation strategy, proprietary
     investor intelligence, investor-specific recommendations, sequencing.
   - Not built yet. It is the strongest locked paid feature.
2. **AI execution volume** (Spec #106 value ladder "Intelligence → AI Execution → Human Expertise";
   doc 12 §51.1 allowances).
   - Covers rehearsals, delegations, AI images, research and Q Daily cadence.
   - Enforced now by metered plan limits.
3. **Premium recommendation volume** (Spec Ch.4).
   - More recommendations, never better placement.
   - Not built.
4. **Human escalation entitlements** (PADL appeals). Not built.
5. **Human execution / FDN Advisory** (PADL #85 Layer 3; Spec "Resolve yourself → with Q → Expert
   support").
   - Optional services revenue.
   - Q must not manufacture issues (Spec #110 family) or steer for it (neutrality).
6. **GateQ for investors** (GateQ spec).
   - Gateway SaaS for funds and angels: count of gateways, and reports.
7. **Facilitation (success) fee on confirmed capital** (founder direction 2026-09-29; _not in any
   locked source_).
   - Basis: `network.commitments` CONFIRMED rows plus the attribution ledger.
   - Needs a PADL amendment and a legal opinion (broker-dealer / FCA arranging) before invoicing.
   - The ledger records entries now, as RATE_NOT_SET until the founder sets a rate.

Explicitly excluded by the sources: pay-to-rank or sponsored placement (Spec 4533-4550, PADL
neutrality), selling data or exposing founder-private information, artificially withholding
diagnosis, and holding investment money (doc 10 §14).

## 3. What changed in code (this packet)

See billing.md §4-§9:

- `billing` schema and the `@capital-q/billing` package.
- Server enforcement at each gated entry point.
- Problem `ENTITLEMENT_REQUIRED`.
- Q tool `plan.get_mine`.
- `/settings/plan` and `/admin/billing`.
- The Stripe adapter (off until keys are set).
- The fee ledger.

## 4. Verified against code, tests and live data (2026-10-01 evening)

The full verification is in `product-verification-2026-10-01.md`, against base 260c0b91.

- **Tests:** 6,661/6,661 unit, 1,468/1,468 pgTAP, and 97/97 of the relevant integration tests after
  one out-of-date test was fixed.
- **Live rows** confirm Q's end-to-end loop: scout → hand-over errand → interest → meeting booked →
  prep brief and reminders → rehearsal reviewed → emails, the Daily and notices.
- **Status changes since the table above:**
  - Rehearsal is now WORKS. Screen share has no live use yet.
  - Q Daily is WORKS.
  - Errands are WORKS.
  - Delegated work (LangGraph), push to a real device, AI images and admin writes are still
    WORKS-OFFLINE.
  - A Q-booked meeting can lack a Meet link (P1, AUTO).
