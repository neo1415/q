# SongScribe AI: illustrative high-growth scenario

> **Illustrative high-growth scenario — synthetic evidence. Not the company's actual performance.**

Scenario `illustrative-high-growth-v1`. Every input object carries `{synthetic: true, scenario: "illustrative-high-growth-v1", label: "Illustrative high-growth scenario — synthetic evidence"}`. All figures are invented for illustration. The company's real assessment is separate and is computed only from its own evidence; nothing here is written to production.

- Unicorn Potential method `unicorn-potential.v1.0.0`, input rules `unicorn-potential-inputs.v4`; clock 2026-10-18T00:00:00.000Z.
- Investability method `investiq/v2+investability-inputs.v3`.
- Engine code, weights, thresholds and gates are unchanged (`packages/readiness`, built dist, public entrypoint).

## Result

- **Unicorn Potential:** 75/100 · STRONG_SIGNALS · confidence LOW · coverage 96% · stage band PRE_SEED.
- **Investability (separate, investor-facing):** 58/100 · INVESTABLE · confidence LOW · provisional · 3/46 criteria, 0/8 areas. It reads the same inputs through its own rules; most of its criteria need deck sections, verification or documents this scenario does not supply.

## Stage

Pre-seed. The UK entity was incorporated on 2026-02-13 and no funding is public (UNKNOWN, not zero); the scenario assumes a small pre-seed SAFE and keeps the company at pre-seed.

## Assumptions

SongScribe generates custom songs, jingles and background music from a prompt. The scenario assumes monthly credit subscriptions for consumers and creators plus commercial and exclusive licences for brands, churches and agencies, sold in Nigeria, Ghana, Kenya and the UK diaspora, with all figures in USD and measured to 30 September 2026.

| Assumption                    | Synthetic value                                                       |
| ----------------------------- | --------------------------------------------------------------------- |
| Paying subscribers (Sep 2026) | 2,900 (2,260 Nigeria and UK, 640 Ghana and Kenya)                     |
| MRR (Sep 2026)                | USD 46,400 (blended USD 16 per subscriber)                            |
| ARR run-rate (Sep 2026)       | USD 556,800                                                           |
| Revenue Q2 2026 / Q3 2026     | USD 96,000 / USD 128,600 (+34% QoQ)                                   |
| Contribution margin Q3 2026   | 58% (USD 74,600 on USD 128,600)                                       |
| Blended paid CAC / payback    | USD 38 per subscriber / 4.1 months                                    |
| Cohort retention              | 71% of the January 2026 paying cohort still paying in September 2026  |
| Cash / net burn / runway      | USD 240,000 / USD 15,000 per month / 16 months                        |
| Bottom-up accessible market   | 1.2 million music buyers x USD 192 per year = about USD 230M per year |

## Why the score stops at 75

- Every synthetic source is USER_CLAIM with evidence status SELF_REPORTED, the most conservative status the rubric still grades (reliability 0.5).
- The engine caps any source at reliability 0.5 or below at grade 3, and grade 4 additionally needs reliability 0.85 or more (MULTI_SOURCE_SUPPORTED, EXTERNALLY_VERIFIED or PLATFORM_VERIFIED) plus sustained, dated execution. Structured metric rules never exceed 3.
- This scenario never claims verification or independent corroboration, so every graded criterion is at most 3 and the overall score is at most 25 × 3 = 75. A score of 90 or more is not legitimately reachable on synthetic evidence; reaching it would need corroborated or verified real evidence across most pillars.
- DOCUMENT_SUPPORTED (0.7) would not change the score, only confidence; it was not used because no supporting document exists for a synthetic figure.
- Confidence follows source reliability, not the score: with every source at 0.5 the confidence index equals 0.5 × coverage, so it reads MODERATE only when all 24 criteria are graded and LOW otherwise.

## Mapping to the 24 criteria

| Criterion                                         | Synthetic evidence (self-reported)                                                                                                                                                                                                                                                          | State    | Grade |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----- |
| P1.A Relevant founder expertise                   | Founder and CEO previously built and led two Lagos businesses with founder-led consumer marketing; the technical lead has 7 years of experience in audio signal processing and audio ML.                                                                                                    | OBSERVED | 3     |
| P1.B Adaptability and founder execution           | The founders shipped Nigerian-language vocal generation in March 2026 and changed the pricing tiers in response to customer feedback from 400 subscribers in May 2026.                                                                                                                      | OBSERVED | 3     |
| P2.A Accessible market demand                     | Bottom-up accessible market sized from customer spending of USD 192 per paying subscriber per year (Q3 2026 average) across about 1.2 million creators, churches and small businesses in Nigeria, Ghana, Kenya and the UK diaspora that buy music today, or about USD 230 million per year. | OBSERVED | 3     |
| P2.B Credible expansion path                      | Expansion into Ghana and Kenya launched successfully in July 2026 with mobile-money checkout: 640 of the 2,900 paying subscribers at September 2026 are in those two countries.                                                                                                             | OBSERVED | 3     |
| P3.A Problem severity and willingness to pay      | Paying customers buy SongScribe for one problem: a custom song or jingle from a studio costs USD 150 to USD 600 and takes about two weeks; 2,900 subscribers paid in September 2026.                                                                                                        | OBSERVED | 3     |
| P3.B Repeated adoption or stage-appropriate tests | Retained customers: 71% of the January 2026 paying cohort was still subscribed in September 2026, and 38% of brand and church accounts made repeat purchases of new tracks.                                                                                                                 | OBSERVED | 3     |
| P4.A Dated growth velocity                        | Subscription revenue grew 34% quarter on quarter in 2026: USD 96,000 in Q2 (April 2026 to June 2026) to USD 128,600 in Q3 (July 2026 to September 2026).                                                                                                                                    | OBSERVED | 3     |
| P4.B Retention-supported traction                 | Recurring revenue from 2,900 subscribers reached USD 46,400 MRR in September 2026 (USD 556,800 annualised).                                                                                                                                                                                 | OBSERVED | 3     |
| P5.A Contribution economics and pricing           | Positive contribution margin of 58% measured on Q3 2026 actual revenue of USD 128,600 after GPU generation, payment processing and rights-clearance costs of USD 54,000.                                                                                                                    | OBSERVED | 3     |
| P5.B Sustainable acquisition and monetization     | Acquisition payback measured at 4.1 months for subscribers acquired in Q3 2026: blended paid CAC of USD 38 against USD 9.28 monthly contribution per subscriber.                                                                                                                            | OBSERVED | 3     |
| P6.A Differentiated assets                        | Proprietary dataset deployed in the production model: 120,000 commissioned Afrobeats, highlife, gospel and Nigerian-language vocal stems, owned outright and used by customers since March 2026.                                                                                            | OBSERVED | 3     |
| P6.B Independent defensibility test               | (none: left ungraded)                                                                                                                                                                                                                                                                       | UNKNOWN  | —     |
| P7.A Repeatable acquisition channels              | Short-video acquisition channel is repeatable: creator clips sourced 61% of new subscribers in every month from April 2026 to September 2026.                                                                                                                                               | OBSERVED | 3     |
| P7.B Organic pull or channel efficiency           | Referrals measured: every shared song carries a SongScribe link, and referrals sourced 27% of new paying subscribers between April 2026 and September 2026.                                                                                                                                 | OBSERVED | 3     |
| P8.A Runway and capital access                    | Current runway is 16 months at September 2026 net burn of USD 15,000 per month, from cash of USD 240,000 held on 30 September 2026.                                                                                                                                                         | OBSERVED | 3     |
| P8.B Relevant investor or strategic support       | Strategic support executed in March 2026: a USD 350,000 pre-seed SAFE from two music-industry angels, with an active agreement giving SongScribe access to a Lagos studio's session vocalists.                                                                                              | OBSERVED | 3     |
| P9.A Critical function coverage                   | Technical, commercial and operational functions are covered: a 3-person audio ML and engineering team, a growth and partnerships lead, and an operations lead appointed in May 2026 who runs rights clearance and support.                                                                  | OBSERVED | 3     |
| P9.B Time-bound delivery                          | Product milestones for 2026 were delivered on time: Nigerian-language vocals in March 2026, Ghana and Kenya checkout in July 2026 and the agency licence tier in September 2026.                                                                                                            | OBSERVED | 3     |
| P10.A Structural demand or technology shift       | Technology shift measured: generative music models reached commercial vocal quality in 2024 and 2025, and IFPI reported Sub-Saharan Africa as the second-fastest-growing recorded music region in 2024 (+22.6%).                                                                            | OBSERVED | 3     |
| P10.B Ability to exploit the window               | The market window is being used: SongScribe is deployed with 2,900 paying subscribers in Nigeria, Ghana, Kenya and the UK as of September 2026.                                                                                                                                             | OBSERVED | 3     |
| P11.A Growth decoupled from costs                 | Revenue growth exceeds cost growth in actual 2026 results: Q3 2026 revenue rose 34% over Q2 2026 while total operating costs rose 15%.                                                                                                                                                      | OBSERVED | 3     |
| P11.B Repeatable deployment                       | Repeat deployments completed in 2026: localised checkout, pricing and language packs went live in Ghana in July 2026 and Kenya in August 2026 using the Nigeria playbook.                                                                                                                   | OBSERVED | 3     |
| P12.A Ecosystem access and partnerships           | Platform partnership active since June 2026 with a church-media network, delivering in-app ordering to 1,400 member churches.                                                                                                                                                               | OBSERVED | 3     |
| P12.B Strategic adjacent opportunities            | Strategic opportunity in sonic branding has a signed customer: a Lagos consumer-goods brand licensed an exclusive campaign anthem and jingle set in August 2026.                                                                                                                            | OBSERVED | 3     |

Additional dated metric claims (structured, same status): `financial.arr` (ARR run-rate USD 556,800 at September 2026 (MRR USD 46,400 x 12).); `financial.contribution_margin` (Contribution margin 58% on Q3 2026 revenue.); `financial.runway_months` (Cash runway 16 months at 30 September 2026.); `traction.growth` (Revenue up 34% from Q2 2026 to Q3 2026.).

## Criteria left ungraded

- **P6.B**: Independent defensibility test: the rubric's demonstrated anchor requires an independent (third-party) benchmark. Asserting one would be a claim of independent corroboration, which this scenario never makes, so the criterion is left UNKNOWN. An internal listening test against Suno or Udio would grade only 2 (limited).

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

- Reconcile the contracting entity: the Terms name 'SongScribe Ltd' (Nigerian law) while the UK register shows SONGSCRIBE AI LTD (17031583).
- Rights evidence for training data and vocal stems (licences, commissioning contracts, takedown process).
- One consistent public price list (four tier schemes and $179 vs $199 conflict on the live site).
- Billing exports for subscribers, MRR, cohort retention and refunds; bank statements for cash.

## Reproduce

```bash
pnpm exec turbo run build --filter=@capital-q/readiness
node scripts/seed/flagship/scenario/run.mjs songscribe          # inputs.json, result.json, README.md
node scripts/seed/flagship/scenario/run.mjs songscribe --pdf    # also the PDF (Chromium)
pnpm exec vitest run --config scripts/seed/flagship/scenario/vitest.config.mjs
```
