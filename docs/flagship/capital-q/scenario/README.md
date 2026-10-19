# Capital Q: illustrative high-growth scenario

> **Illustrative high-growth scenario — synthetic evidence. Not the company's actual performance.**

Scenario `illustrative-high-growth-v1`. Every input object carries `{synthetic: true, scenario: "illustrative-high-growth-v1", label: "Illustrative high-growth scenario — synthetic evidence"}`. All figures are invented for illustration. The company's real assessment is separate and is computed only from its own evidence; nothing here is written to production.

- Unicorn Potential method `unicorn-potential.v1.0.0`, input rules `unicorn-potential-inputs.v4`; clock 2026-10-18T00:00:00.000Z.
- Investability method `investiq/v2+investability-inputs.v3`.
- Engine code, weights, thresholds and gates are unchanged (`packages/readiness`, built dist, public entrypoint).

## Result

- **Unicorn Potential:** 75/100 · STRONG_SIGNALS · confidence LOW · coverage 96% · stage band PRE_SEED.
- **Investability (separate, investor-facing):** 58/100 · INVESTABLE · confidence LOW · provisional · 3/46 criteria, 0/8 areas. It reads the same inputs through its own rules; most of its criteria need deck sections, verification or documents this scenario does not supply.

## Stage

Pre-seed. No owning legal entity, round or revenue is public (UNKNOWN, not zero); the scenario assumes a small pre-seed round and keeps the company at pre-seed.

## Assumptions

Capital Q is an AI-native investment intelligence operating system for private capital. The scenario assumes quarterly subscriptions for investor organisations (venture funds, angel networks and family offices) in Africa and the GCC, sold founder-led and through FDN Capital Partners' advisory network, with all figures in USD and measured to 30 September 2026. It is not a marketplace and the scenario takes no fee on capital raised.

| Assumption                               | Synthetic value                                                       |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Paying investor organisations (Sep 2026) | 24 (19 Africa, 5 GCC) at USD 1,500 per month on average               |
| MRR (Sep 2026)                           | USD 36,000                                                            |
| ARR run-rate (Sep 2026)                  | USD 432,000                                                           |
| Revenue Q2 2026 / Q3 2026                | USD 72,000 / USD 99,000 (+37.5% QoQ)                                  |
| Contribution margin Q3 2026              | 76% (USD 75,240 on USD 99,000)                                        |
| Blended CAC / payback                    | USD 9,000 per organisation / 7.9 months                               |
| Net revenue retention (Sep 2026)         | 108% (9 of 10 launch-cohort renewals, 1.2x seats)                     |
| Cash / net burn / runway                 | USD 280,000 / USD 14,000 per month / 20 months                        |
| Bottom-up accessible market              | 2,400 active investors x USD 18,000 per year = about USD 43M per year |

## Why the score stops at 75

- Every synthetic source is USER_CLAIM with evidence status SELF_REPORTED, the most conservative status the rubric still grades (reliability 0.5).
- The engine caps any source at reliability 0.5 or below at grade 3, and grade 4 additionally needs reliability 0.85 or more (MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED) plus sustained, dated execution. Structured metric rules never exceed 3.
- This scenario never claims verification or independent corroboration, so every graded criterion is at most 3 and the overall score is at most 25 × 3 = 75. A score of 90 or more is not legitimately reachable on synthetic evidence; reaching it would need corroborated or verified real evidence across most pillars.
- DOCUMENT_SUPPORTED (0.7) would not change the score, only confidence; it was not used because no supporting document exists for a synthetic figure.
- Confidence follows source reliability, not the score: with every source at 0.5 the confidence index equals 0.5 × coverage, so it reads MODERATE only when all 24 criteria are graded and LOW otherwise.

## Mapping to the 24 criteria

| Criterion                                         | Synthetic evidence (self-reported)                                                                                                                                                                                                                                                   | State    | Grade |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ----- |
| P1.A Relevant founder expertise                   | Founder team previously built and led a private-capital advisory practice and an aviation services business; the cofounders have 15 years of combined experience in private capital, venture advisory and operating companies.                                                       | OBSERVED | 3     |
| P1.B Adaptability and founder execution           | The founders shipped the evidence-graded investor profile in April 2026 and changed the investor feed in response to customer feedback from 9 investor organisations.                                                                                                                | OBSERVED | 3     |
| P2.A Accessible market demand                     | Bottom-up accessible market sized from customer spending of USD 18,000 per investor organisation per year (Q3 2026 average of 24 paying organisations) across about 2,400 active venture, angel and family-office investors in Africa and the GCC, or about USD 43 million per year. | OBSERVED | 3     |
| P2.B Credible expansion path                      | Expansion into the GCC: 5 Doha and Dubai family offices became paying customers between July 2026 and September 2026 through introductions from FDN's Doha office.                                                                                                                   | OBSERVED | 3     |
| P3.A Problem severity and willingness to pay      | Paying customers cite one problem: analysts spend about 11 hours screening each inbound company before a first call; 24 paying investor organisations use evidence-graded profiles to cut that work.                                                                                 | OBSERVED | 3     |
| P3.B Repeated adoption or stage-appropriate tests | Retained customers: 9 of the 10 investor organisations in the January 2026 launch cohort renewed their quarterly terms through September 2026, at 1.2 times their original seat count.                                                                                               | OBSERVED | 3     |
| P4.A Dated growth velocity                        | Subscription revenue grew 37.5% quarter on quarter in 2026: USD 72,000 in Q2 (April 2026 to June 2026) to USD 99,000 in Q3 (July 2026 to September 2026).                                                                                                                            | OBSERVED | 3     |
| P4.B Retention-supported traction                 | Recurring revenue from 24 investor organisations reached USD 36,000 MRR in September 2026 (USD 432,000 annualised).                                                                                                                                                                  | OBSERVED | 3     |
| P5.A Contribution economics and pricing           | Positive contribution margin of 76% measured on Q3 2026 actual revenue of USD 99,000 after model inference, hosting, video delivery and onboarding costs of USD 23,760.                                                                                                              | OBSERVED | 3     |
| P5.B Sustainable acquisition and monetization     | Acquisition payback measured at 7.9 months for organisations won in Q2 2026 and Q3 2026: blended CAC of USD 9,000 against USD 1,140 monthly contribution per organisation.                                                                                                           | OBSERVED | 3     |
| P6.A Differentiated assets                        | Proprietary technology deployed in production: evidence-graded company records with separate truth, evidence and lifecycle axes and a deterministic, versioned assessment, used by customers since April 2026.                                                                       | OBSERVED | 3     |
| P6.B Independent defensibility test               | (none: left ungraded)                                                                                                                                                                                                                                                                | UNKNOWN  | —     |
| P7.A Repeatable acquisition channels              | Partner-led distribution channel through FDN Capital Partners' advisory network is repeatable: it sourced 15 of the 24 paying investor organisations across Q2 2026 and Q3 2026.                                                                                                     | OBSERVED | 3     |
| P7.B Organic pull or channel efficiency           | Sales conversion from guided demo to paid organisation measured at 31% for demos held between April 2026 and September 2026; referrals between investors sourced 6 new organisations in that period.                                                                                 | OBSERVED | 3     |
| P8.A Runway and capital access                    | Current runway is 20 months at September 2026 net burn of USD 14,000 per month, from cash of USD 280,000 held on 30 September 2026.                                                                                                                                                  | OBSERVED | 3     |
| P8.B Relevant investor or strategic support       | Strategic support executed in April 2026: a USD 400,000 pre-seed round led by two GCC family offices, with an active agreement for FDN Capital Partners to deliver advisory execution to Capital Q customers.                                                                        | OBSERVED | 3     |
| P9.A Critical function coverage                   | Technical, commercial and operational functions are covered: a 5-person engineering and data team, a commercial lead for investor organisations, and an operations lead appointed in May 2026 who runs onboarding and diligence support.                                             | OBSERVED | 3     |
| P9.B Time-bound delivery                          | Product milestones for 2026 were delivered on time: investor profiles in April 2026, mandate intake in July 2026 and the comparison workspace in September 2026.                                                                                                                     | OBSERVED | 3     |
| P10.A Structural demand or technology shift       | Structural demand documented: AVCA recorded US$3.9 billion of African venture funding across 506 deals in 2025, led by local funds that screen more companies per analyst.                                                                                                           | OBSERVED | 3     |
| P10.B Ability to exploit the window               | The market window is being used: Capital Q is deployed with 24 paying investor organisations in Nigeria, Kenya, Qatar and the UAE as of September 2026.                                                                                                                              | OBSERVED | 3     |
| P11.A Growth decoupled from costs                 | Revenue growth exceeds cost growth in actual 2026 results: Q3 2026 revenue rose 37.5% over Q2 2026 while total operating costs rose 10%.                                                                                                                                             | OBSERVED | 3     |
| P11.B Repeatable deployment                       | Repeat deployments completed in 2026: one onboarding process took 24 investor organisations live in Lagos, Nairobi, Doha and Dubai within 5 working days each.                                                                                                                       | OBSERVED | 3     |
| P12.A Ecosystem access and partnerships           | Ecosystem partnership executed in June 2026 with an African angel network federation, giving its member networks shared deal-flow access in Capital Q.                                                                                                                               | OBSERVED | 3     |
| P12.B Strategic adjacent opportunities            | Strategic opportunity in founder readiness services has a signed customer: a Lagos accelerator licensed readiness diagnostics for its 2026 cohort in August 2026.                                                                                                                    | OBSERVED | 3     |

Additional dated metric claims (structured, same status): `financial.arr` (ARR run-rate USD 432,000 at September 2026 (MRR USD 36,000 x 12).); `financial.nrr` (Net revenue retention 108% for the January 2026 launch cohort at September 2026.); `financial.contribution_margin` (Contribution margin 76% on Q3 2026 revenue.); `financial.runway_months` (Cash runway 20 months at 30 September 2026.); `traction.growth` (Revenue up 37.5% from Q2 2026 to Q3 2026.).

## Criteria left ungraded

- **P6.B**: Independent defensibility test: the rubric's demonstrated anchor requires an independent (third-party) benchmark. Asserting one would be a claim of independent corroboration, which this scenario never makes, so the criterion is left UNKNOWN. An internal screening-time comparison would grade only 2 (limited).

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

- The owning legal entity and its relationship to FDN Capital Partners (not established).
- Published pricing and signed customer contracts; seeded demo accounts and access grants are not customers.
- A regulatory analysis of investment-advice, broker and crowdfunding rules in Nigeria, Qatar, the EU and the US.
- Confirmation of the cofounder's name and roles before publication.

## Reproduce

```bash
pnpm exec turbo run build --filter=@capital-q/readiness
node scripts/seed/flagship/scenario/run.mjs capital-q          # inputs.json, result.json, README.md
node scripts/seed/flagship/scenario/run.mjs capital-q --pdf    # also the PDF (Chromium)
pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs
```
