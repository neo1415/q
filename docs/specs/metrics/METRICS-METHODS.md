# Capital Q metrics: methods

Owner decision 76 (7 Nov 2026): real methods, not caveats. For each score, this document sets out:

- what it is for;
- its equation;
- each input and where it comes from;
- the weights and their sources;
- how unknowns are handled;
- the bands;
- two worked examples;
- where the code and tests are.

The sources, with links, are in [SOURCES.md](SOURCES.md).

**What these scores are, and what they are not.**

- **What they are.** Deterministic, versioned calculations over evidence that investors may see. Their weights are informed by published research on startup outcomes and investor decisions.
- **Not fitted.** No published study estimates weights for these exact dimensions. Every weight below is a **judgment** sized from the direction and relative strength of published effects, and is marked as such.
- **Not validated.** None of them is calibrated on Capital Q's own outcomes yet.
- **Not a forecast.** Nothing here is a probability or a forecast.

**PADL #046 (locked).** It bars predictive positioning until a method is statistically validated. DECISIONS 76 records the conflict for an amendment decision. Until then, the positioning is "based on published research on startup outcomes", never "will become a unicorn".

**Rules shared by all three scores**

| Rule                        | How it is applied                                                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No model in the calculation | No LLM produces or ranks a score. Discover orders by fit first, and Investability only breaks ties (fit-order.v5).                                                                                |
| Unknown is never zero       | An unknown input is left out of the mean. It lowers coverage and confidence, never the number. A number needs enough known inputs; otherwise the score reads as words ("Not enough information"). |
| One compact indicator       | Every number carries one confidence-and-coverage indicator, e.g. "Low confidence · 3 of 9 known". There are no caveat paragraphs.                                                                 |
| Versioned history           | A new version is recorded through the existing sweep as new history. Old assessments are never overwritten.                                                                                       |
| Context Firewall            | Only investor-eligible evidence is read. Founder-private material never moves an investor-facing score.                                                                                           |

---

## 1. Investability (FDN InvestIQ v3)

**Purpose.** How investable the company looks from the evidence investors can see, at its stage. It answers "how strong and how ready is this company, as far as the evidence shows?" It does not say how well the company fits a given investor; Suitability answers that.

**Version.** `investiq/v3+investability-inputs.v6`. Grading version: `investability-grading.v2`.

### Equation

1. **Grade each criterion.** Every criterion with evidence gets a grade g on 0–4 against its stage anchor, where 2 is typical for the stage.
   - A fact merely on record is not graded and does not count toward the number.
   - Contradicted criteria are withheld, not averaged.
2. **Weight each criterion.** A criterion c in dimension d carries u_c = W_d(stage) / A_d, where:
   - W_d(stage) is the stage weight of dimension d (table below);
   - A_d is the number of applicable graded criteria in d.
3. **Average the graded criteria.** Over the content-graded criteria G: raw = Σ_{c∈G} u_c·g_c / Σ_{c∈G} u_c.
4. **Apply credibility (Bühlmann).** The mean's distance from the stage norm (2) is trusted in proportion to the evidence behind it:
   - n_eff = Σ_{c∈G} e_c, where e_c is the evidence weight of the observation that decided c (see the table after this list);
   - Z = n_eff / (n_eff + k), with k = 2;
   - point = 2 + Z·(raw − 2).
5. **Score.** Score = round(25 · point), from 0 to 100.
6. **Band.**
   - The point gives the band: below 1.5 Early, 1.5 to under 2.0 Developing, 2.0 to under 2.75 Investable, 2.75 and above Strong.
   - The band is held at Developing when confidence is Low or the read is provisional.
   - Strong is held at Investable unless Team and Fundamentals are each graded at 2.5 or more.
7. **Confidence.** Confidence (Low, Moderate or High) comes from the weighted coverage and the evidence quality. It is never multiplied into the score.

Evidence weights e_c, which come from the evidence status of the deciding observation:

| Evidence status         | e_c  |
| ----------------------- | ---- |
| Self-reported           | 0.5  |
| Document-supported      | 0.75 |
| Several sources         | 0.85 |
| Verified                | 1    |
| Q's unconfirmed reading | 0.25 |

### Its two parts (owner decision 78, PADL #060–#062)

Under the headline number, each part is scored by the same equation, the same credibility and the same caps, but over its own dimensions only:

| Part                     | Plain sentence shown                                                                      | Dimensions                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Business quality**     | "How strong the business looks: the team, the product and market, traction and finances." | Team, Fundamentals, Commercial, Financial     |
| **Investment readiness** | "How prepared it is for investors: governance, legal basics, the raise and diligence."    | Governance, Legal, Investment case, Diligence |

A part with no graded evidence has no number. It reads "N of M factors on record, not enough to grade yet", or "Nothing shared yet". Readiness facts are mostly only on record today, not graded against a stage benchmark, so Investment readiness will often show the count. That is honest: presence alone never scores (audit P0-2).

The parts are recorded from `investability-inputs.v6` on; older assessments show no parts. Code: `partOf` in `packages/readiness/src/investability/assess.ts`; `INVESTABILITY_PARTS` and `investabilityPartLines` in `packages/contracts/src/http/company-scores.ts`.

### Inputs and their sources in our data

| Input        | Source                                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stage        | Company profile `stage_code`                                                                                                                        |
| Deck facts   | Confirmed deck extraction (`evidence.deck_extractions` and its confirmations), plus unconfirmed investor-visible readings at 0.25 weight (ADR 0075) |
| Claims       | `evidence.claims` revisions with an investor-eligible visibility scope                                                                              |
| Pitch        | A pitch video investors may play, by topic only                                                                                                     |
| Founders     | Investor-visible founder background entries                                                                                                         |
| Verification | Organisation and domain verification                                                                                                                |

### Weights by stage (each row sums to 100; v1/v2 values in brackets)

| Stage    | Team    | Fundamentals | Commercial | Financial | Governance | Legal | Investment case | Diligence |
| -------- | ------- | ------------ | ---------- | --------- | ---------- | ----- | --------------- | --------- |
| Pre-seed | 35 [30] | 30           | 10         | 5         | 5          | 5     | 5 [10]          | 5         |
| Seed     | 30 [25] | 25           | 15         | 10        | 5          | 5     | 5 [10]          | 5         |
| Series A | 20      | 15           | 25 [20]    | 15        | 8 [10]     | 5     | 5 [7]           | 7 [8]     |
| Growth   | 15      | 10           | 25 [20]    | 20        | 10         | 10    | 3 [5]           | 7 [10]    |

Why the weights changed (all JUDGMENT; sources in SOURCES.md):

- **Team +5 at pre-seed and seed.**
  - VCs most often rank the team as the most important factor, and more so at early stage [S1].
  - A founder whose previous company went public reaches IPO again 30% of the time, against 21% for first-time founders [S2].
  - Same-industry experience roughly doubles the chance of upper-tail growth [S3].
  - Early investors respond to information about the team more than to traction [S4].
- **Fundamentals stay heavy early.** The business, more than the management team, is the durable asset of a venture-backed company [S5]. "No market need" is the most cited failure reason [S13].
- **Commercial +5 at Series A and growth.**
  - Median ARR at Series A has risen to about $2–3M [S12].
  - Only about 12–26% of seed cohorts reach Series A within two years [S10].
  - So commercial proof is the binding constraint.
- **Investment case down.** Valuation and fit with the fund are rarely the most important factor [S1], and terms are contract rather than quality [S15].
- **Governance −2 at Series A.** Professionalisation is largely installed by VCs after they invest [S9].
- **Diligence readiness −1 at Series A, −3 at growth.** The evidence for it is weak.

**Founder grading (`investability-grading.v2`).**

| What the evidence shows                    | Grade | Basis                                                         |
| ------------------------------------------ | ----- | ------------------------------------------------------------- |
| A prior exit (IPO, sale)                   | 4     | [S2]                                                          |
| Founded a company before, outcome unstated | 3     | A prior failure does no worse than a first-time founder [S2]. |
| Relevant experience stated                 | 3     | [S3]                                                          |

Age and education are never graded.

**Credibility.**

- k = 2 is a judgment, informed by Bühlmann credibility [S17] and by Stein shrinkage, which predicts better than raw small-sample means [S18].
- It replaces v2's min(1, n/3), which trusted three self-reported facts in full.
- k is to be fitted as EPV/VHM once Capital Q has outcomes (next round within 24 months).

### Unknowns

- An unknown criterion is never graded and never enters raw or n_eff.
- A material that is merely on record ("a deck exists") gives **no number**: the status is INSUFFICIENT_EVIDENCE, never the stage norm of 50 (audit P0-2).
- Missing evidence is plausibly not missing at random: founders leave out weak facts [S16]. That is why low coverage lowers confidence and holds the band, rather than being imputed.

### Worked examples (fictional companies, computed by the code)

**A. Kibo Pay** (fictional), seed fintech, deck only, all self-reported.

What the deck shows:

- the CEO founded and sold a payments company;
- a CTO with 8 years of experience;
- a $4B TAM with a bottom-up SAM;
- per-seat pricing;
- $45k MRR and 130 customers;
- 14 months of runway;
- a $2M SAFE with use of funds stated.

Result:

- 13 of 48 criteria scored, 3 of 8 areas.
- The deciding grades include: founder quality 4, market size 4, revenue model 3; the rest 2.
- Each fact carries self-reported weight 0.5, so Z is about one half. The point is about 2.7.
- **Score 68.** The point alone would band Investable, but confidence is Low, so the band is held at **Developing**.
- The card reads "Investability 68 · Low confidence · based on 13 of 48 factors".
- Under v2 the same deck read 81.

**B. Duma Freight** (fictional), Series A logistics, thin evidence.

What is shown: a first-time founder; a $2B TAM; $30k MRR (below what is typical at Series A, so traction is graded 1); a raise of $8M.

Result:

- The coverage gates are not met, so this is an early read (provisional).
- **Score 49**, band **Developing**, confidence Low.
- It is never an ordering input in Discover (audit P0-3).

**Code:**

- `packages/readiness/src/investability/assess.ts` (equation, caps, Strong rule, credibility);
- `packages/readiness/src/investiq/method-v3.ts` (weights, k, Strong rule);
- `packages/readiness/src/investiq/assess-v1.ts` (grading and coverage engine, `INVESTIQ_V3_ARITHMETIC`);
- `packages/readiness/src/investability/grade.ts` (grading v2).

**Tests:**

- `packages/readiness/test/investability.test.ts` (band cap, presence-only, credibility);
- `packages/readiness/test/investability-v3.test.ts` (weights, Strong rule, founder grading).

---

## 2. Suitability (fit with the investor's mandate, `ranking-config.v8`)

**Purpose.** How well a company matches what this investor declared they invest in. It answers "is this company in my mandate?" It is not a quality score: Fit ≠ Business Quality ≠ Interest.

### Equation

Over the parameters the investor declared (applicable set A), and those whose outcome is known (K ⊆ A):

- value = Σ_{k∈K} w_k·v_k / Σ_{k∈K} w_k, where v = 1 for STRONG, 0.5 for PARTIAL and 0 for MISMATCH.
- coverage = Σ_{k∈K} w_k / Σ_{k∈A} w_k (weighted).
- Score out of 10 = round(10·value, 1 decimal). Suitability = 100·value, rounded.
- **A number is shown only when all three hold:**
  - |K| ≥ 3;
  - coverage ≥ 0.5;
  - at least 2 of stage, sector, geography and cheque size are known.
    Otherwise the fit reads "Not enough information" and names what is missing.
- **Bands** follow the same value: Strong ≥ 0.9 (and needs High confidence and coverage ≥ 0.6), Good ≥ 0.75, Partial ≥ 0.45, else Weak.
  - A declared "Must match" that mismatches puts the company outside the mandate, with no number.
- Since v8, the band and the number come from one weighted value, so they cannot disagree (audit P1-4). Before v8 the number was an unweighted 10/4/0 mean.

### Inputs

| Input         | Source                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Investor side | The declared mandate: stage, sector, geography and its strength, cheque range, business model, traction minimum, team criteria, thesis text, round terms                        |
| Company side  | Profile, the current raise when disclosed to the investor's organisation or put on its Q Card, confirmed traction, thesis similarity (embeddings with a recorded configuration) |

The comparators (thresholds for each outcome) are in `FitConfig.comparators`.

### Weights (sum 1; v7 in brackets)

| Parameter      | Weight      | Why (JUDGMENT; sources in SOURCES.md)                                                                                                                                |
| -------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sector         | 0.20 [0.18] | VCs that already invest in an industry are about 6× more likely to invest in it [S20]. 61% of VCs specialise by industry [S1]. Specialists perform better [S23].     |
| Stage          | 0.18        | 62% specialise by stage [S1]. Yet 16–43% of deals fall outside the declared stage, mostly in the adjacent one [S27].                                                 |
| Cheque size    | 0.14 [0.12] | A mechanical fund constraint. "Fit with fund" is rated important by 50% of VCs [S1].                                                                                 |
| Geography      | 0.12 [0.14] | Deals 10 miles away happen at twice the rate of deals 100 miles away [S20]. But travel time matters more than borders [S21], and non-local deals perform well [S22]. |
| Traction       | 0.09 [0.10] | Only as a declared minimum.                                                                                                                                          |
| Thesis         | 0.08        | Overlaps sector; measured by similarity.                                                                                                                             |
| Business model | 0.07 [0.06] | Rated important by 83% of VCs [S1], but only as a declared preference.                                                                                               |
| Team           | 0.07 [0.08] | Kept low so that quality cannot dominate a fit score.                                                                                                                |
| Round terms    | 0.05 [0.06] | Valuation is important to 56% of VCs, but the most important factor for only 1% [S1].                                                                                |

**Why PARTIAL = 0.5.** A near miss is worth about half a match: the investment rate halves over ten times the distance [S20], and adjacent-stage deals are the commonest drift [S27].

### Unknowns

- Weights are renormalised over the known parameters (Gower similarity [S28]). Unknown is never MISMATCH.
- Founders may omit unfavourable facts [S29], so a mean over few parameters would be optimistic. Hence the minimum-known rule above, and coverage feeding confidence.
- A parameter the investor gave no preference on is not applicable: it counts toward neither value nor coverage.

### Worked examples (fictional, computed by the code)

**C. Fictional seed fintech vs a seed fund.**

| Parameter      | Outcome      |
| -------------- | ------------ |
| Stage          | Strong       |
| Sector         | Strong       |
| Geography      | Partial      |
| Cheque         | Strong       |
| Business model | unknown      |
| Traction       | Strong       |
| Team           | unknown      |
| Thesis         | Partial      |
| Round terms    | not declared |

- value = (0.18 + 0.20 + 0.06 + 0.14 + 0.09 + 0.04) / 0.81 = **0.877**, so **8.8 / 10**, Suitability **88**.
- Coverage 0.81 / 0.95 = 0.85. Band **Good fit**, confidence Medium.

**D. The same company vs a growth fund elsewhere.**

- Stage Mismatch, sector Partial, geography Mismatch; the rest unknown.
- value = (0 + 0.10 + 0) / 0.50 = **0.20**, so **2 / 10**, Suitability 20. Band **Weak**, confidence Low.

**E. Only business model and traction known.** Coverage 0.16, so **no number**: "Not enough information".

**Code:**

- `packages/discovery/src/fit/config.ts` (`FIT_CONFIG_V8`);
- `packages/discovery/src/fit/model.ts` (`assessFit`, `weightedScore`);
- `packages/contracts/src/http/fit.ts` (`fitScoreOutOf10`, `suitabilityFromFit`);
- `packages/discovery/src/fit/order.ts` (fit-order.v5: fit first, Investability only among equal fits).

**Tests:**

- `packages/discovery/test/fit.test.ts` ("ranking-config.v8");
- `packages/contracts/test/suitability.test.ts`;
- `packages/discovery/test/fit-order-investability.test.ts`.

---

## 3. Unicorn Potential (premium, `unicorn-potential.v1.1.0`)

**Purpose.** An evidence-based reading of the growth characteristics that published research associates with very large startup outcomes, against stage peers.

It is **not** the probability of becoming a unicorn:

- such outcomes are rare (about 1% of seed-funded US companies [S31, S32]);
- reported unicorn valuations are inflated [S35];
- no Capital Q outcome data validates the weights.

The name is kept for now (owner); the PADL #046 conflict is recorded in DECISIONS 76.

### Equation

1. **Pillars.** There are 12 pillars × 2 criteria, each graded 0–4 from investor-eligible evidence. Q inference and unknown-truth sources are skipped.
2. **Pillar grade.** A pillar's grade is the conservative (lowest) grade among its current observations. A conflicted criterion is withheld.
3. **Raw.** raw = Σ_{p∈scored} W_p(stage)·g_p / Σ_{p∈scored} W_p(stage).
4. **Score.** Score = round(25·raw), shown only if all of these hold:
   - the stage is known;
   - coverage ≥ 0.6 of the stage weight;
   - **at least 8 of 12** pillars are graded;
   - founder (P1), market (P2) and problem (P3) are graded;
   - traction (P4) is graded from seed on (at pre-seed, P4 or distribution P7).
5. **Evidence caps.**
   - A self-reported criterion is capped at 3, and reads "as the company states it", not "demonstrated" (audit P1-13).
   - Grade 4 needs sustained, document-supported evidence.
   - Freshness is per criterion, with no calendar-year cliff (audit P1-12).

### Weights (each column sums to 100; v1.0 in brackets)

| Pillar                               | Pre-seed | Seed    | Series A/growth | Basis                                                                                                     |
| ------------------------------------ | -------- | ------- | --------------- | --------------------------------------------------------------------------------------------------------- |
| P1 Founder & founder–market fit      | 18 [15]  | 14 [12] | 9 [8]           | [S2, S3, S1]; weight falls with stage [S5]                                                                |
| P2 Market & expansion                | 15       | 13 [14] | 11              | VC survey [S1]; effect size not established                                                               |
| P3 Problem & product–market fit      | 14 [15]  | 13 [14] | 9 [10]          | Practitioner consensus; no peer-reviewed effect size                                                      |
| P4 Traction & growth                 | 8        | 13 [12] | 18 [16]         | Traction signals [S38, S8]; measurable later                                                              |
| P5 Business model & unit economics   | 4 [6]    | 7 [8]   | 11 [12]         | Weakly supported; meaningful once there is revenue                                                        |
| P6 Defensibility & IP                | 9 [8]    | 9       | 8 [9]           | A first patent grant causes +55% employment and +80% sales growth [S39]                                   |
| P7 Distribution                      | 4 [5]    | 5 [7]   | 6 [8]           | Overlaps traction; kept low                                                                               |
| P8 Investor support (runway removed) | 6 [5]    | 8 [6]   | 9 [6]           | VC quality links to outcomes, but mostly through selection [S7, S36, S37]; capped                         |
| P9 Team & execution                  | 10 [8]   | 8 [7]   | 6               | Functionally diverse teams reach funding and IPO faster [S40]; execution beyond the founder matters [S41] |
| P10 Timing & tailwinds               | 4 [5]    | 3 [4]   | 2 [3]           | Real but external [S42]                                                                                   |
| P11 Scalability                      | 6        | 5       | 9               | Judgment only                                                                                             |
| P12 Ecosystem & optionality          | 2 [4]    | 2       | 2               | Location evidence is about place, not merit, and US-centric [S43]                                         |

**P8 (runway).**

- There is no published evidence that months of runway predict large outcomes. Runway is readiness, so it now lowers the pillar only on distress (insolvency, inability to meet payroll) and never raises it.
- Investor support counts only when executed. It is capped because it encodes other investors' judgment.

### Unknowns

- An ungraded pillar contributes nothing: there is no imputation.
- Coverage is the evidenced share of the stage weight. Below the gates, the status is "Insufficient evidence" with coverage, never 0.
- Data completeness must never raise the score. Naive models on Crunchbase reward visible data, not quality [S34].

### Worked examples (fictional, computed by the code)

**F. Pre-seed company, every pillar evidenced by self-reported claims.**

- Grades P1…P12: 3, 3, 3, 2, 2, 3, 2, 2, 3, 3, 2, 2.
- Σ W·g = 18·3 + 15·3 + 14·3 + 8·2 + 4·2 + 9·3 + 4·2 + 6·2 + 10·3 + 4·3 + 6·2 + 2·2 = 270.
- Score = 25 · 270 / 100 = **67.5, which rounds to 68**. Confidence Low (all self-reported).
- The card reads "Unicorn Potential 68/100 · Low confidence · 97% coverage". Under v1.0 the same evidence read 67.

**G. A company with founder, market, problem, traction and three other pillars.**

- Seven pillars, about 72% coverage. **No number** under v1.1.0, because 8 of 12 are needed; v1.0 needed 6.
- It reads "Insufficient evidence" with the coverage.

**Code:**

- `packages/readiness/src/unicorn-potential/method-v1.ts` (weights, `UNICORN_GATES`, `UNICORN_WEIGHTS_V1_0`);
- `assess.ts` (equation and gates);
- `observe.ts` (grading and freshness).

**Tests:** `packages/readiness/test/unicorn-potential*.test.ts` ("v1.1.0" block: gates, P8, anchor wording).

---

## 4. Limits and next steps

1. **Weights are judgment.** Survey importance and click-through attention are not predictive coefficients. The ML studies' strongest features are financing history, which leaks the outcome.
2. **Selection and geography.** Most evidence covers funded US companies (Carta, Crunchbase, VentureXpert). African and GCC markets have thin exit routes and tiny base rates. US base rates and peer distributions are not imported.
3. **Unverified numbers.** Items marked [S] in SOURCES.md were seen only in secondary summaries. They must not appear in user-facing copy until a person opens the source.
4. **Calibration.** Once Capital Q has dated outcomes:
   - fit Investability's k and band cut-points on "next round within 24 months";
   - fit Suitability's weights by logistic regression on relationship events (intro → meeting → term sheet);
   - validate Unicorn Potential out of sample on cohorts from the target markets before any predictive claim (PADL #046).
5. **Monitoring.** About 12–26% of seed companies reach Series A within two years [S10]. If far more than about a quarter of seed companies band Strong, the scale is inflated. This is a check, not a quota.
