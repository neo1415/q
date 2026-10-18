# Q's marketing promises vs the product: audit, 7 October 2026

Read-only audit of what the CapitalQ™ marketing site (FDN Capital Partners) promises about Q, against the code on `origin/recovery/2026-09-12-8y2j4w` (`941a0cc1`) and the hosted database (read-only counts via `scripts/handoff/live/hosted-read.mjs`, 7 Oct). Hosted counts include seeded personas; they show the plumbing runs, not that real customers use it.

Scoring: 0–10 for what a real founder or investor can do **today** in the deployed product. Each promise is split into three layers:

- **Code**: the foundation exists in packages or the API.
- **UI**: it works end to end on a screen.
- **Q**: it can be reached from the Q page or Dock by text or voice.

## Summary

| #     | Promise                                                      | Score | One-line verdict                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------ | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q.01  | Conversationally interviews every business                   | **6** | Real Q-led interview (text + voice, 1,151 turns) but fixed-definition steps; "deeper" follow-ups are generated and never answered (194 questions, 0 ANSWERED); financials are shallow.                                                              |
| Q.02  | Learns how each investor thinks                              | **5** | Mandate interview, mandate document reading and deterministic slates are live; "continuously learns" is not true. Behaviour does not feed ranking (by design), semantic matching is off (0 embeddings), and cheque size is not computed in ranking. |
| Q.03  | Reveals what could stop the raise (scores readiness factors) | **3** | No investment-readiness score exists. What exists: a marketplace-activation checklist, Q's prose diagnosis, and founder-only deck coaching (0–5 per section). Deck coaching has **0** readings in hosted data.                                      |
| Q.04  | Turns weaknesses into an action plan                         | **3** | "Top 3 next steps" (marketplace activation only), plus "fill my gaps from the web" with approval. The Readiness Blueprint is contracts only; the route answers 501 and the UI says "not built yet".                                                 |
| Q.05  | Finds the right investors (for founders)                     | **4** | Founders see investors ordered on investors' _public_ profiles plus GateQ gate checks. Private mandates correctly never shape this. The copy claims mandate matching for founders, and that is not what happens.                                    |
| Q.06  | Finds the right opportunities (for investors)                | **7** | The strongest promise: precomputed deterministic slates (12 investors with current slates, 397 items, all with reason codes), a 9-parameter fit panel, "top three side by side", and Save/Pass.                                                     |
| Q.07  | Lets investors interview the opportunity                     | **6** | Investors can ask Q about a company (Company Intelligence specialist, Context Firewall, documents read in the room with page cites). Weak spot: Q has little structured data to answer from (0 deck readings, 99 claims across 62 companies).       |
| Q.08  | Understands every business the same way                      | **4** | A 12-section standard deck schema and standardised profile exist in code, but the deck reader has produced **0** readings in production despite 21 active pitch decks. Live, the standard structure is mostly empty.                                |
| Q.09* | Prepares founders for investor meetings (rehearsal)          | **6** | Rehearsal rooms with investor personas are live (18 hosted rehearsals); there is no rehearsal scorecard over time.                                                                                                                                  |
| Q.10* | Compares opportunities side by side                          | **6** | "Top three side by side" with score/10; no 2–5 compare picked from Saved on a screen (only through Q).                                                                                                                                              |

\*Q.09–Q.10 are not on the marketing list given to this audit. They are promised in `docs/product-sources` (Product Specification: rehearsal, "Standardised comparison tool"; GateQ spec §4 "Standardised Application Profile", §27 "Standardised Investment Intelligence Report").

**Overall: 4.8 / 10** (mean of Q.01–Q.08: 6+5+3+3+4+7+6+4 = 38/8). The investor side is close to the copy. The founder side, readiness and the action plan, is the headline promise and is the weakest.

### Hosted evidence (7 Oct, read-only counts)

| Measure                                                     | Count                                                                           | Means                                   |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------- |
| `onboarding.sessions` founder / investor                    | 56 (41 completed) / 40 (12 completed)                                           | Interviews run                          |
| `onboarding.interview_turns`                                | 1,151 across 45 sessions; 192 voice                                             | Interview is conversational, voice used |
| `onboarding.interview_questions`                            | 194: 91 MATERIAL_GAP, 86 REQUIRED, 2 AMBIGUITY, 0 CONTRADICTION; **0 ANSWERED** | Follow-ups are generated, never closed  |
| `onboarding.utterances`                                     | 0                                                                               | —                                       |
| `core.investor_mandates` / constraints / taxonomy prefs     | 20 (12 active) / 75 / 95                                                        | Mandates captured                       |
| `recommendation.slates` current / superseded                | 12 / 429 (last 2026-10-06)                                                      | Slates regenerate                       |
| slates with a semantic generator                            | **0**; `company_embeddings` = `mandate_embeddings` = **0**                      | Semantic fit is off                     |
| `evidence.documents` PITCH_DECK active                      | 21 (latest 2026-10-06 16:57)                                                    | Decks uploaded                          |
| `evidence.deck_extractions` / confirmations                 | **0 / 0**                                                                       | 12-section reading never ran or failed  |
| `q_knowledge.contradiction_sets`                            | 0                                                                               | Contradiction detection unused          |
| `evidence.claims` / verification claims                     | 99 / 211                                                                        | Thin evidence layer                     |
| `core.companies` marketplace_ready / not_assessed           | 34 / 28                                                                         | —                                       |
| `network.relationships` / interests / matches / passes      | 43 / 45 / 23 / 4                                                                | Loop works end to end                   |
| `gateq.gateways` / criteria / applications / inbox items    | 2 / **0** / **0** / **0**                                                       | GateQ is effectively unused live        |
| `q_runtime.runs` / conversations / approvals / instructions | 2,778 / 644 / 314 / 23                                                          | Q is used heavily                       |
| `q_runtime.rehearsals`                                      | 18                                                                              | —                                       |

---

## Q.01 Conversationally interviews every business: **6/10**

**Evidence.**

- **Code.** Q-led onboarding workspace: `apps/web/src/features/onboarding-conversation/q-onboarding-workspace.tsx`. The interview is a Q run with typed tools (`packages/q-tools/src/tools/onboarding.ts`, ADR 0016). The adaptive planner `packages/founder-onboarding/src/intelligence/planner.ts` is deterministic: it never re-asks something already answered and skips revenue questions for a pre-revenue company. The pinned definition `packages/founder-onboarding/src/definition/founder-v1.ts` (F1–F8: basics, taxonomy, team, traction adaptive on stage, raise, objective, snapshot, review) works with document review, which writes `onboarding.interview_questions` (`supabase/migrations/20260915090000_*`) and a persisted thread (`20261008090000_onboarding_interview_turns.sql`).
- **UI.** `/onboarding/founder` with text and voice.
- **Q.** Free questions are answered inside the interview.

**Honest gaps.**

- "Deeper questions as it learns" is only half true. Questions come from gaps and contradictions in uploads, but **none of the 194 has ever been ANSWERED**. They pile up as PENDING behind a "small entry".
- Financials are a revenue band and customer count. The interview has no MRR/ARR, gross margin, burn, runway, CAC/LTV, cap table or use of funds.
- **0 CONTRADICTION** questions in production. The flagship "your deck says X, your model says Y" moment has never fired.
- The interview ends at onboarding. Q does not keep interviewing after day one (no "living profile" interview).

**Missing, ranked.**

1. **(S)** Surface pending interview questions as the founder's first Home card and Q opener ("3 things investors will ask you"), then make answering one close the row. Fixes the 0-ANSWERED problem.
2. **(M)** A financials step: MRR/ARR, growth, gross margin, burn, runway, use of funds. Each is optional, unknown is allowed, and each is written as USER_CLAIM with evidence status.
3. **(M)** A post-onboarding "Q interview" mode: Q picks the next most material open fact weekly, by voice or text.
4. **(M)** Make contradictions actually fire by running the deck and financial extraction (see Q.08) and comparing figures.
5. **(L)** Sector-specific question packs (PADL: fintech is not evaluated like healthtech) as versioned reference data.
6. **(L, overdeliver)** An investor-grade "interview transcript to profile diff": every answer shows which profile field it changed and its truth class.

**Strategy.** The interview is the top of the funnel and the data moat. Every downstream promise (readiness, matching, standardisation) is only as good as the facts it collects. Founders hate forms and love being understood. The boastable point is "15 minutes of conversation replaces a 40-field application, and Q never asks what your deck already told it". Metrics to show:

- median time to a completed profile;
- questions _avoided_ because a document answered them;
- the share of the profile filled from documents rather than typing;
- interview questions answered within 7 days (today 0%).

**Screens.**

- **Onboarding thread.** The pending-gap entry is too hidden. It should show one "Q still wants to know" stack, ranked by materiality, each with a why line.
- **Founder Home.** It should open with the next unanswered question, not a generic greeting.
- Keep Stage + Board (ADR 0017 F3), with the Q glow on Q only.

## Q.02 Learns how each investor thinks: **5/10**

**Evidence.**

- **Code.** Investor mandate interview (`investor-onboarding`), mandate domain (`supabase/migrations/20260903210000_investor_mandate_domain.sql`), mandate document reading, and `get_investor_mandate`. Ranking config `packages/discovery/src/ranking/config.ts` (`ranking-config.v2`) weights stage, geography, taxonomy and semantic factors equally. `declared_fit.cheque` is **NOT_COMPUTABLE**. Exploration and diversity are `NONE`. The bounded reranker (`packages/discovery/src/rerank/`) keeps observed behaviour separate from the declared mandate (correct per CLAUDE.md). `note_preference` (`q-tools/src/tools/note-preference.ts`) learns _how Q talks_, not investment preferences.
- **Hosted.** 20 mandates, 75 constraints, 95 taxonomy preferences, and 441 slates generated. **0 embeddings**, so semantic fit is silently absent from every slate.

**Honest gaps.**

- "Continuously personalises" overstates it. Slates regenerate when mandates or companies change, but nothing learns from Save, Pass, pass reasons, interest or meetings, not even as a _suggestion_.
- Minimum criteria are partly captured, but cheque size does not affect order.

**Missing, ranked.**

1. **(S)** Turn on the embedding backfill and semantic generator (worker plus config). The code is there and the data is 0.
2. **(S)** Make cheque size computable from the company's raise when it is shared with the investor. Unknown stays unknown.
3. **(M)** "Q noticed" mandate suggestions: from Pass reasons and Saves, Q _proposes_ a mandate edit ("you passed 6 pre-revenue B2C; add exclusion?"). It is applied only on approval. Observed behaviour never silently rewrites the mandate.
4. **(M)** A "What Q knows about your thesis" page: declared rules, Q-inferred tendencies (labelled Q_INFERENCE), and hard exclusions, each editable.
5. **(L, overdeliver)** Portfolio import, so Q learns from past investments (doc 10 §5.4, PARTLY).

**Strategy.** Investors pay for time saved and for not missing a deal. The boastable point is "Q learns your thesis in a 5-minute conversation and never shows you something you excluded". Learning must stay _explicit_ (suggest, then approve), which is also the trust story competitors cannot tell. Metrics to show:

- the share of the slate the investor saved or expressed interest in (precision@10);
- time from mandate to first relevant company;
- mandate edits accepted from Q suggestions.

**Screens.**

- **Settings → mandate / profile Mandate section.** It needs a "How Q reads your thesis" view with declared rules apart from Q inferences.
- **Discover.** "Why this" should name the mandate rule it matched.
- Pass stays neutral, not red.

## Q.03 Reveals what could stop the raise: **3/10**

**Evidence.**

- **Code.** Marketplace readiness (`packages/companies/src/domain/marketplace-readiness.ts`) is an activation checklist: verification, visibility, required fields. Its own header says "Marketplace Readiness ≠ Investment Readiness". `readinessLeadLines` (`packages/model-gateway/src/q/own-readiness.ts`) lists the top 3 _activation_ gaps ("Investors can't find your company in Discover yet").
- The Company Intelligence specialist (`packages/q-specialists/src/company/specialist.ts`) gives a prose diagnosis of strengths, gaps and unknowns, and states "It produces no score, no fit, no probability and no InvestIQ result".
- Deck coaching (`packages/evidence/src/domain/deck-coaching.ts`) gives a founder-only 0–5 score for each of 12 deck sections, with rubric gaps. The UI is `DeckCoach` in `company-profile-view.tsx`. It depends on deck readings, of which there are **0** in production.
- **UI.** No readiness screen. **Q.** "What should I do next?" works, but it is about Discover activation.

**Honest gap.** The marketing says Q "scores each business across key investment-readiness factors". No such score exists. `docs/handoff/research/spec-vs-code-2026-10.md` marks "InvestIQ diagnosis LIVE"; that is generous. It is prose, not a pillar assessment.

**Missing, ranked.**

1. **(S)** Fix the deck reader in production (see Q.08). This instantly lights up the founder-only 12-section coaching, which is the closest real thing to a readiness score.
2. **(M)** An InvestIQ pillar _assessment_, founder-only. For each of the pillars already in `BLUEPRINT_PILLARS`, show a status in words (Strong / Developing / Gap / **Unknown**), its evidence, and the blocking gaps. It is computed deterministically from coverage, evidence status and deck coaching. There is no blended percentage, and Unknown is never "weak".
3. **(M)** "What could stop the raise" ranks the top 5 _investor-blocking_ gaps (missing financials, unverified identity, no traction evidence, thin team), each tied to what investors on the platform actually require (public criteria and GateQ gates, never private mandates).
4. **(L, overdeliver)** Readiness per _target investor_, against that investor's public or GateQ criteria.

**Strategy.** This is the founder's "aha" and the free tier's hook (PADL #106: full diagnosis without paid advisory). The boastable point is "Before you pitch, Q tells you the five reasons an investor would say no, and what evidence fixes each". Keep it founder-private: it must never leak into investor ranking (release-blocking firewall invariant). Metrics to show:

- the share of founders who close at least one blocking gap within 14 days;
- the change in investor interest rate after gaps close.

**Screens.**

- **New "Readiness" tab on the founder's own profile, or a Capital → Readiness section.** Pillars as rows with a word plus an icon (never colour alone), evidence count, and "Unknown: not yet shared" in neutral styling. Ask Q opens the diagnosis on the Stage.
- **Capital page `readiness-blueprint-entry.tsx`.** It currently only says "not built". It should host the diagnosis summary and leave the Blueprint as the Pro upsell.

## Q.04 Turns weaknesses into an action plan: **3/10**

**Evidence.**

- **Code.** The Readiness Blueprint contracts exist (`packages/contracts/src/q/readiness-blueprint.ts`, ADR 0036). The route `apps/q-api/src/http/readiness-blueprint.ts` returns **501 NOT_IMPLEMENTED**. The UI entry (`apps/web/src/features/capital/readiness-blueprint-entry.tsx`) says it is not built.
- **What works.** "What should I do next?" gives 3 activation steps. `fill_profile_gaps` (`q-tools/src/tools/profile-gaps.ts`) researches the web for open fields, with sources, behind one approval card. Deck coaching rubric "next rung" lines exist but have no live data. Deck generation from Q (R8) is live.

**Missing, ranked.**

1. **(S)** A deterministic "Next 3 actions" card generated from deck coaching and pending interview questions. Each action says why it matters and what evidence closes it. No model is needed for the list.
2. **(M)** Implement the Blueprint v1: 3/6/12-month sequenced steps from the pillar assessment, with each step citing the gap it closes. Model prose sits over a code-built skeleton.
3. **(M)** Track action completion (append-only), and show progress on Results.
4. **(L, overdeliver)** Investor-specific plans ("to be fundable by fund X: show 3 months of revenue evidence") from public or GateQ criteria only.

**Strategy.** Diagnosis is free and the plan is Pro (billing feature `q.readiness_blueprint` exists). The boastable point is "Q doesn't just grade you, it hands you a plan, then does half of it (drafts the deck, fills gaps from public sources, books rehearsals)". Metrics to show:

- actions completed per founder;
- time from plan to marketplace_ready;
- conversion to Pro.

**Screens.**

- **Capital page.** Replace the "not built" entry with an Action plan board: each step has a status, why, evidence needed and "Let Q do it".
- **Founder Home.** Show today's single next action.

## Q.05 Finds the right investors: **4/10**

**Evidence.**

- **Code.** Founder Discover is ordered on investors' _public_ declared profiles (`apps/web/app/(app)/discover/page.tsx` header). `/investors` and the investor page allow a Connection Request. `find_prospective_investors` (`q-tools/src/tools/find-prospective-investors.ts`) uses network-visible profiles only and says "likely fit, never evidence of interest". GateQ lets a founder check fit against a gate (`apps/web/app/(app)/gateq/page.tsx`).
- **Hosted.** 2 gateways, **0 gateway criteria, 0 applications, 0 inbox items**. 46 interest requests and 23 matches, mostly investor-initiated.

**Honest gap.** "Investors whose mandates … they genuinely meet" cannot be shown to founders. Mandates are investor-private and, correctly, never shape what a founder sees. The honest version is "matches you with investors whose _published_ criteria and _gateway requirements_ you meet, and lets investors find you against their full mandate". "Gateway requirements" is unproven live because no gate has criteria.

**Missing, ranked.**

1. **(S)** Seed and publish real criteria on at least 2 gates, and run one founder application end to end for the demo.
2. **(S)** Founder Discover card: "Meets their published criteria: stage ✓, sector ✓, geography: unknown", using the same parameter words as the investor fit panel.
3. **(M)** Double-opt-in signal: when an investor's (private) slate ranks the founder highly, the investor may _choose_ to reveal "Q flagged you as a fit". Nothing is revealed automatically.
4. **(L, overdeliver)** An "Investors to approach next" sequence (Q.04 tie-in): an ordered outreach plan with drafts for approval.

**Strategy.** Founders measure the platform by qualified conversations, not lists. The boastable point is "every investor Q suggests has publicly said they invest in companies like yours, and you can see exactly why". Metrics to show:

- Connection Request acceptance rate (target: well above cold outreach);
- median days to first investor conversation.

**Screens.**

- **Founder Discover / Investors list.** Add fit words for _public_ criteria and a gate badge.
- **Investor page.** Add "What this investor says they look for" next to your matching facts, with unknown shown neutral.

## Q.06 Finds the right opportunities: **7/10**

**Evidence.**

- **Code.** Precomputed slates with deterministic, versioned ranking (`packages/discovery/src/ranking/`, `slates/`, `rerank/`) and hard eligibility from declared rules only. The fit profile has 9 parameters (`packages/contracts/src/http/fit.ts`) with UNKNOWN first-class and a code-computed score out of 10.
- **UI.** `/discover`, `/investors/top` ("top three side by side"), Explore, the fit panel (`apps/web/src/features/fit/fit-panel.tsx`) with Q's view labelled as Q's.
- **Q.** `fit_top_candidates` and `fit_profile` by voice.
- **Hosted.** 12 investors have current slates, 397 items, all with reason codes.

**Honest gaps.**

- Semantic similarity is configured but empty (0 embeddings). The ranking is effectively stage, geography and taxonomy only.
- **Two different numbers.** Discover's order comes from the slate (3–4 factors), while the "7.5/10" comes from the 9-parameter fit profile. An investor can see a 6/10 above an 8/10.
- The ranking config calls itself "heuristic, uncalibrated". Fine, but do not market the score as predictive.

**Missing, ranked.**

1. **(S)** Turn on the embeddings and semantic generator.
2. **(S)** Align Discover ordering with the fit score, or label the order "by mandate match" and the score "fit detail" so they never contradict.
3. **(M)** Make cheque size and traction factors computable.
4. **(M)** A weekly "new since you last looked" digest. Q Daily exists; tie it to slate deltas.
5. **(L)** Outcome-calibrated config (doc 19 Phase 2) once there are outcomes.

**Strategy.** This is the investor's daily habit and the proof Q is not a database. The boastable point is "no pay-to-rank, no engagement bait: every company is here because of a rule you declared, and Q shows its working". Metrics to show:

- save or interest rate on the top 10;
- the share of slate companies the investor had never heard of;
- time saved per week.

**Screens.**

- **Discover desktop.** "Why this" should name the matching rules.
- **Top three.** Fine as it is.
- **Explore.** Posters are full-size; use tile-size posters.

## Q.07 Lets investors interview the opportunity: **6/10**

**Evidence.**

- **Code.** The Company Intelligence specialist works in this order: canonical state → authorised knowledge → hybrid retrieval → deterministic findings (conflicts, staleness, missing) → one model call. The firewall-scoped plan means founder-private figures never reach the investor run (`packages/q-specialists/src/company/specialist.ts`). Prompt `q-core/src/prompts/tasks/company-analyst.v18.ts`. Documents open in the Q room with read-aloud and page cites (R3, `evidence.document_pages`). Web research gives sourced answers.
- **UI.** Company profile tabs (Overview, Elevator, Deck, Data room, Team), and the "Ask Q" demo step 4 works.
- **Q.** Full voice and text.

**Honest gaps.**

- "Explore the numbers, test assumptions": Q can only test what is on record. With 0 deck readings, 99 claims across 62 companies and 0 contradiction sets, most answers will be "not on record" (honest, but thin).
- There is no scenario or assumption tool (for example "what if growth halves: runway?"). Combination risk (cash + burn + payroll implies runway) also has to stay firewalled.

**Missing, ranked.**

1. **(S)** Fix deck readings so investor-visible confirmed sections feed Q.
2. **(M)** An "Assumption check" answer card: Q lists the founder's stated figures that the investor may see, the evidence status of each, and what is unsupported, with no invented numbers.
3. **(M)** "Questions to ask the founder", generated from unknowns, which the investor can send as a diligence request (the diligence tables exist; 2 requests live).
4. **(L, overdeliver)** A simple deterministic what-if calculator over disclosed figures only, labelled ESTIMATE.

**Strategy.** This saves the investor's first meeting. The boastable point is "by the time you meet the founder, you've already asked 20 questions, and Q told you which answers are evidenced". Metrics to show:

- Q questions per company before first meeting;
- the share of first meetings that move to diligence.

**Screens.**

- **Company profile → Ask Q.** A pinned "What's evidenced / claimed / unknown" board on the Stage (truth class and evidence status as separate labels, no %).
- **Diligence page.** Add "Send Q's questions".

## Q.08 Understands every business the same way: **4/10**

**Evidence.**

- **Code.** `DECK_SECTIONS` holds 12 sections, the same for every company, with unknown allowed and truth and evidence axes (`packages/contracts/src/http/deck.ts`). The worker `apps/workers/src/evidence/deck-reading-handler.ts` is composed only when a model provider exists. Founder confirmation goes through the Write Gate before investors see anything. Profile sections are standardised (`/profile`, LinkedIn layout), and so is the Standardised Core + Flexible Story (PADL #100).
- **Hosted.** **21 active PITCH_DECK documents, 234 `document.ready` outbox events, 0 `deck_extractions`, 0 confirmations.**

**Honest gaps.**

- The demo script says "Q has read the deck into the same twelve sections for every founder". In production that reading has never been stored. Either the reader is not composed on Render workers (no model provider), or it fails silently ("a model failure stores nothing").
- There is no standard financial or KPI schema across companies, and no "Standardised Investment Intelligence Report" (GateQ spec §27).

**Missing, ranked.**

1. **(S)** Diagnose why `deck_extractions` = 0: check the worker env model providers and logs for `deck-reading`. Backfill the 21 decks and add an alert when a ready PITCH_DECK has no reading after 10 minutes.
2. **(S)** A founder "Confirm Q's reading" prompt so readings become investor-visible.
3. **(M)** A standard KPI block (revenue band, growth, margin, burn band, runway band, customers) with unknowns, shared by profile, fit and compare.
4. **(M)** A one-page Standardised Investment Report (the deck pipeline already renders PDFs), investor-scoped.
5. **(L)** Sector lenses over the standard core.

**Strategy.** Standardisation is what lets an investor compare 50 companies in an hour, and it is the substrate for Q.03, Q.06 and Q.07. The boastable point is "every company on Capital Q, the same 12 sections and the same KPIs, with every number tagged claimed, evidenced or verified". Metrics to show:

- the share of marketplace-ready companies with a confirmed 12-section reading;
- the share of standard fields known.

**Screens.**

- **Company profile → Pitch deck tab.** When no reading exists it should say "Q hasn't read this deck yet" and never imply standardisation.
- **Compare view.** Rows are the 12 sections and the KPIs.

## Q.09* Prepares founders for meetings (rehearsal): **6/10**

Rehearsal rooms with 6 investor personas and per-slide coaching are live (`/investors/[id]/rehearse`, ADR 0029; 18 hosted). Missing:

- **(M)** A rehearsal scorecard over time, founder-only.
- **(S)** Check that the rehearsal persona for a named investor is seeded only from that investor's _public_ profile (not verified in this audit).

## Q.10* Compares opportunities: **6/10**

"Top three side by side" is live. Missing:

- **(S)** Compare 2–5 from Saved on a screen.
- **(M)** Compare rows from the standard structure (Q.08).

---

## Top 8 for a demo tomorrow (S/M only, highest leverage first)

1. **(S) Fix and backfill the deck reader in production.** 21 decks, 0 readings. This unblocks Q.08, Q.03 coaching, Q.07 depth, and makes demo step 3 true.
2. **(S) Turn on embeddings and the semantic slate generator.** 0 embeddings today, so ranking silently drops a whole factor (Q.02, Q.06).
3. **(S) Founder Home "Q still wants to know" stack.** Surfaces the 179 pending interview questions and makes answering close them (Q.01).
4. **(S) A deterministic "Next 3 actions" card** from deck coaching, pending questions and activation gaps. This is the honest v0 of Q.03 and Q.04, founder-only.
5. **(M) InvestIQ pillar status in words** on a founder Readiness section: Strong / Developing / Gap / Unknown, with evidence and no %. This is the missing "score" of Q.03.
6. **(S) Seed 2 GateQ gates with criteria and run one founder application end to end** (Q.05; today 0 criteria and 0 applications).
7. **(S) Reconcile Discover order with the "x/10" fit score**, or label them distinctly, so an investor never sees 6/10 above 8/10 (Q.06).
8. **(M) "Assumption check" and "Questions for the founder" answer card for investors**, from disclosed figures with truth and evidence labels, sendable as a diligence request (Q.07).

## Claims that would be dishonest today

- **Q.03 "scores each business across key investment-readiness factors".** No such score exists. Say "diagnoses" until item 5 ships, and even then it shows status words, not a number.
- **Q.04 "action plan".** The Blueprint returns 501. Today it is "next steps", not a plan.
- **Q.05 "investors whose mandates … they genuinely meet".** Founders are matched on investors' _public_ criteria only, by design. Mandate matching runs only on the investor side. "Gateway requirements" has 0 live criteria.
- **Q.02 "continuously personalises / learns how each investor thinks".** Nothing learns from behaviour, semantic matching is off, and cheque size does not affect order. Say "built around your declared thesis; updates whenever your thesis or the market changes".
- **Q.08 / demo step 3 "Q has read every deck into the same twelve sections".** It has read none in production.
- **Q.01 "asking deeper questions as it learns".** Defensible for upload-driven follow-ups, but 0 have been answered and financials are not interviewed in depth. Avoid "financials" until the financials step ships.
- **Any "AI-scored", "% match" or predictive language for the 7.5/10.** The config itself says "heuristic, uncalibrated … not a probability, not a quality score". Present it as "how well this fits your declared mandate".

## Invariants every fix above must keep

- No invented confidence %.
- Unknown is shown neutral and never counts as negative.
- Founder-private readiness, coaching and runway never reach investor ranking or views (release-blocking).
- Ranking stays deterministic and versioned.
- Observed behaviour only ever _proposes_ mandate edits.
- Pass stays neutral.
- Glow on Q only (ADR 0017 F2).
- Stage + Board for Q answers (F3/A1).
