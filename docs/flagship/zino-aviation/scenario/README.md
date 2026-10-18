# Zino Aviation: illustrative high-growth scenario

> **Illustrative high-growth scenario — synthetic evidence. Not the company's actual performance.**

Scenario `illustrative-high-growth-v1`. Every input object carries `{synthetic: true, scenario: "illustrative-high-growth-v1", label: "Illustrative high-growth scenario — synthetic evidence"}`. All figures are invented for illustration. The company's real assessment is separate and is computed only from its own evidence; nothing here is written to production.

- Unicorn Potential method `unicorn-potential.v1.0.0`, input rules `unicorn-potential-inputs.v4`; clock 2026-10-18T00:00:00.000Z.
- Investability method `investiq/v2+investability-inputs.v3`.
- Engine code, weights, thresholds and gates are unchanged (`packages/readiness`, built dist, public entrypoint).

## Result

- **Unicorn Potential:** 75/100 · STRONG_SIGNALS · confidence LOW · coverage 95.5% · stage band SERIES_A_GROWTH.
- **Investability (separate, investor-facing):** 58/100 · INVESTABLE · confidence LOW · provisional · 3/48 criteria, 0/8 areas. It reads the same inputs through its own rules; most of its criteria need deck sections, verification or documents this scenario does not supply.

## Stage

Established services business, not a pre-seed technology start-up: trading since 2018 and a UK company since 2020-12-24, with no venture round. The engine's stage bands are funding rounds, so the scenario uses the 'growth' band (SERIES_A_GROWTH), whose weights stress traction, unit economics and operating leverage (P4 16, P5 12, P11 9) over founder and market narrative. Scoring a mature operator as pre-seed would overweight its founder story. The business is capital-intensive at the Academy (an owned Lagos 737NG simulator, partly financed by an asset-backed facility) and asset-light at Jet (advisory and brokerage, no owned aircraft).

## Assumptions

Zino Aviation earns fees and commissions from two divisions. The Academy sells Lagos simulator sessions, ground school, pilot placement and cadet programme management, and earns a fee (not the full tuition) on partner flight-school programmes. Jet earns aircraft charter and acquisition brokerage commissions and advisory fees. The scenario reports in USD (naira receipts converted at each month's average rate) and measures to 30 September 2026.

| Assumption                            | Synthetic value                                                         |
| ------------------------------------- | ----------------------------------------------------------------------- |
| Revenue FY2025 (Jan to Dec 2025)      | USD 1.62 million                                                        |
| Revenue Q3 2025 / Q3 2026             | USD 430,000 / USD 610,000 (+42% year on year)                           |
| Q3 2026 mix                           | Academy USD 420,000; Jet USD 190,000 (fees and commissions only)        |
| Contribution margin Q3 2026           | 46% (USD 280,600 on USD 610,000)                                        |
| Repeat purchase revenue Q3 2026       | USD 268,000 (44% of revenue); 7 of 8 programme clients renewed for 2026 |
| Blended CAC / payback                 | USD 1,500 per account / 2.5 months                                      |
| Cash / net outflow / runway           | USD 650,000 / USD 25,000 per month incl. simulator capex / 26 months    |
| Bottom-up accessible market (Academy) | 9,000 pilots x USD 9,500 per year = about USD 85M per year              |

## Why the score stops at 75

- Every synthetic source is USER_CLAIM with evidence status SELF_REPORTED, the most conservative status the rubric still grades (reliability 0.5).
- The engine caps any source at reliability 0.5 or below at grade 3, and grade 4 additionally needs reliability 0.85 or more (MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED) plus sustained, dated execution. Structured metric rules never exceed 3.
- This scenario never claims verification or independent corroboration, so every graded criterion is at most 3 and the overall score is at most 25 × 3 = 75. A score of 90 or more is not legitimately reachable on synthetic evidence; reaching it would need corroborated or verified real evidence across most pillars.
- DOCUMENT_SUPPORTED (0.7) would not change the score, only confidence; it was not used because no supporting document exists for a synthetic figure.
- Confidence follows source reliability, not the score: with every source at 0.5 the confidence index equals 0.5 × coverage, so it reads MODERATE only when all 24 criteria are graded and LOW otherwise.

## Mapping to the 24 criteria

| Criterion                                         | Synthetic evidence (self-reported)                                                                                                                                                                                                                                                                                              | State    | Grade |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| P1.A Relevant founder expertise                   | Founder and CEO has 8 years of experience as a licensed commercial and offshore helicopter pilot and domain expertise in West African pilot careers; he has led the business since 2018.                                                                                                                                        | OBSERVED | 3     |
| P1.B Adaptability and founder execution           | The founder changed the Academy offer in response to customer feedback in 2025, adding employment bootcamps, and delivered the Ghana cadet intake milestone in May 2026.                                                                                                                                                        | OBSERVED | 3     |
| P2.A Accessible market demand                     | Bottom-up accessible market sized from customer spending of USD 9,500 per pilot per year on type-rating preparation, recurrent simulator time and placement (Q3 2026 average of paying pilots) across about 9,000 licensed and cadet pilots in Nigeria and West Africa, or about USD 85 million per year for the Academy alone. | OBSERVED | 3     |
| P2.B Credible expansion path                      | Expansion into Ghana: 4 Accra charter operators and 120 Ghanaian cadets became paying customers between April 2026 and September 2026 under a signed distribution agreement with an Accra school partner.                                                                                                                       | OBSERVED | 3     |
| P3.A Problem severity and willingness to pay      | Paying customers cite one problem: licensed West African pilots lack type-rating preparation and recurrent simulator time near home; 1,140 paying customers bought Lagos simulator, ground school or placement services in Q3 2026.                                                                                             | OBSERVED | 3     |
| P3.B Repeated adoption or stage-appropriate tests | Retained customers: 7 of the 8 airline and government programme clients from 2025 renewed for 2026, and repeat purchases were 44% of Q3 2026 revenue.                                                                                                                                                                           | OBSERVED | 3     |
| P4.A Dated growth velocity                        | Revenue grew 42% year on year in 2026: USD 430,000 in Q3 2025 (July 2025 to September 2025) to USD 610,000 in Q3 2026 (July 2026 to September 2026).                                                                                                                                                                            | OBSERVED | 3     |
| P4.B Retention-supported traction                 | Repeat purchase revenue of USD 268,000 in Q3 2026 (July 2026 to September 2026) came from returning airline, operator and simulator customers, 44% of revenue.                                                                                                                                                                  | OBSERVED | 3     |
| P5.A Contribution economics and pricing           | Positive contribution margin of 46% measured on Q3 2026 actual revenue of USD 610,000 after instructor, simulator operating, partner and broker costs of USD 329,400.                                                                                                                                                           | OBSERVED | 3     |
| P5.B Sustainable acquisition and monetization     | Acquisition payback measured at 2.5 months for corporate and cadet accounts won in Q2 2026 and Q3 2026: blended CAC of USD 1,500 against USD 600 monthly contribution per account.                                                                                                                                              | OBSERVED | 3     |
| P6.A Differentiated assets                        | Proprietary dataset deployed in placement: assessment records of 3,800 West African pilots and cadets, used by customers (partner airlines and operators) to shortlist candidates since 2024.                                                                                                                                   | OBSERVED | 3     |
| P6.B Independent defensibility test               | (none: left ungraded)                                                                                                                                                                                                                                                                                                           | UNKNOWN  | —     |
| P7.A Repeatable acquisition channels              | Partner sales channel through flight schools and airlines is repeatable: it produced 38% of revenue in Q3 2026 and 36% in Q3 2025.                                                                                                                                                                                              | OBSERVED | 3     |
| P7.B Organic pull or channel efficiency           | Referrals measured: returning customers and alumni referred 31% of new paying customers between April 2026 and September 2026.                                                                                                                                                                                                  | OBSERVED | 3     |
| P8.A Runway and capital access                    | Current runway is 26 months at September 2026 net cash outflow of USD 25,000 per month including simulator capital expenditure, from cash of USD 650,000 held on 30 September 2026.                                                                                                                                             | OBSERVED | 3     |
| P8.B Relevant investor or strategic support       | Strategic support executed in June 2026: a USD 1.2 million asset-backed facility from a Lagos bank for simulator equipment, with an active agreement for a regional airline to send its first officers for recurrent simulator checks.                                                                                          | OBSERVED | 3     |
| P9.A Critical function coverage                   | Technical, commercial and operational functions are covered: a head of instruction with 6 type-rated instructors and 2 simulator engineers, a commercial director for Academy and Jet, and an operations manager who runs scheduling, visas and welfare.                                                                        | OBSERVED | 3     |
| P9.B Time-bound delivery                          | Operating milestones for 2026 were delivered on time: simulator recertification in March 2026, the Ghana cadet intake in May 2026 and the Jet advisory desk in September 2026.                                                                                                                                                  | OBSERVED | 3     |
| P10.A Structural demand or technology shift       | Structural demand documented: West African airlines added aircraft and routes in 2024 and 2025, and every airline pilot needs a type rating and recurrent simulator checks under civil aviation rules.                                                                                                                          | OBSERVED | 3     |
| P10.B Ability to exploit the window               | The market window is being used: Zino Aviation is deployed with 1,140 paying customers and 9 airline and operator clients in Nigeria and Ghana as of September 2026.                                                                                                                                                            | OBSERVED | 3     |
| P11.A Growth decoupled from costs                 | Revenue growth exceeds cost growth in actual 2026 results: Q3 2026 revenue rose 42% over Q3 2025 while total operating costs rose 24%.                                                                                                                                                                                          | OBSERVED | 3     |
| P11.B Repeatable deployment                       | Repeat deployments completed in 2026: the cadet logistics programme ran for two airlines and one state government in Nigeria and went live in Ghana in May 2026.                                                                                                                                                                | OBSERVED | 3     |
| P12.A Ecosystem access and partnerships           | Ecosystem partnership active since 2024 with two approved partner flight schools in South Africa and Greece, which delivered 64 cadet places in 2026.                                                                                                                                                                           | OBSERVED | 3     |
| P12.B Strategic adjacent opportunities            | Strategic opportunity in cadet financing has an executed agreement: a Lagos bank and Zino Aviation launched a cadet loan product in August 2026 with 40 approved cadets.                                                                                                                                                        | OBSERVED | 3     |

Additional dated metric claims (structured, same status): `financial.revenue` (Revenue USD 610,000 for Q3 2026 (July 2026 to September 2026).); `financial.contribution_margin` (Contribution margin 46% on Q3 2026 revenue.); `financial.runway_months` (Cash runway 26 months at 30 September 2026.); `traction.growth` (Revenue up 42% from Q3 2025 to Q3 2026.).

## Criteria left ungraded

- **P6.B**: Independent defensibility test: the rubric's demonstrated anchor requires an independent (third-party) benchmark. Asserting one would be a claim of independent corroboration, which this scenario never makes, so the criterion is left UNKNOWN. An internal comparison of placement rates would grade only 2 (limited).

## What real evidence would be needed

Each criterion needs the rubric's evidence (below) as real, current, investor-visible records, at least DOCUMENT_SUPPORTED, and corroborated or verified for a grade of 4:

- P1.A Relevant founder expertise: Confirmed founder role history tied to the customer problem.
- P1.B Adaptability and founder execution: Dated founder milestones or documented response to customer tests.
- P2.A Accessible market demand: Sourced bottom-up market sizing with explicit assumptions.
- P2.B Credible expansion path: Dated customer or channel evidence for an adjacent market.
- P3.A Problem severity and willingness to pay: Customer interviews, purchasing commitments or paid problem validation.
- P3.B Repeated adoption or stage-appropriate tests: Dated renewal, retention cohorts or repeated pilot outcomes.
- P4.A Dated growth velocity: Dated comparable revenue, usage or customer growth periods.
- P4.B Retention-supported traction: Dated recurring revenue or retained customer cohort evidence.
- P5.A Contribution economics and pricing: Sector-specific unit contribution evidence, forecasts explicitly labelled.
- P5.B Sustainable acquisition and monetization: Dated measured acquisition payback and monetization cohorts.
- P6.A Differentiated assets: Specific owned technology, licensed IP, proprietary data or network evidence.
- P6.B Independent defensibility test: Dated third-party benchmark or documented competitive evaluation.
- P7.A Repeatable acquisition channels: Dated channel cohorts, repeatable sales or executed distribution.
- P7.B Organic pull or channel efficiency: Dated referral cohorts or measured efficient sales conversion.
- P8.A Runway and capital access: Dated current cash runway or completed financing, excluding planned raises.
- P8.B Relevant investor or strategic support: Executed support tied to a specific operating need.
- P9.A Critical function coverage: Named technical, commercial and operational coverage appropriate to stage.
- P9.B Time-bound delivery: Dated milestone plan and actual delivery history.
- P10.A Structural demand or technology shift: Dated sourced demand, regulatory or technology shift.
- P10.B Ability to exploit the window: Dated operating capability and practical deployment readiness.
- P11.A Growth decoupled from costs: Comparable actual revenue and cost periods showing operating leverage.
- P11.B Repeatable deployment: Dated repeated customer or geographical deployments.
- P12.A Ecosystem access and partnerships: Dated active agreements and evidence of delivered partner access.
- P12.B Strategic adjacent opportunities: Documented adjacent demand or executed strategic option.

Company-specific gaps from the public research:

- Filed accounts: the UK company's FY2025 accounts were overdue on 2026-10-18; management accounts for 2025 and 2026.
- The legal entity that contracts with Nigerian customers (no CAC registration found) and any NCAA approvals for the simulator.
- Zino's own take (fee or commission) separated from pass-through partner tuition.
- Named airline, operator and government agreements behind placement and programme claims.

## Reproduce

```bash
pnpm exec turbo run build --filter=@capital-q/readiness
node scripts/seed/flagship/scenario/run.mjs zino-aviation          # inputs.json, result.json, README.md
node scripts/seed/flagship/scenario/run.mjs zino-aviation --pdf    # also the PDF (Chromium)
pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs
```
