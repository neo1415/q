# tavus-20 full seed dataset

`companies-full.json` is an array of 20 objects, one per company in `plan.json`, keyed by `n`. Every company, person, investor, customer and document is fictional. Facts in `plan.json` and in each video script are fixed, and nothing in this file contradicts them.

## Top-level fields

| Field                                                    | Meaning                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `n`, `company`, `planFacts`                              | Join key, display name and a copy of the plan facts this record must agree with                                                                                                                                                                                                                                                     |
| `legalName`, `websiteUrl`, `foundedDate`, `headquarters` | Legal entity, a fictional `.example` domain, founding date, and HQ `{city, region?, country}` with ISO-2 country                                                                                                                                                                                                                    |
| `currentStageCode`                                       | `pre_seed`, `seed` or `series_a` (same as the plan)                                                                                                                                                                                                                                                                                 |
| `headcount`                                              | Total full-time staff. It matches `gateqAnswers.teamSize` and the deck's team section                                                                                                                                                                                                                                               |
| `shortDescription` / `primaryDescription`                | Up to 160 characters, and 3 to 5 sentences                                                                                                                                                                                                                                                                                          |
| `tags`                                                   | Codes from taxonomy v1 (`20260904180000_taxonomy_foundation.sql`), grouped as `industry`, `business_model`, `customer_type`, `geography` and `other`. **`vietnam` (n14) and `mexico` (n15) are not in taxonomy v1**: add them as nodes or fall back to `asia` / `latin_america`                                                     |
| `keywords`                                               | 10 to 15 search terms                                                                                                                                                                                                                                                                                                               |
| `brand`                                                  | `primary`, `accent` and `ink` hex colours plus `logoConcept`. Every company has a different primary colour                                                                                                                                                                                                                          |
| `founderPerson`                                          | The plan founder (name, role, age and nationality unchanged) plus city, education, `previousRoles` with years, headline, summaries, languages and `appRole: OWNER`                                                                                                                                                                  |
| `team`                                                   | 2 to 3 more people with `appRole` set to `ADMIN` or `MEMBER`                                                                                                                                                                                                                                                                        |
| `capital`                                                | Target raise, instrument, `valuationCap` or `preMoneyValuation`, close date, minimum cheque, `useOfFunds` (4 lines summing to 100%, with amounts), `previousRounds`, `existingInvestors`, cash, net burn and runway. Some records also have `debtFacility` (n6), `assetFinance` (n9), `coFinancing` (n11) or `holdingCompany` (n14) |
| `metrics`                                                | `kpis` (code, label, unit, currency) and 8 monthly `points` (Oct 2025 to Sep 2026, month-end `asOf`). The last point equals the plan traction. `note` explains how each figure is derived                                                                                                                                           |
| `deck`                                                   | The 12 sections in a fixed order, each `{section, content[]}`                                                                                                                                                                                                                                                                       |
| `deckGaps`                                               | Sections left thin on purpose for Q's deck coaching. It is empty for 14 companies                                                                                                                                                                                                                                                   |
| `dataRoom`                                               | 10 or 11 documents, each `{title, folder, visibility, summary[]}`                                                                                                                                                                                                                                                                   |
| `qGuide`, `qPersonality`                                 | The founder's instructions to Q in their own voice, and one of `WARM`, `WITTY`, `DIRECT`, `FORMAL` or `AUTO`                                                                                                                                                                                                                        |
| `gateqAnswers`                                           | Sector, stage, geography, `chequeNeed`, traction and team size                                                                                                                                                                                                                                                                      |

## How the numbers reconcile

All of these figures are calculated by the generator rather than typed in by hand:

- ARR is a unit count multiplied by a price.
- Cumulative counters are built from the monthly flows.
- Use-of-funds amounts are the raise multiplied by each percentage.
- `runwayMonthsCurrent` is cash ÷ net burn.
- `runwayMonthsPostRaise` is (cash + raise) ÷ planned burn. The deck's financials section quotes these same values.

Cash, burn and the raise are all in the raise currency. Revenue is in local currency.

## Seeding rules

- Treat every metric as `USER_CLAIM` / `SELF_REPORTED`, never as verified.
- Data-room summaries describe documents. They are not the documents themselves.
- The data-room visibility values (`PUBLIC`, `ON_REQUEST`, `SHARED_ONLY`, `PRIVATE`) need mapping to the ADR-001 scopes when seeded.
