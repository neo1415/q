# Metrics audit: every score Capital Q shows (2026-11-07)

- **Owner request:** 6 Nov 2026, 23:35. Audit suitability, the unicorn predictor, reversibility and every other score or metric Capital Q shows, with its UI/UX.
- **Scope:** read-only. No code changed. Branch `audit/metrics`, cut from integration `18a926fe4` (production `64d51b965`).
- **Method:**
  - Four parallel read-only code surveys (Investability and Unicorn; readiness, quality and confidence; fit, ranking and suitability; UI/UX and Q prompts).
  - The lead re-verified every P0 claim by reading the cited lines. Every reference below is `file:line` on `18a926fe4`.
- **Production data:** aggregate SQL reads of production, which holds only fictional demo data. The first two reads succeeded. Later distribution reads were withheld by the session's permission policy, so the distributions below are partial.
- **Governing sources:**
  - PADL: #017 (two scores: business plus confidence), #046 (present reality, not prediction; 🔒), #060–#078 (InvestIQ, chapter 4).
  - Product Specification and docs 13/19.
  - CLAUDE.md invariants.
  - ADRs 0052, 0059, 0068, 0074, 0075, 0076. The owner-approved ADRs amend docs and ADRs, but not the locked PADL. Conflicts are flagged in §3, not resolved here.

---

## 1. Summary

| Metric                                                    | Shown to                                   | Deterministic and versioned                                                              | Verdict                                                                                                                                                                                |
| --------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Investability** (FDN InvestIQ, 0–100, band, confidence) | Investors; drives the Discover order (25%) | Yes (`investiq/v2+investability-inputs.v4`), but its grading version is outside the hash | **Fails.** The confidence cap is not applied, so every live score is LOW confidence yet banded up to STRONG. Presence alone scores 50 ("Investable"). Provisional scores feed ranking. |
| **Suitability** (fit ×10, /100)                           | Investors; pipeline sort                   | Partly: the points are hard-coded, not in `FitConfig`                                    | **Fails.** It shows "100/100" from 1 known parameter, next to a fit band of "Not enough information".                                                                                  |
| **Fit with mandate** (band, confidence, x/10)             | Investors; Q                               | Yes (`FIT_CONFIG_V7`; `INITIAL_HEURISTIC_UNCALIBRATED`)                                  | **Mostly sound.** But the x/10 is an unweighted mean outside the versioned weights.                                                                                                    |
| **Discover order** (`fit-order.v4`, rerank)               | Investors                                  | Yes, but old order versions read the current config live                                 | **Mislabelled.** The UI says "by fit", but the order blends 25% Investability. No LLM, no pay-to-rank, viewing ≠ interest: all hold.                                                   |
| **Unicorn Potential** (premium, 0–100)                    | Investors (premium), GateQ, Q              | Yes (`unicorn-potential.v1.0.0`); regex grading; provisional weights                     | **Overclaims by name.** It conflicts with PADL #046. Bare numbers appear with no caveat on 4 surfaces. The Arabic says "possibility of becoming a unicorn" or "billion-dollar".        |
| **Capital Readiness** (8 pillars) and **Blueprint**       | Founder only                               | Yes (`readiness-rules/v1`, basis hash)                                                   | **Sound by design (no number)**, but: a read failure becomes a "Gap"; a model rubric counts as document evidence; the Blueprint's grounding pair is wrong; one sentence over-promises. |
| **Marketplace readiness state**                           | Gates discovery                            | Yes, pure policy, versioned, audited                                                     | **Clean.** It is mislabelled to Q as "VERIFIED" and conflated with Capital Readiness.                                                                                                  |
| **Q confidence** (5 words)                                | Q answers                                  | Bounded by code; claim-check strips unsourced figures                                    | **Sound, with one gap:** HIGH is not capped when the sources are only self-reported.                                                                                                   |
| **GateQ qualification**                                   | Investors, founders                        | Yes (`gateq-qualification.v1`, no score)                                                 | **Clean.** Unknown never excludes; the investor publishes the criteria.                                                                                                                |
| **Rehearsal score**                                       | Founder                                    | Code-computed from ratings                                                               | **Inconsistent scale:** /10 on rehearsal pages vs /100 on Results; false precision.                                                                                                    |
| **Results and analytics counts**                          | Both sides                                 | Yes; floors                                                                              | **Unknown becomes 0** on Results and in Q's results tool. Analytics (§8 lane) is clean.                                                                                                |
| **Match**                                                 | —                                          | No such metric                                                                           | The word only. "Strong match" and "best matches" blur Fit ≠ Match.                                                                                                                     |
| **Reversibility**                                         | —                                          | Not a metric                                                                             | It is the action-approval classification (NONE/CONFIRM/APPROVAL/NEVER; READ/INSTANT/CONSEQUENTIAL). There is nothing to score.                                                         |
| **Business Quality**                                      | —                                          | Kept separate inside InvestIQ only                                                       | **Never shown on its own.** It is collapsed with Investment Readiness into the one Investability number (PADL #060–#062).                                                              |

**Defect counts: P0 9, P1 18, P2 16 (§4).** The P0s cluster into four root causes:

1. Investability's confidence cap is missing.
2. Suitability scores from one known input.
3. Unicorn Potential's naming and surfaces.
4. The Discover order is labelled "by fit" when it is a blend.

All four have small, local fixes (§5).

---

## 2. Per metric

### 2.1 Investability (FDN InvestIQ)

- **Computed:**
  - `packages/readiness/src/investability/assess.ts:126-520`, over `investiq/assess-v1.ts` and `investiq/method-v1.ts`. Stage weights are at `:54-97`, bands at `:169-174`, coverage at `:177-184`, confidence at `:187-194`. Benchmarks and FX are in `investability/grade.ts`.
  - Stored append-only in `core.company_investability_assessments` (`supabase/migrations/20261228171500_company_investability_suitability.sql`).
- **Consumers:**
  - The investor score card (`apps/web/src/features/scores/company-scores.tsx:249-317`; compact `:222-247`; minimal `:201-219`).
  - The pipeline figure (`apps/web/src/features/relationships/pipeline-score-figure.tsx:21-66`).
  - Discover Q's read (`apps/web/src/features/discover/q-read.tsx:103-145`).
  - Q (`packages/q-tools/src/tools/fit.ts:304`; `packages/discovery/src/fit/service.ts:692-697`).
  - **The Discover order:** `packages/discovery/src/fit/order.ts:174-187`, read by `packages/discovery/src/infrastructure/postgres-company-scores.ts:18-39`.
- **Definition:**
  - Criteria are graded 0–4 against anchors.
  - Shown score = `pointEstimate = 2 + (raw − 2) × min(1, n/3)`, × 25 (`assess.ts:208-230, 483`).
  - When the coverage gates fail, a "provisional" number is still shown (ADR 0075; `:497-519`).
- **Determinism:**
  - Deterministic and append-only with a basis hash.
  - `INVESTABILITY_GRADING_VERSION` (`grade.ts:21`) is **in neither the method version nor the hash**, so benchmark or FX changes move scores without a version change.
- **Invariants:**
  - Context Firewall holds: investor-eligible inputs only (migration `…171500:6-22`; `investability/postgres.ts:164-198`); test `packages/readiness/test/firewall.test.ts`.
  - **Unknown → midpoint:** presence-only material scores 50 and bands "Investable". The test asserts this as "presence alone never moves the number" (`packages/readiness/test/investability.test.ts:254-267`).
  - **Model output reaches ranking:** provisional scores read unconfirmed, model-produced deck readings (`apps/workers/src/investability/composition.ts:67-69`; `observe.ts:560-571, 400-418`; ADR 0075 allows this for scoring), and `postgres-company-scores.ts:27-35` ranks them.
- **Honesty:**
  - **The confidence cap is not applied.** `assess.ts:489-491` and `:515-517` set `band: BAND_WORDS[bandOf(point)]` and `cappedByConfidence: false`. The comment at `:495-496` promises "the band is held at Developing at most".
  - **Production confirms it (aggregate read):** every SCORED row has `confidence = LOW`, while bands run EARLY → DEVELOPING → INVESTABLE → STRONG (scores 31–79).
  - So investors see "Strong · Low confidence" and "Investable · Low confidence". ADR 0074 ("a band held at Developing") and PADL #068 / #071 say otherwise.
  - The label "FDN InvestIQ v1 · on shared evidence" (`packages/contracts/src/http/company-scores.ts:159`) does not match the v2 arithmetic.
  - `method-v1.ts:11-17` still says "CALIBRATION HYPOTHESIS … Shadow only", but the score ranks.
- **Tests:**
  - `packages/readiness/test/investability.test.ts` (15), `investiq.test.ts`, `investiq-v1.test.ts` (the cap at `:388` is tested in v1 only), `packages/discovery/test/fit-order-investability.test.ts`, `supabase/tests/database/rls/976_company_investability_suitability.test.sql`.
  - **No test of the band cap on Investability.**
  - **No evals** (`packages/q-evals` has none for readiness or investability).

### 2.2 Fit with mandate, and Suitability

- **Fit:**
  - Computed at `packages/discovery/src/fit/observe.ts:266-361` → `model.ts:98-190`.
  - Weights in `FIT_CONFIG_V7` (`config.ts:226-237`; nine weights summing to 1; status `INITIAL_HEURISTIC_UNCALIBRATED`).
  - Value = Σ w·outcome / known weight over known parameters. Coverage and confidence are separate words. Hard rules come only from eligibility codes and declared "Must match" settings (`observe.ts:195-258`); unknown never excludes (`:238`).
- **Shown x/10:**
  - `fitScoreOutOf10` (`packages/contracts/src/http/fit.ts:432-451`) is an **unweighted** mean with STRONG=10, PARTIAL=4, MISMATCH=0, UNKNOWN left out. It needs at least 3 known parameters.
  - The points are a hard-coded constant outside the versioned config, so the band (weighted) and the score (unweighted) can disagree.
- **Suitability:**
  - `suitabilityFromFit` (`fit.ts:515-575`) = x/10 × 10, otherwise **the mean over any known parameter, so 1 is enough** (`:525-533`).
  - Asserted by `packages/contracts/test/suitability.test.ts:43-49` (STAGE STRONG alone gives 100, coverage 1/9).
  - Stored in `core.investor_company_suitability`, with no mandate version and no history (`postgres-company-scores.ts:41-66`).
- **Shown:**
  - Profile score card ("Suitability 100/100") beside the fit panel's "Not enough information" (`apps/web/src/features/fit/fit-panel.tsx:120`; `fit-panel-slot.tsx:156-166`).
  - Pipeline cells and sort (`pipeline-score-figure.tsx:39`; `pipeline-toolbar.tsx:117-135`; `pipeline-scores.ts:91-99, 142-145`).
  - Explore tile (`company-scores.tsx:214`) and feed card (`discover/feed-card.tsx:418`).
- **Q disagrees with the UI:** Q's fit tool gives no number in the same case (`packages/q-tools/src/tools/fit.ts:216`).
- **UI accessibility:** fit glyphs differ by shape, not colour alone (`fit-glyph.tsx:10-18`). All score features use `--cq-*` tokens; no raw hex.

### 2.3 Discover order

- **Pipeline:**
  - Base rank `ranking-config.v5`, equal weights (`packages/discovery/src/ranking/config.ts:341-383`).
  - Then `fit-order.v4` (`order.ts:136-146`): a declared-geography tier, then orderValue = (0.75·Suitability + 0.25·Investability)/1, then merit and base-rank tie-breaks.
  - Then `exploration-policy.v1` (`rerank/policy.ts:137-163`).
- **Holds:**
  - No LLM in the path (`order.ts:45-46`). Semantic similarity is embeddings with a recorded configuration.
  - No pay-to-rank: a plan changes only paging depth (`slates/reader.ts:289-296`). The Unicorn sort is the reader's own explicit choice (`:706-717`).
  - Viewing ≠ interest: only exposure, last-seen and passed cross into the rerank (`interaction-rerank-signals.ts:29-34`).
  - Observed behaviour never rewrites the mandate: thesis suggestions are Q_INFERENCE and need a consequential approval (`app-actions/src/actions/investor-promises.ts:326-381`).
- **Fails:**
  - **The UI promises "by fit".** `discover/feed-card.tsx:1310-1323` says "Discover is ordered by fit (fit-order.v1): a higher fit out of 10 is never below a lower one". The shortlist says "Best fit first." (`shortlist.tsx:308`).
  - Under the blend, a 6/10 fit with Investability 100 (70) outranks an 8/10 with Investability 0 (60). The test covers only a 4-point gap (`fit-order-investability.test.ts:65-74`).
  - Unknown Investability counts as equal to Suitability (`order.ts:181`), so sharing less evidence can rank higher.
  - Old order versions read `FIT_CONFIG_CURRENT` and `RANKING_CONFIG_CURRENT` live (`order.ts:52-54, 78-79, 103-104, 138-139`), so `fit-order.v1` now reports ranking-config.v7.
  - The slate does not record the fit config, the Investability method version or the values used (`slates/builder.ts:502-518`).
  - The ranking reader ignores `method_version` and takes the latest `assessed_at` across versions (`postgres-company-scores.ts:27-30`). All 464 production companies have both a v3 and a v4 history.
  - The rerank `withinFloor` can lift an out-of-region company above the declared-geography tier (`rerank/reranker.ts:92-99, 225-230`).
  - Q's top N uses a different comparator: no blend, no tier (`fit/service.ts:627-637`).

### 2.4 Unicorn Potential (premium)

- **Computed:**
  - `packages/readiness/src/unicorn-potential/assess.ts:27-212`, `observe.ts:164-430`, `method-v1.ts:24-364`.
  - 12 pillars × 2 criteria, graded from **English regex rules** or typed structured claims.
  - Stage weights are "owner-approved provisional heuristics, not fitted probability coefficients" (`method-v1.ts:2`).
  - Gates: stage known, coverage ≥ 0.6, ≥ 6 pillars, P1–P3 plus P4 or P7.
  - Append-only snapshots, re-authorised on every read (`migrations/20261228200000_unicorn_potential.sql`, `…201500_unicorn_structured_source_guard.sql`).
- **Consumers:**
  - Discover premium filter and sort (`slates/reader.ts:704-717, 855-917`).
  - Card panel (`apps/web/src/features/scores/unicorn-potential.tsx`).
  - Discover Q's read tile (`discover/q-read.tsx:146-160`).
  - CRM pipeline (`relationships/pipeline-score-figure.tsx:82-150`).
  - GateQ inbox, both sides (`apps/api/src/gateq/unicorn.ts`).
  - Q (`q-tools/src/tools/fit.ts:69-70, 251-269`; `discovery/src/fit/service.ts:700-706`).
- **Holds:**
  - Unknown stays null (`assess.ts:54-57, 85-95`).
  - Confidence is a word.
  - No LLM: Q_INFERENCE and UNKNOWN sources are skipped (`observe.ts:176-181`).
  - Firewall: only universally investor-eligible sources (`composition.ts:45-47`; the contract rejects private lineage, `contracts/src/http/unicorn-potential.ts:51`).
- **Honesty: overclaims.**
  - The name is a forecast. PADL #046 (🔒): "Capital Q shall not position itself as a predictive engine … Any future predictive capabilities shall only be introduced after statistically validated evidence exists." The weights are, by the code's own words, not statistically estimated.
  - The English caveat ("not the probability of reaching a $1 billion valuation", `contracts/src/http/unicorn-potential.ts:18-19`) appears only in the expanded panel and the Discover filter.
  - **Bare "NN" or "NN/100" with no caveat, confidence or coverage** appears on:
    - the Q's read tile (`q-read.tsx:158`, `coverage=""`);
    - pipeline rows (`pipeline-score-figure.tsx:108`; "NN% of evidence" at `:122`);
    - compact cards (`company-scores.tsx:240-244`);
    - the collapsed panel summary (`unicorn-potential.tsx:152-160`).
  - **The Arabic overclaims outright:**
    - "إمكانية أن تصبح يونيكورن" ("the possibility of becoming a unicorn"; `apps/web/src/features/i18n/catalog/discover.ts:275`);
    - "إمكانية الشركة المليارية" ("billion-dollar-company potential"; `relationships.ts:698-704`).
    - The caveat has no catalogue entry.
  - A grade-3 criterion reads "Demonstrated stage-appropriate execution" even on self-reported text (`assess.ts:74`; cap at `observe.ts:416`).
  - Pillar P8 blends runway (readiness) and other investors' support (interest) into "potential" (`method-v1.ts:188-207`).
  - Renormalising over scored pillars lets withheld weak evidence raise the score (`assess.ts:127-131`), the regression named in `INVESTIQ-METHODOLOGY-PROPOSED.md:112`.
- **Tests:**
  - `packages/readiness/test/unicorn-potential*.test.ts` (20 + 8 + 13 + 26).
  - `packages/contracts/test/unicorn-potential.test.ts` (4).
  - `apps/web/test/unicorn-potential.test.tsx` (12).
  - `apps/api/test/gateq-unicorn.test.ts` (8).
  - pgTAP `981`, `983`.
  - **No test of the caveat on compact surfaces, and none of the Arabic wording.**

### 2.5 Capital Readiness and the Blueprint (founder-private)

- **Computed:**
  - `packages/readiness/src/domain/assess.ts:100-297`; signals in `domain/signals.ts:236-431`.
  - Rules are data (`rules/v1.ts`, `readiness-rules/v1`); basis hash over rules and inputs (`application/service.ts:118-124`).
  - The Blueprint is `domain/blueprint.ts:52-103`.
  - **No number:** STRONG/DEVELOPING/GAP/UNKNOWN; UNKNOWN reads "Not shared yet" (`packages/contracts/src/q/readiness.ts:47-54`).
- **Firewall:** holds structurally (`packages/readiness/test/firewall.test.ts:31-50`). But investor-facing Investability and Unicorn live **in the same package** (`readiness/src/index.ts:52-54`), guarded only by string bans (`:53-74`).
- **Defects:**
  - A failed deck or raise read is swallowed into `null` (`service.ts:133-139`) and read as MISSING → "Gap" under "What could stop it" (`signals.ts:391-417`).
  - A model's rubric judgement of the deck counts as EVIDENCED (`signals.ts:210-213`, against `:148-152`).
  - The Blueprint takes the max truth class and the max evidence status independently (`blueprint.ts:59-81`). Verified lines have `ref: null` (`signals.ts:104-111`).
  - "Not shared yet is never counted against you" (`assess.ts:284-285`) is untrue for blocker checks (`:107-112`).
  - **UI:** GAP and UNKNOWN share the dashed "missing" card (`apps/web/src/features/readiness/readiness-section.tsx:128-135`).

### 2.6 Other metrics

- **Marketplace readiness:**
  - Pure policy (`packages/companies/src/domain/marketplace-readiness.ts:13-31, 180-194`); UNKNOWN never counts as met; gates discovery (`postgres-discovery-repository.ts:363`).
  - Clean, except that Q receives it tagged `VERIFIED` / `PLATFORM_VERIFIED` and named "readiness check" (`packages/model-gateway/src/q/own-readiness.ts:120-126`).
- **Q confidence:**
  - Five words (`packages/contracts/src/q/confidence.ts`), bounded by code (`packages/q-specialists/src/company/validation.ts:189-206`).
  - `claim-check.ts` strips unsourced figures.
  - A model's HIGH that rests only on self-reported citations is not lowered.
  - Three confidence vocabularies coexist: Q HIGH/MODERATE/LOW/INSUFFICIENT/CONFLICTING; fit HIGH/MEDIUM/LOW (`fit/model.ts:153-158`); deck extraction HIGH/MEDIUM/LOW. The UI says both "Moderate" and "Medium".
  - An internal taxonomy suggestion default of `"0.6"` (`packages/onboarding/src/application/use-cases.ts:3104`) is invented and not shown.
- **GateQ:** `packages/gateq/src/domain/qualification.ts:310-395`. No score; MATCH / NO_MATCH / UNKNOWN; a required UNKNOWN gives NEEDS_INFORMATION; criteria are confirmed by the investor. Clean.
- **Rehearsal score:**
  - "7.3 / 10" on rehearsal pages (`rehearsal-review.tsx:108-131`; `rehearsals-home.tsx:676-712`) but "73 / 100" on Results (`results/results-dashboard.tsx:1063`).
  - Results compares with any counterpart; rehearsals compares with the same person.
  - Decimals from three word ratings are false precision.
  - `ScoreTrend` is unused.
- **Results counts:**
  - `floored` renders a null count as "0" (`results-dashboard.tsx:966-967`); so does Q's results tool (`packages/q-tools/src/tools/results.ts:158-161`).
  - The tool also sends a raw "seen" count the page hides (`:182` vs page `:597`).
- **Engagement analytics (§8 lane):** floors, weekly batches, visibility levels and "viewing is not contact permission" are enforced in SQL. **Gap:** no Q prompt or tool instruction tells Q never to suggest contacting a viewer; it exists only as code comments and read-item facts.
- **Match:** no metric exists. The words "Strong match" (`contracts/src/http/fit.ts:474`) and "compare my best matches" (`q-tools/src/tools/fit.ts:320`) label fit as match.
- **Reversibility:** not a score. It is the approval classification (`apps/web/src/features/q/control/approval.ts:8-17`; `packages/app-actions/src/define.ts:31, 211-216`). Nothing to fix; the owner may have meant "reversible" actions, which are correctly CONFIRM or INSTANT.

---

## 3. Conflicts with product sources (flagged for the owner, not resolved here)

1. **Unicorn Potential vs PADL #046 (🔒).**
   - The PADL bars predictive positioning until statistically validated evidence exists, and then only as optional advanced intelligence.
   - The premium isolation honours "optional". The **name**, the bare numbers and the Arabic make it read as a forecast, and its weights are self-described as unvalidated heuristics.
   - ADR 0076's "not a probability" is not visible on four surfaces.
   - Options:
     - (a) Rename it to a present-evidence label, e.g. "Scale signals" or "Growth evidence", and keep the method.
     - (b) Keep the name, with the caveat, confidence and coverage on every surface, and record a PADL amendment.
     - (c) Remove it until validated.
   - Recommendation: (a), size M.
2. **Investability bands at LOW confidence vs PADL #017, #068 and #071, and ADR 0074.**
   - #017 pairs every Business Score with its confidence and distinguishes weakness from missing evidence.
   - #068 / #071: missing information is never penalised or assumed.
   - Today the band is uncapped, presence-only gives the midpoint, and the compact line drops confidence.
3. **One Investability number vs PADL #060–#062.**
   - A single headline is allowed by #061, but Business Quality and Investment Readiness must stay available separately and explainably.
   - They are computed separately (`method-v1.ts:100-121`) but never shown. Business Quality has no surface at all.
4. **"Ordered by fit" vs the blended order (ADR 0074 §4; doc 19 explainability).**
   - The blend is owner-approved; the label is not true.
   - Doc 19 requires explainable, versioned ranking. Today's versions are not pinned (§2.3).
5. **ADR 0075 (scores read unconfirmed material) vs CLAUDE.md** ("material Q-extracted facts require confirmation before becoming authoritative").
   - Accepted by the owner for scoring only.
   - The consequence is that model output reaches the default Discover order through provisional Investability. CLAUDE.md says no LLM in the ranking path.
   - Recommend excluding provisional rows from ordering (P0-3), which keeps ADR 0075's display intent.

---

## 4. Defects

Sizes: S ≤ ½ day, M ≤ 2 days, L > 2 days. Each P0 was re-verified by the lead at the lines cited.

### P0: misleading users, trust, invariant

| #    | Defect                                                                                                                               | Where                                                                                                                                                     | Fix                                                                                                             | Size |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| P0-1 | Investability band ignores the confidence cap; all live scores are LOW yet show up to STRONG                                         | `readiness/src/investability/assess.ts:489-491, 515-517` (comment `:495-496`)                                                                             | Cap at DEVELOPING when confidence < MODERATE or provisional; set `cappedByConfidence`; add a test               | S    |
| P0-2 | Presence-only material scores 50 / "Investable" (unknown → midpoint)                                                                 | `assess.ts:271-274`; test `readiness/test/investability.test.ts:254-267`                                                                                  | Return INSUFFICIENT_EVIDENCE when nothing is content-graded; flip the test                                      | S    |
| P0-3 | Provisional, model-derived Investability enters the default Discover order (LLM in the ranking path)                                 | `discovery/src/infrastructure/postgres-company-scores.ts:27-35`; `workers/src/investability/composition.ts:67-69`                                         | Order only on non-provisional rows of the current `method_version`; otherwise treat as absent                   | S    |
| P0-4 | Suitability shows 100/100 from 1 known parameter beside "Not enough information"; the pipeline sorts by it; Q disagrees              | `contracts/src/http/fit.ts:525-538`; `company-scores.tsx:214, 282-299`; `pipeline-scores.ts:91-99`                                                        | Use `fitScoreOutOf10`'s ≥3-known rule; else NOT_ENOUGH_INFORMATION; fix `suitability.test.ts:43-49`             | S    |
| P0-5 | Discover says "ordered by fit" / "Best fit first" while the order blends 25% Investability                                           | `discover/feed-card.tsx:1310-1323`; `shortlist.tsx:308`; `fit/order.ts:174-187`                                                                           | Either apply Investability only within fit ties, or say "by fit, then Investability"                            | S–M  |
| P0-6 | Unicorn Potential shown as a bare number with no caveat, confidence or coverage on 4 surfaces                                        | `discover/q-read.tsx:146-160`; `relationships/pipeline-score-figure.tsx:108`; `scores/company-scores.tsx:240-244`; `scores/unicorn-potential.tsx:152-160` | Add confidence, coverage and an "indicator, not a probability" note everywhere; caveat in the collapsed summary | M    |
| P0-7 | Arabic labels promise "becoming a unicorn" / "billion-dollar company"; the caveat is untranslated                                    | `i18n/catalog/discover.ts:275`; `relationships.ts:698-704`                                                                                                | Neutral wording; add the caveat to the catalogue                                                                | S    |
| P0-8 | "Unicorn Potential" naming conflicts with PADL #046 (unvalidated heuristics presented as potential)                                  | `contracts/src/http/unicorn-potential.ts`; `method-v1.ts:2`                                                                                               | Owner decision (§3.1); recommend a rename to a present-evidence label                                           | M    |
| P0-9 | Readiness tells founders "Not shared yet is never counted against you", but missing blockers become "Gap" under "What could stop it" | `readiness/src/domain/assess.ts:284-285` vs `:107-112`                                                                                                    | Reword truthfully ("missing items expected at your stage show as Gaps; nothing unshared is read as a weakness") | S    |

### P1: correctness, reproducibility, consistency

| #     | Defect                                                                                                                | Where                                                                        | Fix                                                                                         | Size |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---- |
| P1-1  | Ranking reader mixes method versions (latest `assessed_at` across v3/v4)                                              | `postgres-company-scores.ts:27-30`                                           | Filter on the current method version                                                        | S    |
| P1-2  | Unknown Investability counts as equal to Suitability, so less evidence can rank higher                                | `fit/order.ts:181`                                                           | Fit first; Investability only within ties (with P0-5)                                       | S    |
| P1-3  | Order versions read the current configs live; slates don't record input versions                                      | `order.ts:52-54, 78-79, 103-104, 138-139`; `slates/builder.ts:502-518`       | Literal versions per order version; persist the fit config, Investability method and values | M    |
| P1-4  | x/10 fit score is unweighted and outside the versioned `FitConfig`; band and score can disagree                       | `contracts/src/http/fit.ts:432-451`                                          | Move the points, or a weighted score, into `FitConfig` tied to `configVersion`              | M    |
| P1-5  | Grading/FX version is not in the method version or the hash                                                           | `investability/grade.ts:21`                                                  | Fold into `INVESTABILITY_METHOD_VERSION`                                                    | S    |
| P1-6  | Label "FDN InvestIQ v1" vs v2 arithmetic; method header says "Shadow only"                                            | `contracts/src/http/company-scores.ts:159`; `investiq/method-v1.ts:11-17`    | Derive the label from the version; update the header                                        | S    |
| P1-7  | Business Quality and Investment Readiness collapsed into one shown number                                             | `investability/assess.ts:443-519` vs `method-v1.ts:100-121`                  | Show the two supporting assessments under the headline (PADL #061/#062)                     | L    |
| P1-8  | Rerank can cross the declared-geography tier                                                                          | `rerank/reranker.ts:92-99, 225-230`                                          | Forbid cross-tier moves; add a combined test                                                | S    |
| P1-9  | Q's top N comparator differs from Discover's                                                                          | `fit/service.ts:627-637`                                                     | Share one comparator                                                                        | S    |
| P1-10 | Unicorn P8 mixes runway (readiness) and others' support (interest)                                                    | `unicorn-potential/method-v1.ts:188-207`                                     | Move out, or mark as non-quality                                                            | M    |
| P1-11 | Unicorn renormalises over scored pillars, so withholding weak evidence can raise the score                            | `unicorn-potential/assess.ts:127-131`                                        | Show an interval, or raise the coverage gate                                                | M    |
| P1-12 | Unicorn P4 freshness is a calendar-year cliff (scores vanish on 1 Jan)                                                | `observe.ts:386-388`; `postgres.ts:81-84`                                    | Use `freshnessDays` only                                                                    | S    |
| P1-13 | Self-reported grade 3 reads "Demonstrated … execution"                                                                | `unicorn-potential/assess.ts:74`; `observe.ts:416`                           | Anchor wording by evidence status                                                           | S    |
| P1-14 | Readiness: a read failure becomes "Gap"                                                                               | `readiness/src/application/service.ts:133-139`; `signals.ts:391-417`         | "Not readable" → null signal plus an uncertainty line                                       | M    |
| P1-15 | Readiness: a model rubric counts as document evidence                                                                 | `signals.ts:210-213`                                                         | Treat as STATED, or require a second source                                                 | S    |
| P1-16 | Blueprint grounding pair can describe no real item; verified lines have no ref                                        | `domain/blueprint.ts:59-81`; `signals.ts:104-111`                            | Derive from the strongest single line; give verification lines a ref                        | M    |
| P1-17 | Unknown counts render "0" (Results page and Q's results tool)                                                         | `results-dashboard.tsx:966-967`; `q-tools/src/tools/results.ts:158-161, 182` | "Not recorded"; reuse the `funnelSteps` rule                                                | S    |
| P1-18 | Compact score lines are silent to screen readers (`aria-label` on `<p>` / roleless `div`, visible text `aria-hidden`) | `company-scores.tsx:203-245`; `q/answer-canvas.tsx:686-694`                  | `role="group"` or sr-only text                                                              | S    |

### P2: polish

| #     | Defect                                                                                                                    | Where                                                                                                                    | Size |
| ----- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- |
| P2-1  | Rehearsal score: /10 vs /100; deltas across counterparts; decimal false precision; "up" arrow on "Same"                   | `results-dashboard.tsx:968-1063`; `rehearsal-review.tsx:112-124`                                                         | S    |
| P2-2  | Results says "None in this period." when rehearsals exist but none is scored                                              | `results-dashboard.tsx:969, 1050-1053`                                                                                   | S    |
| P2-3  | Three confidence vocabularies; "Moderate" vs "Medium" in the UI                                                           | `contracts/src/q/confidence.ts:18`; `fit/model.ts:153-158`; `company-scores.ts:52`                                       | M    |
| P2-4  | Investability compact line drops confidence / "early read"                                                                | `contracts/src/http/company-scores.ts:237-245`                                                                           | S    |
| P2-5  | Mandate fit x/10 in answers vs Suitability /100 on cards: one quantity, two scales                                        | `q/answer-canvas.tsx:409`; `company-scores.tsx:174`                                                                      | M    |
| P2-6  | Unicorn summary prints "Low confidence · 0% coverage" when not assessed; contract confidence LOW on INSUFFICIENT_EVIDENCE | `unicorn-potential.tsx:141-149`; `assess.ts:182-188`                                                                     | S    |
| P2-7  | "could"/"would" drops all of a text's observations, adverse included                                                      | `unicorn-potential/observe.ts:351-356`                                                                                   | S    |
| P2-8  | `notAssessedUnicornPotential` hard-codes inputs v1 (engine v4)                                                            | `contracts/src/http/unicorn-potential.ts:199`                                                                            | S    |
| P2-9  | `FEATURE_UNICORN_POTENTIAL` not in `GATED_FEATURE_KEYS`, yet gates an assessment                                          | `billing/src/catalogue.ts:14-53`                                                                                         | S    |
| P2-10 | Stale comments: "no shrinkage", "four factors" vs 3, "fit order never reads Investability", "no number" for fit           | `investability/assess.ts:54, 203-206`; `fit/service.ts:483-485`; `fit/config.ts:30, 194`; `contracts/src/http/fit.ts:29` | S    |
| P2-11 | GAP and UNKNOWN readiness pillars share one visual style                                                                  | `readiness-section.tsx:128-135`                                                                                          | S    |
| P2-12 | Touch and focus gaps: activity bars are pointer-only; score-trend points 24px; `UnicornFigure` link without min height    | `activity-bars.tsx:55-63`; `score-trend.tsx:82`; `pipeline-score-figure.tsx:101`                                         | S    |
| P2-13 | Fit-line truncation can cut "unknown" on phones; raw `text-[12.5px]`; untranslated strings                                | `relationship-fit-chips.tsx:38-87`; `discover-filter-controls.tsx:155-189`                                               | S    |
| P2-14 | Marketplace-readiness fact tagged VERIFIED and called "readiness check" to Q                                              | `model-gateway/src/q/own-readiness.ts:120-126`                                                                           | S    |
| P2-15 | Q confidence HIGH is not capped for self-reported-only citations; invented `"0.6"` taxonomy confidence (internal)         | `q-specialists/src/company/validation.ts:189-206`; `onboarding/src/application/use-cases.ts:3104`                        | S    |
| P2-16 | No Q instruction "never suggest contacting someone because they viewed"; Fit called "match"                               | `q-tools` results and engagement descriptions; `contracts/src/http/fit.ts:474`; `q-tools/src/tools/fit.ts:320`           | S    |

**Missing coverage:**

- No evals for any score (`packages/q-evals` has none).
- No tests for: the Investability band cap; the Unicorn caveat on compact surfaces or the Arabic wording; `QRead`, `ScoreFigure`, `UnicornFigure` and `SuitabilityFigure` rendering; the rerank and geography-tier interaction.

---

## 5. Recommended order (one lane, about 3–4 days for all P0 and P1 S items)

1. **Day 1 (scores honest; all S):**
   - P0-1, P0-2, P0-3 and P1-1: Investability cap, presence-only, order inputs, method filter.
   - P0-4: the Suitability threshold.
   - P0-9: readiness wording.
   - P0-7: Arabic.
   - Tests for each.
   - Recompute: a new `investiq` method revision through the existing sweep. Old revisions stay reproducible.
2. **Day 2:**
   - P0-5 with P1-2 (fit first, Investability within ties, or say so).
   - P0-6 (Unicorn surfaces).
   - P1-17, P1-18.
   - P1-5, P1-6 (versions and labels).
3. **Owner decisions:** P0-8 (Unicorn naming vs PADL #046) and P1-7 (show Business Quality and Readiness separately). Both can be answered before day 3.
4. **Days 3–4:**
   - P1-3, P1-4 (pinned versions, weighted x/10).
   - P1-8, P1-9.
   - Readiness P1-14 to P1-16.
   - Unicorn P1-10 to P1-13.
5. **P2:** batch with the next polish pass.

Nothing here needs a new provider call. Every fix that changes scores becomes a new method or config version, with old snapshots kept reproducible (PADL #076).
