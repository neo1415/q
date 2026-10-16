# InvestIQ methodology: Investability and Suitability (in use from 2026-10-16)

**Status:** in production use by owner direction (2026-10-16): "every company carries two scores, visible to investors, so the investor knows what is worth his time", and "the InvestIQ methodology must actually be used now, and used for ranking." The arithmetic is FDN InvestIQ `investiq/v1` (owner-delegated, DECISIONS.md #24–25). Its constants are still **calibration hypotheses** (CALIBRATION.md): any change is a new method version, and old snapshots stay reproducible. The design history is in [INVESTIQ-METHODOLOGY-PROPOSED.md](INVESTIQ-METHODOLOGY-PROPOSED.md) (v0.2 proposal and offline experiment), [INVESTIQ-RECONCILIATION.md](INVESTIQ-RECONCILIATION.md), `docs/product-sources/investiq/RESEARCH.md` (sources R1–R12) and ADR 0068. The display, ranking and firewall decisions are in ADR 0074.

## Two scores, never one

|                          | Investability                                                                         | Suitability                                                   |
| ------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Question                 | How investable is this company on its evidence?                                       | How well does it fit **this** investor's mandate?             |
| Method                   | FDN InvestIQ v1 over investor-eligible evidence                                       | The "Fit with you" profile (`ranking-config.v4` fit model)    |
| Same for every investor? | Yes                                                                                   | No, per investor and mandate                                  |
| Scale                    | 0–100 integer = InvestIQ overall (0–4) × 25                                           | 0–100 integer = fit out of 10 × 10                            |
| Coverage shown           | "based on 5 of 8 areas" (InvestIQ dimensions scored) and criteria counts              | "6 of 7 known" (mandate parameters with a known company side) |
| Confidence               | InvestIQ discrete HIGH / MODERATE / LOW                                               | Fit confidence HIGH / MEDIUM / LOW                            |
| No number when           | stage unknown, < 60% of stage weight scored, or Team / Business Fundamentals unscored | fewer than 3 known parameters, or a declared rule excludes it |
| Code                     | `packages/readiness/src/investability/`                                               | `suitabilityFromFit` in `packages/contracts/src/http/fit.ts`  |

They are separate (CLAUDE.md: Readiness ≠ Business Quality ≠ Fit ≠ Interest ≠ Match). Neither is shown as a blend. The only place they meet is the Discover ordering key, below, which is never displayed.

## ADR 0075 amendment (owner, 2026-10-16): always present, unconfirmed material counted

Scores read Q's **unconfirmed** reading of decks open to all investors, and the pitch investors may play together with its transcript topics. Both count as Q_INFERENCE · SELF_REPORTED at weight 0.25, below a confirmed founder claim (0.5) and verified evidence (1.0). They are never quoted: the why says "From their own deck, not yet confirmed" or "Stated in their pitch video".

A number is shown whenever any investor-visible material exists. Below InvestIQ's full gates it is a **provisional** score: criterion scores weighted by stage weight per criterion, unknown left out, Low confidence, at most Developing, labelled "early read". Coverage is shown as "based on N of M factors". With no deck, no pitch and no shared claim the investor sees "No pitch or deck shared yet". Inputs version: `investability-inputs.v2`. Production offline count after the amendment: 461 of 461 listed companies scored, 190 of them provisional, all 50–54, Developing, Low confidence.

## Content grading and an unshrunk point estimate (lead, 2026-10-16; ADR 0075 amendment 2)

**Diagnosis.** Under `investiq/v1` with `investability-inputs.v2`, all 461 listed companies scored 50–54. There were two causes.

1. Criteria were graded on _presence_: a deck section on record was anchor 2, the stage norm, whatever it said.
2. Evidence weight shrank every point estimate back to 2: `2 + (anchor − 2) × w`, with w = 0.5 for a founder claim and 0.25 for an unconfirmed read. A strength of 3 became 2.25–2.5.

**Change** (`investiq/v2+investability-inputs.v3`; the `investability-grading.v1` rules live in `packages/readiness/src/investability/grade.ts`):

- **Grade on content.** Each criterion is graded from what the material states, against stage benchmarks. The grading is deterministic, with no model involved. Anchors run 4 well above typical / 3 above / 2 typical / 1 below / 0 well below; a 0 needs an affirmative statement.
  - Monthly revenue in USD (ARR ÷ 12; a fixed FX table, `fx-2026-10.v1`). Typical range: pre-seed $1k–10k, seed $10k–80k, Series A $80k–300k, growth $0.3m–2m. At or above the top of the range is 3, at least 3× the top is 4, below a quarter of the bottom is 0. Pre-seed is never graded below 2.
  - A stated "no revenue yet": 2 at pre-seed, 1 at seed, 0 at Series A and later.
  - Customer and user counts against stage ranges. They are never graded below 1, because units differ by business model.
  - Headcount and named leadership roles. Founder experience: prior founding or an exit is 4; stated relevant experience, or technical plus commercial founders, is 3.
  - Market size (≥ $1bn is 3, ≥ $20bn is 4, < $100m is 1; a sized reachable segment adds one step).
  - Runway: under 6 months 0, 6–12 months 1, 12–18 months 2, 18+ months 3. Runway after the raise: under 12 months 1, 12–18 months 2, 18+ months 3.
  - Stated pricing 3. Gross margin: ≥ 70% 4, ≥ 50% 3, ≥ 20% 2, below 1.
  - Transcript-derived grades are limited to 1–3.
- **Presence does not move the number.** Criteria merely on record count toward coverage and confidence, not toward the point estimate.
- **Score and confidence are separate.** A criterion scores its graded anchor (no shrinkage). Evidence weight drives confidence and an **evidence range**: each criterion's grade ± 2 × (1 − w), averaged with the same weights. Verified evidence narrows the range; self-reported or unconfirmed evidence widens it. The band follows the score (no confidence cap); confidence is shown beside it.
- **Credibility by the number of graded factors.** One fact cannot make a company Strong or Early on its own: the graded mean's distance from the norm counts in full from 3 graded factors (z = min(1, n / 3)).
- **One weighting.** Every graded criterion counts by its dimension's stage weight shared over the dimension's applicable criteria. Unknown criteria stay out.

**Production distribution after the change** (offline, read-only, 461 listed companies):

- Range 31–81. p10 44, p25 48, median 50, p75 59, p90 66.
- Count by 5-point bucket: 30–34: 4, 35–39: 7, 40–44: 45, 45–49: 72, 50–54: 155, 55–59: 68, 60–64: 56, 65–69: 27, 70–74: 13, 75–79: 13, 80+: 1.
- Every score is Low confidence (the evidence is self-reported).
- Most companies have only 2–4 gradable facts. The spread reflects that; it is not invented.

## Investability: the InvestIQ v1 method

### Dimensions and stage weights

The FDN brief's nine assessment areas (FDN brief p.4). Investor Fit has weight 0: it is the Suitability score, computed by the discovery fit model (locked rule C3). Weights are percentages of the overall assessment (`STAGE_WEIGHTS`, `method-v1.ts`):

| Dimension             | Pre-seed | Seed | Series A | Growth |
| --------------------- | -------- | ---- | -------- | ------ |
| Management & team     | 30       | 25   | 20       | 15     |
| Business fundamentals | 30       | 25   | 15       | 10     |
| Commercial strength   | 10       | 15   | 20       | 20     |
| Financial readiness   | 5        | 10   | 15       | 20     |
| Governance            | 5        | 5    | 10       | 10     |
| Legal & corporate     | 5        | 5    | 5        | 10     |
| Investment case       | 10       | 10   | 7        | 5      |
| Diligence readiness   | 5        | 5    | 8        | 10     |

Basis: team and fundamentals dominate early-stage screening (Payne scorecard, team 30%; Gompers et al. 2020, team the most important factor for 47% of VCs; Mason et al., team the main angel rejection reason). Commercial, financial, governance and diligence weight rises with stage (Blank's Investment Readiness Level; IFC CG progression; YC Series A diligence checklist; Moody's scorecards give finances the largest weight for mature credits). Investment case is about 10% early (Risk Factor Summation: funding and exit are 2 of 12 risks). Full source table: RESEARCH.md R1–R12. These are the standard VC screening criteria (team, market, traction, product, business model, unit economics, competition, risk), mapped to the FDN areas.

Each dimension has the FDN criteria from `method-v0.ts` (48 graded criteria; valuation and dilution are recorded but never graded, rule C8).

### Anchors and evidence

- Criterion anchor 0–4, 2 = stage-appropriate baseline (RFS −2..+2 shifted). Defaults: recorded fact 2, affirmative strength 3, affirmative weakness 1.
- Criterion score = `2 + (anchor − 2) × w` over the observations with the highest evidence weight `w` (no volume bonus).
- `w` = evidence × truth × lifecycle. Evidence: no evidence 0.25, self-reported 0.5, document-supported 0.75, multi-source 0.85, externally/platform verified 1.0. Truth: verified / user claim 1, estimate 0.75, Q inference (with evidence) 0.5. Stale ×0.5. Superseded and evidence-free inference are excluded. **A founder claim moves a criterion half as far from the baseline as verified evidence**, in either direction (GRADE: start by evidence type, downgrade for bias).
- Contradictory or disputed evidence, or strength and weakness together, marks the criterion **CONFLICTED**: withheld, shown as "withheld until reconciled", never penalised (PADL #67).

### Stage handling

- Stage comes from the listed profile. Unknown stage gives no number ("Stage: not stated"), never a default of seed.
- Pre-seed: retention and profitability are NOT_APPLICABLE (PADL #64). They leave the denominator.
- A pre-seed or seed company is never read as weak for having no revenue. The same "pre-revenue" statement at Series A or growth is affirmative weakness.
- Dated, quantified traction, a quantified customer base, dated historical financials and a deep named team are above the baseline at pre-seed and seed. At Series A and growth they are the baseline.

### Unknown, coverage and confidence

- Unknown stays unknown. A criterion with no admissible evidence leaves the mean. It is never zero.
- A dimension is scored at ≥ 40% of its applicable graded criteria. The overall needs ≥ 60% of the stage weight in scored dimensions, plus Management & team and Business fundamentals scored. Otherwise: INSUFFICIENT_EVIDENCE, no number, the coverage, and what is missing, most valuable first.
- Confidence uses weighted coverage `c` and mean evidence weight `q`: HIGH needs c ≥ 0.75 and q ≥ 0.75; MODERATE needs c ≥ 0.5 and q ≥ 0.6; otherwise LOW. Any open conflict lowers it one level. It is never multiplied into the score.
- Investable or Strong needs at least MODERATE confidence. Otherwise the band is held at Developing ("capped by confidence"), and the number is still shown.
- Bands (0–4, shown ×25): Not yet investable < 1.5 (37.5) ≤ Developing < 2.0 (50) ≤ Investable < 2.75 (68.75) ≤ Strong.

### Investor-eligible inputs (`investability-inputs.v1`)

**Context Firewall (release-blocking).** Investability reads only what every eligible investor may see. Every reader names its eligibility in SQL, and the producer checks it again:

| Source                                        | Eligibility                                                                                                                                       | Criteria it can inform                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Listed profile (`knowledge.company_profiles`) | network_visible / public_external and active                                                                                                      | product definition, business model, stage                                                                                                                                                                                                                                             |
| Verification badge (organisation)             | shown to the network                                                                                                                              | incorporation (platform verified: confidence, not merit)                                                                                                                                                                                                                              |
| Founder background lines                      | `visibility_scope = network_visible`                                                                                                              | founder quality (prior company founded or exit = strength)                                                                                                                                                                                                                            |
| Evidence claims                               | `network_visible` / `public_external`, not superseded                                                                                             | by claim type: financial/revenue, traction/metric, customers, market, team, compliance, capital                                                                                                                                                                                       |
| Pitch deck sections                           | deck offered to **all** investors (data room PUBLIC or download open to investors); only sections the founder confirmed or corrected (Write Gate) | problem/solution/value → product; market; go-to-market → distribution; business model (+ pricing → revenue model); traction (+ customers); competition → competitive advantage; financials → historical / forecasts / cash; the ask → raise, instrument, use of funds; founders; team |

These are never read: the capital objective (founder_private until shared), team facts (not investor-visible), the founder's readiness diagnosis and deck coaching, private documents, relationship-shared or specifically-shared material, and investor behaviour of any kind. The negative test is `packages/readiness/test/investability.test.ts` ("Context Firewall"). Adding founder-private, organisation-private, relationship-shared, specifically-shared, investor-private and personal-private claims, plus a founder-private background line, leaves the basis hash and the view identical.

Per criterion, signals with the same evidence weight merge into one observation. The affirmed reading (strength or weakness) wins over "recorded", so adding information never dilutes a strength, and ten copies of a fact count once.

### Explainability

Each Investability carries up to three factors that raised it, up to three that lowered or withheld it, and up to four things that would raise coverage or confidence. Each factor names its source and its evidence status ("Dated traction: $40k MRR · self-reported"). The full InvestIQ trace and the observations are stored with every revision.

## Suitability

This is the existing fit with the investor's declared mandate: nine parameters (stage, sector, geography, cheque, business model, traction, team, thesis, round terms), deterministic and versioned (`ranking-config.v4`). Suitability = `fitScoreOutOf10 × 10`, so it can never disagree with the "x/10" on the fit panel. Unknown parameters are coverage, never low. OUTSIDE_MANDATE comes only from a rule the investor declared. Its "why" is the fit's own strong rows, mismatches and unknowns.

## Ranking (`fit-order.v2`)

Order of the Discover pipeline, unchanged except step 4:

1. Hard eligibility: declared rules only.
2. Candidate generation.
3. The base ranker (`ranking-config.v3`).
4. **Candidates the fit can score** are ordered by `(0.75 × Suitability + 0.25 × Investability) / (0.75 + 0.25)`. Investability enters only when it is SCORED. Unknown Investability leaves the key to Suitability alone, never a low number. Ties fall to the fit tie-break, then the base rank. **Candidates without a fit score keep their base positions**: Investability never promotes or buries them.
5. Exploration and diversity (REC-009), labelled on the card.

The weights live in `FIT_ORDER_V2` (`packages/discovery/src/fit/order.ts`). The slate records `fit-order.v2` as its ranking version. There is no pay-to-rank and no engagement signal, and no model sits in the ranking path. Q's side-by-side top N stays ordered by fit and shows both scores.

## Dynamics and storage

- `core.company_investability_assessments` holds append-only revisions: a new row only when the basis hash (method, input rules, context, observations; never the clock) changes. RLS lets the company's members read it, and any active participant read it while the company is listed. pgTAP suite 976.
- `core.investor_company_suitability` holds the Suitability each candidate was ordered with, per investor organisation and mandate. Only that investor organisation's members can read it. The slate build writes it.
- Recompute: the worker recomputes on `core.company.*`, `core.founder_profile.updated`, `evidence.claim.changed`, `evidence.document.*` (audience, version, ready) and `verification.claim.decided`. Every 30 minutes it also sweeps the companies whose inputs changed since their last assessment, which covers deck confirmations and section reviews (they have no outbox event). That sweep costs one query when nothing changed. Once a day it sweeps every listed company. It is idempotent and makes no model call.
- Backfill: `node apps/workers/dist/backfill-investability.js --apply`, paced at 250 ms per company. A dry run prints only counts.

## First reading of real data (2026-10-16, read-only, offline)

`assessInvestability` was run over production's investor-eligible inputs, read-only through the hosted SQL API, without writing anything. Only aggregates are recorded here.

- 461 companies are listed.
- 16 get a score: 50 to 54, all Developing with low confidence, from self-reported deck sections.
- 445 show "not enough shared evidence yet" (444 of them with 0 of 8 areas scored).
- The cause is the Write Gate. 449 listed companies have a deck offered to all investors that Q has read, but only about 17 founders have confirmed that reading. Unconfirmed Q readings are never investor-eligible.
- No company has a network-visible founder background line, and 10 have network-visible claims.

The lever is founders confirming their deck reading and sharing evidence with investors. The method must not lower its gates to reach a number.

## Known limits

- The constants are uncalibrated. The pilot on 3–5 real FDN companies (CALIBRATION.md) still has to be run, and adjustments become `investiq/v2`.
- Deterministic readings come from structure (dated figures, stated pre-revenue, named team facts, prior-delivery words). They do not come from a reviewer's judgement of quality. Most evidence today is self-reported, so typical scores sit near the baseline with low confidence. That is the honest reading of today's evidence.
- Governance, legal and diligence readiness are rarely evidenced in investor-visible form yet. They mostly stay unknown, which lowers coverage, not scores.
- The renormalisation over scored dimensions can reward withholding a weak dimension. The coverage gates (60% of weight; Team and Fundamentals required) limit this, and calibration check 8 tests it.
