# FDN InvestIQ v1: calibration note

`investiq/v1` is **owner-delegated, pending calibration**. Its numbers are hypotheses (RESEARCH.md). Nothing may consume v1 (Q, Discover, Q Cards, GateQ, matching) until the checks below pass on **3–5 real FDN companies** chosen with the owner (FDN brief p.08 step 5). Each company needs written consent to use its evidence. Use at least one each of pre-seed/seed, Series A and growth/SME, and at least one regulated sector.

## Before the pilot

1. **Inputs.** Today's data cannot band (staging shadow, 28 companies: 26 INSUFFICIENT_EVIDENCE, 2 DEVELOPING capped by LOW confidence; Investment Readiness insufficient for all 28). The pilot needs a producer of merit readings and anchors: an FDN reviewer filling the per-criterion rubric (0–4 with a quoted source), recorded through the deterministic Write Gate. Q may only *propose* anchors.
2. **Blind reference.** Two FDN reviewers each band every pilot company independently (overall, Business Quality, Investment Readiness, per dimension) before seeing v1 output. Adjudicate disagreements and record the reasons.

## What to check per company

| # | Check | Pass condition | Parameter if it fails |
| --- | --- | --- | --- |
| 1 | Band vs adjudicated reviewer band | same band, or one step apart with a recorded reason | band edges (1.5 / 2.0 / 2.75) |
| 2 | Business Quality vs Investment Readiness | v1 reproduces cases where reviewers see a strong business that isn't ready (and the reverse) | output groups; stage weights |
| 3 | Insufficient evidence | v1 says INSUFFICIENT_EVIDENCE exactly where reviewers say they "can't tell yet", and never shows a low band instead | coverage 40% / 60%; Team+Fundamentals rule |
| 4 | Confidence | reviewers' own certainty (high/moderate/low) agrees with v1's level | confidence thresholds; evidence multipliers |
| 5 | Self-reported vs documented | the same facts self-reported vs documented move the band only through confidence/shrinkage, never past READY on claims alone | evidence multiplier spacing |
| 6 | Stage sensitivity | rerun each company under the adjacent stage table; band changes must be explainable | stage weight rows |
| 7 | Weight sensitivity | ±20% on each dimension weight, renormalised; if a band flips, record the company as unstable rather than reading the difference as meaningful | all weights |
| 8 | Withholding | removing the weakest documented observation must not raise the band past what reviewers accept; check whether the coverage gate catches it | coverage rules (known risk: renormalising over scored dimensions rewards withholding) |
| 9 | Conflicts | an open contradiction lowers confidence, withholds the criterion and never lowers the score | conflict handling |
| 10 | Locked rules | no fit, valuation or capital-form recommendation in the output; founder-private evidence never reaches an investor surface | (release blocker, not a parameter) |

## Decide after the pilot

- Adjust parameters only in a new method version (`investiq/v2`). Keep v1 results reproducible from their input hash.
- Whether E&S/exclusion screening (IFC style, RESEARCH R8) becomes a hard flag beside the bands.
- Whether sector modules (regulated, deep-tech, marketplace) need their own criteria (R4 sector IRL variants).
- The user-facing wording of bands and confidence, and who may see them (RECONCILIATION C10).
