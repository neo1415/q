# CAPITAL Q — UNICORN PREDICTOR™ v1
## Research-grounded provisional methodology and ONE-SESSION Claude implementation directive

**Prepared 17 October 2026.** For the Capital Q repository `neo1415/q`, baseline `recovery/2026-09-12`, integrated branch `build/int-rc`. Refresh GitHub before working. This document is both the product specification for **shipping now** and a narrowly-scoped academic-methodology note. Implement a **heuristic indicator, not a calibrated probability**. It supplements, but does not supersede, locked PADL and approved product specifications.

---

# PART A — PRODUCT / ARCHITECTURAL DECISIONS

**Ship the feature in this session.** Do not defer for historical machine learning, benchmark datasets, a new data platform, or an all-encompassing institutional review. Deliver a secure, evidence-backed, deterministic, versioned 0–100 **Unicorn Potential** signal that works on authorized real and synthetic company profiles using existing Capital Q data.

**Preserve three distinct displays and definitions:**
- **Investability** = institutional assessment of the company, InvestIQ v2 (currently shipped). Existing `packages/readiness/src/investability/{assess,observe,postgres,service}.ts` and `packages/readiness/src/investiq/method-v1.ts`.
- **Suitability** = investor-specific thesis/mandate fit, existing `packages/discovery/src/fit/{config,order}.ts`. `fit-order.v2` uses **0.75 Suitability and 0.25 Investability** for the *existing* default Discover order; this blended internal ordering must not change as a side effect of adding Unicorn Potential.
- **Unicorn Potential** = characteristics of exceptional scalability/growth, separate 12-pillar assessment. Never blend or substitute it for Investability/Suitability.

**Reuse UI:** `apps/web/src/features/scores/{company-scores,use-company-scores}.tsx`, its `CompanyScoresDto` and its full/compact/minimal variants, plus existing company profile, Q Cards and Discover surfaces. Add a third, distinguishable **optional** assessment with a `Why` disclosure; do not redesign the app. The exact DTO and component path may be updated if the current repo changed. Prefer a compact third score/label on profile, optional well-spaced badge on cards, and a dedicated full-width expandable assessment panel below the overview for evidence, 12 pillars, confidence, momentum, sources and gaps. Keep small phones usable. Provide a premium investor filter in Discover that is **explicit** and independent of the existing default order, with no hidden rank effect on non-premium users.

**Entitlement:** Following the developer brief, premium read authorization must be checked **server-side** on assessment endpoints, Q tool responses, discovery filters, exports and any precomputed cache; do not reveal scores through free responses. For demo, provision a legitimate test entitlement in the existing billing/permissions system, *not* a client-side bypass. Founders may receive separate expressly permitted improvement guidance without disclosure of investor-private data.

**Caveat for UI, answers and documentation:** “Unicorn Potential is an evidence-based growth-characteristics indicator. It is not the probability of reaching a $1 billion valuation.” Show this alongside the detail view. No phrases such as “83% chance”, “will become a unicorn”, “predicts $1B in five years” or “scientifically validated”. `80/100` means only “indicator score 80 out of 100 under an initial rubric”.

**Architecture:** Q remains an analyst, not source of truth; company/IIR remains canonical. Founder-private, investor-private, organization-private and relationship-shared sources cannot bleed across Context Firewall boundaries. The new analysis inherits source sensitivity. Method change requires new version/ADR; do not silently override PADL future-forecast restrictions or original seven-dimensional InvestIQ. The proposed 12 pillars are a *separate taxonomy*, not an eighth InvestIQ dimension.

---

# PART B — WHAT ACADEMIC RESEARCH SUPPORTS (AND DOES NOT)

The 12 categories are adapted from the owner's `CapitalQ_Unicorn_Predictor_Developer_Brief.docx` (v0.1). **No paper validates the numerical weights below.** These are explicit, owner-reviewable initial engineering hypotheses, based on the direction of evidence, not coefficients estimated on a labelled unicorn sample.

1. **Founder/team, market and stage sensitivity.** Gompers, Gornall, Kaplan and Strebulaev, *How Do Venture Capitalists Make Decisions?*, *Journal of Financial Economics* 135(1), 2020, 169–190, DOI `10.1016/j.jfineco.2019.06.011`. Survey of 885 VCs at 681 firms; team viewed as relatively important, with stage/industry heterogeneity. https://www.gsb.stanford.edu/faculty-research/publications/how-do-venture-capitalists-make-decisions
2. **Founder experience / timing, not founder celebrity.** Gompers, Kovner, Lerner and Scharfstein, *Performance Persistence in Entrepreneurship*, *Journal of Financial Economics* 96(1), 2010, 18–32, DOI `10.1016/j.jfineco.2009.11.001`. Past successful entrepreneurial experience relates to subsequent outcomes in its VC-backed study; do not deduct points for first-time founders absent negative evidence. https://www.sciencedirect.com/science/article/pii/S0304405X09002311
3. **Independent experimentation and market validation.** Camuffo, Cordova, Gambardella and Spina, *A Scientific Approach to Entrepreneurial Decision Making: Evidence from a Randomized Control Trial*, *Management Science* 66(2), 2020, 564–586, DOI `10.1287/mnsc.2018.3249`. Supports evidence-seeking/customer testing over unsupported conviction. https://pubsonline.informs.org/doi/10.1287/mnsc.2018.3249
4. **High-growth signals need comparable measurement windows.** OECD, *Understanding Firm Growth*, discussion of Eurostat/OECD high-growth enterprises: over 20% annualized growth for three years with a minimum employee base. This is a descriptive established benchmark, **not** a unicorn likelihood threshold or a universal early-stage requirement. https://www.oecd.org/en/publications/understanding-firm-growth_fc60b04c-en/full-report/component-4.html
5. **VC evaluations weigh multiple dimensions.** Kaplan and Strömberg, *Characteristics, Contracts, and Actions: Evidence from Venture Capitalist Analyses*, *Journal of Finance* 59(5), 2004, 2177–2210; NBER working paper https://www.nber.org/papers/w8764. Analysis considers business, people, risk and financing terms. Separate deal terms from exceptional scaling characteristics.
6. **Selection bias/forecast uncertainty.** Hall and Woodward, *The Burden of the Nondiversifiable Risk of Entrepreneurship*, *American Economic Review* 100(3), 2010, 1163–1194, DOI `10.1257/aer.100.3.1163`, shows highly skewed entrepreneurial exit payoffs. https://www.aeaweb.org/articles?id=10.1257%2Faer.100.3.1163
7. **Predictive modeling is future research, not a deployed validated probability.** Maarouf, Feuerriegel and Pröllochs, *A Fused Large Language Model for Predicting Startup Success* (2024, preprint), explores text + structured data on 20,172 Crunchbase profiles; and Dellermann et al., *Finding the unicorn* (2021 preprint), argues for combining quantitative and human expertise under deep uncertainty. https://arxiv.org/abs/2409.03668 ; https://arxiv.org/abs/2105.03360

**Implication for v1:** make weights stage-sensitive, use original source provenance, distinguish claims from validation, show missing evidence, resist hindsight and survivorship bias, and never claim calibrated outcomes. A future v2 can use both unicorns and matched non-unicorns with as-of-date features, out-of-time tests and model calibration.

---

# PART C — PROPOSED EXACT 12-PILLAR METHOD v1.0

## C1. Initial weights (each column sums to 100)

| ID | Pillar from owner's brief | Pre-seed | Seed | Series A / Growth |
|:--:|---|---:|---:|---:|
| P1 | Founder quality & founder–market fit | 15 | 12 | 8 |
| P2 | Market opportunity & expansion | 15 | 14 | 11 |
| P3 | Problem intensity & product–market fit | 15 | 14 | 10 |
| P4 | Traction & growth velocity | 8 | 12 | 16 |
| P5 | Business model & unit economics | 6 | 8 | 12 |
| P6 | Defensibility & competitive moat | 8 | 9 | 9 |
| P7 | Distribution & organic influence | 5 | 7 | 8 |
| P8 | Capital strength & investor support | 5 | 6 | 6 |
| P9 | Team & execution | 8 | 7 | 6 |
| P10 | Timing & structural tailwinds | 5 | 4 | 3 |
| P11 | Scalability & operating leverage | 6 | 5 | 9 |
| P12 | Ecosystem position & strategic optionality | 4 | 2 | 2 |
| **SUM** | | **100** | **100** | **100** |

These numbers are *Capital Q product assumptions*, NOT estimates from cited studies. **Don't multiply these by existing Investability weights or overlay Fit weights.** Map stage explicitly; if the stage cannot be established, do not fabricate one and withhold an overall rating while showing known pillars.

## C2. Two observable criteria per pillar (equal criterion weights, 0.5 + 0.5)

| Pillar | Criterion A | Criterion B | Typical authorized source |
|---|---|---|---|
| P1 | Direct experience/expertise relevant to problem and customer | Adaptability and proven founder execution | Confirmed team bios; cited role history; milestones |
| P2 | Independently reasoned accessible market size/demand | Credible adjacent/geographic expansion path | TAM evidence with assumptions; market studies; distribution plan |
| P3 | Problem severity, willingness to pay/use | Repeated customer adoption/retention or convincing stage-appropriate tests | Interviews/pilots; renewal/cohorts; product evidence |
| P4 | Dated revenue/user/usage growth velocity | Quality of traction (repeatable, retention-supported, not vanity counts) | Periodized metrics, cohort records, operational documents |
| P5 | Unit contribution economics/pricing evidence appropriate to sector | Sustainable customer acquisition and monetization path | Finance docs; modeled economics **labelled forecast**; CAC/payback if valid |
| P6 | Actual differentiated asset/technical/data/network advantages | Independent test of defensibility/competitive alternatives | IP/licensing, technical and competition evidence |
| P7 | Repeatable acquisition and partner channels | Organic/referral/community pull or sales channel efficiency | Campaign/cohort acquisition, channel agreements |
| P8 | Credible funding runway/capital access | Quality and relevance of real investor/strategic support | Dated cash-runway evidence; documented financing/partnerships |
| P9 | Complementary team/coverage of critical functions | Demonstrated delivery against time-bound milestones | Canonical team and milestone history |
| P10 | Evidence of a timely structural demand/technology/regulatory shift | Ability to exploit the time window realistically | Dated sourced market/regulatory evidence |
| P11 | Growth decoupling from proportional costs | Repeatability across customers/geographies/business units | Margins at scale, operating model, deployment repeatability |
| P12 | Strength of ecosystem access/partnerships | Strategic opportunities beyond the initial niche | Dated partnerships, platform/network position |

**Do not infer personal psychology or demographic identity as founder quality.** Track record evidence is a positive observable, not a requirement to have founded a company before. Financing received does not itself establish product quality. A press announcement is never independent proof of revenue.

## C3. Evidence and criterion score anchors

Each criterion has a state: `UNKNOWN | OBSERVED | CONFLICTED | NOT_APPLICABLE | STALE`. `NOT_APPLICABLE` requires an explicit, versioned sector/stage rule and justification; default UNKNOWN when unsure. A conflict is shown separately and does not silently resolve to the most favorable statement. Evidence classification must point to existing source IDs, permitted visibility scopes, timestamps and supporting claims.

For **OBSERVED** applicable criteria only, use a deterministic 0–4 evidence-anchored rubric:
- `0` — affirmative credible evidence that the criterion materially fails or is adverse; **not** absence.
- `1` — concrete weakness/negative indication.
- `2` — plausible or mixed signal on limited evidence.
- `3` — positive evidence with demonstrated stage-appropriate execution (founder statement alone may yield at most 3, and must remain labelled self-reported).
- `4` — sustained, strong **documented/corroborated** signal relative to stage and sector with sufficiently current supporting evidence.

**Criterion grades must have explicit anchors and source references.** Define 2–3 bounded indicator rules per criterion from canonical observations; if a criterion cannot be graded deterministically without fabricating a benchmark, set UNKNOWN. No LLM-assigned 0–4 numbers. LLM may extract proposals and draft explanations with provenance, but executable code performs classification and calculation. Use existing InvestIQ `observe...`, `assess...`, `service...` patterns.

Map evidence quality for confidence only:
- Platform- or independently verified `r = 1.0`;
- independent third-party corroboration or reliable document-supported `r = 0.85`;
- a specific founder/company document or third-party report that does **not** independently verify the claim `r = 0.7`;
- founder self-report/company website `r = 0.5`;
- explicitly labelled Q inference `r = 0.25` **and must not by itself make a criterion OBSERVED**;
- no admissible evidence `r = 0` and UNKNOWN.

If stale, use an **explicit criterion-specific freshness rule**: date recorded and described as stale, confidence quality reduced (example `r *= 0.5`), and exclude from any *current* growth-velocity calculation if the period is too old. Never treat an undated metric as a fresh time-series datapoint. These multipliers and thresholds are provisional policy, not learned weights.

## C4. Equations (implement in TypeScript with precise deterministic rounding)

Let pillar `j` have stage weight `w_j`, two applicable criterion weights `a_jk` (0.5 each by default), factual grade `g_jk ∈ {0,1,2,3,4}` only for **scored** criteria, and evidence reliability `r_jk ∈ [0,1]`.

1. Within each pillar, weighted score of **observed** applicable criteria:

   `P_j = Σ_k(observed a_jk × g_jk) / Σ_k(observed a_jk)`.

   `P_j = null` if no criterion is scoreable; a pillar with only one observed criterion carries partial coverage.

2. Criterion and pillar coverage:

   `C_j = Σ_k(observed a_jk) / Σ_k(applicable a_jk)` (if no applicable criteria, pillar inapplicable with documented rationale; never auto-exclude underperformers).

   `C = Σ_j(applicable w_j × C_j) / Σ_j(applicable w_j)`.

3. Overall *raw potential signal* (only if eligible coverage; `w_j` are stage weights):

   `P = Σ_j(scored w_j × P_j) / Σ_j(scored w_j)`.

   `UPS = Math.round(25 × P)` yields `0..100`. **Round once only at the end**. No `UPS` if coverage gate fails. No auto-imputation or neutral `2` for unknown criteria.

4. Evidence confidence index, **distinct from the potential grade**:

   `K = [Σ_j(applicable w_j × (Σ_k(observed a_jk × r_jk) / Σ_k(applicable a_jk)))] / Σ_j(applicable w_j)`.

   Confidence: HIGH if `K >= .75`, MODERATE if `.50 <= K < .75`, LOW otherwise. Keep numeric K internal; UI may show its labeled category. A high raw score based mostly on self-report can never claim HIGH confidence.

5. Initial score gates: **require** known stage, weighted `C >= .60`, **at least six scored pillars**, scored P1/P2/P3 and at least one of P4/P7. A failure gives `overallScore: null`, `status: INSUFFICIENT_EVIDENCE`, `coverage`, `confidence` and concrete missing inputs. Allow appropriately documented sector/stage-specific inapplicability but guard against gaming through arbitrary exclusions; stage rules versioned and subject to regression tests.

6. UX bands, labelled as provisional signals (NOT likelihood): `0–39 = LIMITED_INDICATORS`, `40–59 = DEVELOPING`, `60–79 = STRONG_SIGNALS`, `80–100 = EXCEPTIONAL_SIGNALS`. Also show evidence confidence and stage, which qualify the meaning. Do not show `0` when unscored.

7. **Momentum:** `Δ = UPS_t - UPS_previous` **only if** the previous snapshot has the same method version and comparable applicable stage/cohort assumptions. Show `+n` or `−n` points alongside dates **and drivers**; explain whether due to new evidence, fact correction, source aging, or observed business change. No comparable prior point → `Not enough history`. No generated trend chart on a single point.

8. **Benchmarks:** Do not fabricate cohort percentiles. If enough eligible real comparison observations with compatible stage/sector/geography/metric definitions are present and permitted, use an explicitly described cohort and its *sample size* (future enhancement). Otherwise `Comparable benchmark unavailable`. Synthetic/demo companies are **not** normative reference data.

9. **Top 3 reasons/gaps:** rank by each observed pillar's weighted, traceable deviation from stage-normalized reference grade `2`, but **the reference is an explanation anchor only**, never inserted as a fake score. Gaps come from UNKNOWN/CONFLICTED criteria sorted by stage weight and significance. Explain the specific new document/dated metric that could change the score. If fewer than 3 real reasons, show fewer; do not fabricate.

10. **Idempotency:** `basis_hash = SHA256(canonical_json({methodVersion, inputRulesVersion, stage, applicability, observedCriterionIds, evidenceIds+revisions+timestamps, grades, reliability}))`. Recompute on changes and append an immutable snapshot only when hash differs; retries and same evidence never duplicate snapshots. Ensure deterministic stable ordering.

**IMPORTANT REUSE:** Study the existing `INVESTIQ_V2_ARITHMETIC`, `assessInvestability`, `INVESTABILITY_METHOD_VERSION`, `InvestabilityStore` and `createInvestabilityService` before implementing. Mirror patterns; do **not** edit their weights or tables to contain Unicorn Potential. Different tables or uniquely typed discriminator/revisions are required to avoid history contamination.

## C5. Example of the formula (illustration only, not a claim about any startup)

Hypothetical fully covered PRE_SEED pillars with P1..P12 grades:
`[3,3,3,2,2,3,2,2,3,3,2,2]` produce
`P = (15×3+15×3+15×3+8×2+6×2+8×3+5×2+5×2+8×3+5×3+6×2+4×2)/100 = 2.66`, so `UPS = round(25×2.66) = 67/100` under the proposed heuristic. **Not 67% chance of unicorn status.** If one of those inputs is missing, recalculate coverage and average over only the observed applicable pillars/criteria rather than setting zero. Check arithmetic in unit tests (the manually added sum should equal 266).

---

# PART D — SHIP SCOPE / CURRENT REPO PATCH MAP

1. **Read preflight sources:** locked PADL, product spec, feature brief, `docs/adr/0074*`, `0075*`, `docs/product-sources/investiq/`, `docs/ai-handoff/STATE.md`, current source. Prepare *proposed* short ADR/addendum about the twelve-pillar separate heuristic and the provisional use of the name Unicorn Predictor. No silent PADL contradiction.
2. **Pure engine:** Prefer `packages/readiness/src/unicorn-potential/{contracts,method-v1,observe,assess,service,postgres,index}.ts` or a similarly cohesive bounded internal package. TS strict, Zod at trust boundaries, version `unicorn-potential.v1.0.0`, deterministic tests for all gates/weights, unit rubric fixtures. Share existing source DTOs and stage normalization; no huge new agent framework.
3. **Persistence:** Append-oriented snapshots scoped to canonical company and organization/tenant as used by the existing readiness stores; method, input/basis hash, as-of, scores, coverage, confidence, pillar breakdown, evidence refs and visibility. No duplicate company identity and no overwriting past snapshots. Versioned migration + tenant/RLS/privilege tests + idempotency. A single routine/event-triggered recompute based on existing investability jobs and a paced backfill, not LLM calls per feed item. Skip unchanged; never overload small Supabase.
4. **API & contracts:** optional nullable `UnicornPotentialDto` integrated with current `CompanyScoresDto` or a distinct, authorized low-latency assessment API; ensure Zod contracts and versioned typed interfaces. Expose up to 12 pillars, top reasons/gaps, score/coverage/confidence, timestamp and momentum; complete evidence drill-down returns only **authorized** source references. **Server-side** premium check on every read/search/filter/export/Q action; caching keys include tenant, org/actor entitlement context and method; invalidation upon subscription or permission changes.
5. **Web UI:** Reuse `apps/web/src/features/scores/company-scores.tsx` (full / compact / minimal), `use-company-scores.ts`, the company investor-profile route, `apps/web/src/features/q-card/*` and Discover filters. Add the third score with calm institutional visual treatment; preserve Investability and Suitability. Mobile should not cram three large numbers into a tiny row; on narrow screens show stacked or two-row layout. One disclosure panel includes 12 pillars, progress bars or compact table, dated reasons, top strengths/gaps, confidence, coverage, change history. Show `Insufficient evidence` cleanly. No big intrusive badge over video.
6. **Q:** Add ONE reusable scoped reader/tool/action for “Assess unicorn potential”, “Why?”, “Which evidence?”, “What changed?”, “Which of my accessible companies have highest potential?” Use deterministic existing assessment; Q writes prose from authorized DTO. Never let premium scores leak to chat for unauthorized actors. Avoid passing all 100+ tools if one typed purpose can directly read. No unnecessary web search as part of score display.
7. **Discover:** Offer a premium filter/sort with explicit user choice (`Unicorn potential`), only for candidates already eligible and authorized. Do not change existing default `fit-order.v2` or use this to override mandate fit. Precompute score in background, paginate, never run expensive scoring on feed critical path. No pitches on non-video Discover feed if that is its existing product rule.
8. **Demo:** Calculate a small set (e.g., 10 real eligible canonical records plus a small clearly marked synthetic fixture set, where authorized) then do a paced backfill limited by the infrastructure; show genuine scores only where coverage threshold passes. No artificial high scores for Capital Q or paid demo customers; no fabricated founder facts. One optional Unicorn chapter or panel in the existing Q Pitch *only after* it passes a native browser test; do not modify certified main tour otherwise.
9. **Review:** Tests for 12 weights sums and applicability, scored/missing/conflict/stale, self-report cap, no-evidence null, historical append, score change driver, deterministic basis hash, rerun idempotency, stage normalization, authorization cross-tenant, premium denial through direct API/Q/export/filters, mobile layout, Q correctness and cached reauthorization. Format, lint, TS check, unit, pgTAP, build, CI, browser investor demo and protected deploy. Verify all four Railway services, migrations and rollback before declaring live.

**One-session critical path:** (i) preflight 15–25 min, (ii) pure engine + 12-pillars 60–90 min, (iii) storage + API security 60–90 min, (iv) UI + one Q reader + optional Discover filter 60–90 min, (v) tests/release/browser 45–90 min. These are *planning bands*, not commitments; if limits interrupt, make small tested PRs and leave a lossless handoff. Do not skip authorization/tests to meet an artificial session timer. First usable vertical slice is scored investor profile + Q “why”, then compact card/filter, then history/momentum if time. **However all capabilities in the developer brief should be targeted now; don't silently defer them.**

---

# PART E — REPAIR PUBLIC-WEB RESEARCH (IN SAME SESSION, BOUNDED)

Owner-observed defect: Q can decline or overrestrict answers when the only public mentions are a company's own site or blogs; public web lookups are also too slow.

**Fix policy, not evidentiary rigor:** Q should answer an explicit public-web request with useful *clearly attributed public claims*, not refuse merely because a blog cannot independently verify them. Four categories:

- **Independently corroborated:** two or more independent credible sources, accurate temporal and subject matching; label externally corroborated only when truly justified.
- **Primary-source statement:** company website/press/blog states X. Allowed answer: “According to the company's website, X [source/date]; I haven't independently verified it.” This is **not** independent verification.
- **Secondary source/report/blog:** “Publication Y reported X [source/date]; independent confirmation not found.” Allow informative summaries with reliability/limitations, and conflicting reports if relevant.
- **No admissible match / dangerous URLs / privacy-denied:** say not found or unavailable, explain why; never fabricate or bypass access restrictions.

**Performance:** inspect `packages/q-research/src/contracts.ts`, where `RESEARCH_BOUNDS` currently allows up to `maxSearchCalls=6`, max 4 planned queries, `searchTimeoutMs=9000`, and up to 5–6 source extractions; these bounds can create slow paths. Do not automatically call all six. Search explicitly requested public information, try canonical data/known citations first; reuse cached recent hits and source summaries (bounded TTL and freshness). Use one relevant query initially; fetch 2–3 top independently relevant pages *in parallel*, stream an early attributed answer, refine only when evidence actually inadequate. Parallelize metadata and safe reads, timebox providers, degrade with sourced partial answer. Avoid expensive public search for questions answerable by permissioned internal data. Never automatically promote a public article into a VERIFIED company fact, canonical metric, or 4/4 score.

**Acceptance cases:**
1. “Find what blogs say about Company X” returns blog claims with URLs and limitations, not false ‘unconfirmed therefore cannot answer’.
2. “Find what Company X says about its traction” answers from the company's own site but labels SELF_REPORTED / COMPANY_CLAIM.
3. “Is their revenue independently verified?” refuses to claim verification from only their own site; explicitly distinguishes the status.
4. Internal-only company risk/mandate questions do not pay for unnecessary web research.
5. Same query repeated while fresh uses cache; public content remains permission-safe and no prompt-injection content triggers agent actions.
6. Capture median/p95 of repeated bounded tests if enough samples; do not claim systemwide p95 from one run.

---

# PART F — DEMO READINESS IS NOT FULL PLATFORM COMPLETENESS

Earlier owner-facing estimate ~90% applied to *funding-demo readiness*, not overall product completeness. The **verified Oct 17 Q Pitch v6 manifest** reports 22/22 investor and 17/17 founder steps production-browser verified, but **all those runs were captions-only**, Q-to-Q was prepared rather than paid live Tavus, and English narration only. Owner mic/speaker echo and voice/Google Meet face still require human test if not subsequently certified. Older engineering state also identifies shared fictional seed password exposed in chat, Google disconnected on owner account, untriaged integration test failures outside CI, and database capacity constraints. Treat those as precise pending checks, not grounds to discard the functional demo.

**For the upcoming funding demo:** preserve currently certified Q Pitch, ensure owner account login/Google is connected if meeting scenes require it, run one real-device full spoken/interruptions test, verify GateQ video eligibility/allowance and one full dossier journey, test premium feature security, and have a captions fallback. For Unicorn Predictor, choose a few **evidence-qualified** companies to demonstrate; show unscored ones honestly.

---

# PART G — READY-TO-PASTE ONE-SESSION CLAUDE KICKOFF

You are the implementation and release lead for `neo1415/q`.

**NEW IMMEDIATE REQUEST: SHIP Unicorn Predictor™ v1 NOW IN THIS SESSION.** I have attached `Capital_Q_Unicorn_Predictor_V1_Research_Methodology_Claude_Single_Session.md` and `CapitalQ_Unicorn_Predictor_Developer_Brief.docx`. Read both COMPLETELY, read current locked PADL and ADRs, inspect the live implementation, then execute immediately. The attachment already specifies researched evidence, numerical stage weights, 24 criteria, score/coverage/confidence/momentum equations, label rules, data handling, safety cases and exact repository integration points. Do not spend the session reinventing scoring weights or producing another speculative architecture report. The weights are approved as **provisional v1 heuristic only**, not statistically validated forecast coefficients. Document that distinction in an ADR/addendum.

You have autonomy to assign parallel agents, refine engineering details, reuse existing working patterns and make routine product decisions without checking each step with me. Do **not** redesign InvestIQ, create new company records, change the existing Discover default order, replace existing Q architecture, violate locked PADL, or compromise tenant, subscription and source visibility.

**Deliver in priority order:** 1) deterministic versioned 12-pillar Unicorn Potential service with documented provisional weights and per-evidence reasons; 2) append-only persisted assessment snapshots/coverage/confidence and safe recalculation; 3) premium-gated authorized API/Q explanation and third score in the existing `CompanyScores` profile/card UI, with excellent responsive institutional UX; 4) optional premium Discover filter and real momentum/history display where comparable history exists; 5) bounded research policy fix so Q gives appropriately labelled answers from company sites/blogs and becomes significantly faster on explicit public searches. Implement the complete brief where feasible within one session. Target a coherent, real end-to-end vertical slice before polish.

**Finish, don't just plan:** tests, migrations/RLS, protected CI, merge, deployment and actual signed-in investor-browser acceptance. Demonstrate an evidence-qualified company, one insufficient-evidence company, one premium-unauthorized actor, a historical re-score, and a public-blog research answer. The on-screen claim must say “not a probability of reaching $1B”. Test mobile. Protect keys, source context and provider budgets. Do not generate arbitrary 95/100 demo scores.

**Q Pitch:** certified investor and founder tours should NOT be redesigned. Only add an optional short Unicorn Predictor segment when this feature is verified live; don't risk the existing tour or voice/nav controls.

If one session cannot finish everything, ship tested vertical increments in order and preserve a lossless handoff identifying exact file paths, PR, CI, migrations, live acceptance and remaining work. Do not claim a code-only implementation is live. Start with a short concrete preflight and EXECUTE rather than asking me broad methodology questions.
