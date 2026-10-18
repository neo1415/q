# KUUZA AI: illustrative high-growth scenario

> **Illustrative high-growth scenario — synthetic evidence. Not the company's actual performance.**

Scenario `illustrative-high-growth-v1`. Every input object carries `{synthetic: true, scenario: "illustrative-high-growth-v1", label: "Illustrative high-growth scenario — synthetic evidence"}`. All figures are invented for illustration. The company's real assessment is separate and is computed only from its own evidence; nothing here is written to production.

- Unicorn Potential method `unicorn-potential.v1.0.0`, input rules `unicorn-potential-inputs.v4`; clock 2026-10-18T00:00:00.000Z.
- Investability method `investiq/v2+investability-inputs.v3`.
- Engine code, weights, thresholds and gates are unchanged (`packages/readiness`, built dist, public entrypoint).

## Result

- **Unicorn Potential:** 75/100 · STRONG_SIGNALS · confidence LOW · coverage 96% · stage band PRE_SEED.
- **Investability (separate, investor-facing):** 58/100 · INVESTABLE · confidence LOW · provisional · 3/46 criteria, 0/8 areas. It reads the same inputs through its own rules; most of its criteria need deck sections, verification or documents this scenario does not supply.

## Stage

Pre-seed. No funding round is public (UNKNOWN, not zero); the scenario assumes a small angel round and keeps the company at pre-seed.

## Assumptions

KUUZA sells AI roleplay simulation and coaching to contact-centre and B2B sales teams. The scenario assumes enterprise subscriptions priced per seat, sold founder-led and through contact-centre associations in Nigeria and Kenya, with all figures in USD and measured to 30 September 2026.

| Assumption                       | Synthetic value                                                                         |
| -------------------------------- | --------------------------------------------------------------------------------------- |
| Paying accounts (Sep 2026)       | 14 (11 Nigeria, 3 Kenya)                                                                |
| MRR (Sep 2026)                   | USD 14,000 (USD 1,000 average per account: about 67 seats at USD 15 per seat per month) |
| ARR run-rate (Sep 2026)          | USD 168,000                                                                             |
| Revenue Q2 2026 / Q3 2026        | USD 28,500 / USD 40,200 (+41% QoQ)                                                      |
| Contribution margin Q3 2026      | 71% (USD 28,550 on USD 40,200)                                                          |
| Blended CAC / payback            | USD 5,000 per account / 7.0 months                                                      |
| Net revenue retention (Sep 2026) | 111% (6 of 7 renewals, 1.3x seats)                                                      |
| Cash / net burn / runway         | USD 180,000 / USD 9,500 per month / 19 months                                           |
| Bottom-up accessible market      | 410,000 seats x USD 180 = about USD 74M per year                                        |

## Why the score stops at 75

- Every synthetic source is USER_CLAIM with evidence status SELF_REPORTED, the most conservative status the rubric still grades (reliability 0.5).
- The engine caps any source at reliability 0.5 or below at grade 3, and grade 4 additionally needs reliability 0.85 or more (MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED) plus sustained, dated execution. Structured metric rules never exceed 3.
- This scenario never claims verification or independent corroboration, so every graded criterion is at most 3 and the overall score is at most 25 × 3 = 75. A score of 90 or more is not legitimately reachable on synthetic evidence; reaching it would need corroborated or verified real evidence across most pillars.
- DOCUMENT_SUPPORTED (0.7) would not change the score, only confidence; it was not used because no supporting document exists for a synthetic figure.
- Confidence follows source reliability, not the score: with every source at 0.5 the confidence index equals 0.5 × coverage, so it reads MODERATE only when all 24 criteria are graded and LOW otherwise.

## Mapping to the 24 criteria

| Criterion                                         | Synthetic evidence (self-reported)                                                                                                                                                                                                                      | State    | Grade |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| P1.A Relevant founder expertise                   | Founder and CEO previously built and led a Lagos aviation skills business that assesses crews on simulators; the technical cofounder has 8 years of experience building speech and conversational software.                                             | OBSERVED | 3     |
| P1.B Adaptability and founder execution           | The founders shipped the enterprise roleplay scorecard in July 2026 and changed the scoring rubric in response to customer feedback from 9 accounts.                                                                                                    | OBSERVED | 3     |
| P2.A Accessible market demand                     | Bottom-up accessible market sized from customer spending of USD 180 per frontline seat per year (median of 14 paying accounts, Q3 2026) across about 410,000 contact-centre and B2B sales seats in Nigeria and Kenya, or about USD 74 million per year. | OBSERVED | 3     |
| P2.B Credible expansion path                      | Expansion into Kenya: 3 Nairobi contact-centre operators became paying customers between July 2026 and September 2026 through a signed distribution agreement with a local BPO association.                                                             | OBSERVED | 3     |
| P3.A Problem severity and willingness to pay      | Signed purchase orders from 14 accounts cite the same problem: supervisors spend about 6 hours a week shadowing each new agent's live calls; orders average USD 1,000 per month.                                                                        | OBSERVED | 3     |
| P3.B Repeated adoption or stage-appropriate tests | Retained customers: 6 of the 7 accounts whose first annual term ended between April 2026 and September 2026 renewed, at an average of 1.3 times their original seat count.                                                                              | OBSERVED | 3     |
| P4.A Dated growth velocity                        | Recurring revenue grew 41% quarter on quarter in 2026: USD 28,500 in Q2 (April 2026 to June 2026) to USD 40,200 in Q3 (July 2026 to September 2026).                                                                                                    | OBSERVED | 3     |
| P4.B Retention-supported traction                 | Recurring revenue from 14 subscribed accounts reached USD 14,000 MRR in September 2026 (USD 168,000 annualised); 92% is billed on annual subscriptions.                                                                                                 | OBSERVED | 3     |
| P5.A Contribution economics and pricing           | Positive contribution margin of 71% measured on Q3 2026 actual revenue of USD 40,200 after speech-model inference, hosting and onboarding costs of USD 11,650.                                                                                          | OBSERVED | 3     |
| P5.B Sustainable acquisition and monetization     | Acquisition payback measured at 7.0 months for accounts won in Q2 2026 and Q3 2026: blended CAC of USD 5,000 per account against USD 710 monthly contribution per account.                                                                              | OBSERVED | 3     |
| P6.A Differentiated assets                        | Proprietary dataset deployed in production scoring: 38,000 scored West African sales and service roleplay calls in English, Pidgin and Swahili, used by customers since June 2026.                                                                      | OBSERVED | 3     |
| P6.B Independent defensibility test               | (none: left ungraded)                                                                                                                                                                                                                                   | UNKNOWN  | —     |
| P7.A Repeatable acquisition channels              | Partner-led distribution channel through two contact-centre BPO associations is repeatable: it sourced 9 of the 14 paying accounts across Q2 2026 and Q3 2026.                                                                                          | OBSERVED | 3     |
| P7.B Organic pull or channel efficiency           | Sales conversion from free demo to paid account measured at 18% for demos booked between April 2026 and September 2026; referrals from existing accounts sourced 4 new accounts in the same period.                                                     | OBSERVED | 3     |
| P8.A Runway and capital access                    | Current runway is 19 months at September 2026 net burn of USD 9,500 per month, from cash of USD 180,000 held on 30 September 2026.                                                                                                                      | OBSERVED | 3     |
| P8.B Relevant investor or strategic support       | Strategic support executed in May 2026: a USD 250,000 angel round from two West African contact-centre operators, with an active agreement giving KUUZA supervised access to their agent floors.                                                        | OBSERVED | 3     |
| P9.A Critical function coverage                   | Technical, commercial and operational functions are covered: the technical cofounder leads a 4-person engineering team, a commercial lead runs enterprise sales, and an operations lead appointed in June 2026 runs customer onboarding.                | OBSERVED | 3     |
| P9.B Time-bound delivery                          | Product milestones for 2026 were delivered on time: enterprise scorecard in July 2026, Kenya launch in August 2026 and multilingual voice in September 2026.                                                                                            | OBSERVED | 3     |
| P10.A Structural demand or technology shift       | Technology shift documented: real-time speech models with sub-second latency became commercially available in 2024 and 2025, letting roleplay simulation replace supervisor call shadowing at a fraction of its cost.                                   | OBSERVED | 3     |
| P10.B Ability to exploit the window               | The market window is being used: KUUZA is deployed with 14 paying accounts in Nigeria and Kenya as of September 2026.                                                                                                                                   | OBSERVED | 3     |
| P11.A Growth decoupled from costs                 | Revenue growth exceeds cost growth in actual 2026 results: Q3 2026 revenue rose 41% over Q2 2026 while total operating costs rose 12%.                                                                                                                  | OBSERVED | 3     |
| P11.B Repeatable deployment                       | Repeat deployments completed in 2026: one onboarding playbook took all 14 accounts across Lagos, Abuja and Nairobi live in under 10 working days each.                                                                                                  | OBSERVED | 3     |
| P12.A Ecosystem access and partnerships           | Ecosystem partnership executed in August 2026 with a Kenyan BPO association, giving its members discounted seats and co-delivered onboarding.                                                                                                           | OBSERVED | 3     |
| P12.B Strategic adjacent opportunities            | Strategic opportunity in hiring assessment has a signed customer: a Lagos bank licensed KUUZA roleplay scoring for graduate recruitment screening in September 2026.                                                                                    | OBSERVED | 3     |

Additional dated metric claims (structured, same status): `financial.arr` (ARR run-rate USD 168,000 at September 2026 (MRR USD 14,000 x 12).); `financial.nrr` (Net revenue retention 111% for the April 2026 to September 2026 renewal cohort.); `financial.contribution_margin` (Contribution margin 71% on Q3 2026 revenue.); `financial.runway_months` (Cash runway 19 months at 30 September 2026.); `traction.growth` (Revenue up 41% from Q2 2026 to Q3 2026.).

## Criteria left ungraded

- **P6.B**: Independent defensibility test: the rubric's demonstrated anchor requires an independent (third-party) benchmark. Asserting one would be a claim of independent corroboration, which this scenario never makes, so the criterion is left UNKNOWN. An internal head-to-head test would grade only 2 (limited).

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

- Legal entity and registration (no entity is named on kuuza.ai; Nigeria CAC status UNKNOWN).
- Published privacy policy and terms (the product records employee and consumer voice).
- Billing exports or bank statements behind MRR, revenue and cash; signed customer contracts and renewals.
- A third-party competitive benchmark against Second Nature, Hyperbound or Yoodli.

## Reproduce

```bash
pnpm exec turbo run build --filter=@capital-q/readiness
node scripts/seed/flagship/scenario/run.mjs kuuza          # inputs.json, result.json, README.md
node scripts/seed/flagship/scenario/run.mjs kuuza --pdf    # also the PDF (Chromium)
pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs
```
