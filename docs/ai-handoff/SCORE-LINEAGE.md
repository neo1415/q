# Score lineage and InvestIQ methodology audit

Snapshot: 2026-10-11, source baseline `e40b1d0`. **CODE OBSERVED** only.
This audit used repository code, tests and product-source extracts. The initial audit queried no hosted records. A subsequent authorized check of
the signed-in founder account’s latest 100 non-null result-block messages found
22 messages and six answer cards, none with numeric fit. This bounded sample
does not establish the lineage of the reported investor scores. The historical incident below
is recorded in repository fixtures; it is not fresh production verification.

## Current authorized evidence and card correction — 2026-10-11 17:20 UTC

The existing synthetic investor's 42 authorized current profiles contain no 8.8. An additional query scoped to that actor's own conversation history found 14 result-block messages and one numeric card score (10), also no 8.8. These bounded checks cannot establish historical score provenance.

A real projection defect affected 39 of the 42 cards: MISMATCH parameters contributed to canonical scores but were omitted from displayed measures and coverage. All 42 profiles had six applicable parameters; none hit the old eight-measure cap. The initial cap-only attribution was incorrect. Cards now preserve MISMATCH as a zero-point known level, with a distinct “Does not match” word and cross glyph. The corrected projection has zero coverage discrepancies and zero changed canonical scores across all 42 actual profiles.

A separate static defect capped measures at eight although the canonical/shared contract permits nine. The adapter now uses that existing shared constant. Ninth-known and ninth-unknown regressions cover it. No new ranking formula, FDN methodology or business service is introduced. Model prompt schemas/versions remain unchanged; the additive card level preserves existing canonical negative evidence.

## Repeated 6.0 and 3.5 on actual authorized profiles — 2026-10-11 18:40 UTC

The same actor's 42 captured canonical fit profiles were recomputed through the existing shared `fitScoreOutOf10` function. All are `ranking-config.v4`. The observed histogram is 10 × 2, 8.5 × 1, 6 × 14, 4.5 × 1, 3.5 × 21 and 1 × 3. None is 8.8. These are mandate-fit outputs, not InvestIQ Business Quality assessments.

Every profile has four known parameter outcomes. Its six applicable parameters include unknown cheque size and round terms; business model, traction and team are non-applicable for this mandate. Unknowns are omitted from the displayed mean rather than scored as mismatch.

| Repeated displayed fit | Actual companies | Known outcomes                        | Shared computation           |
| ---------------------- | ---------------- | ------------------------------------- | ---------------------------- |
| 6.0                    | 14               | Two STRONG, one PARTIAL, one MISMATCH | `(10 + 10 + 4 + 0) / 4 = 6`  |
| 3.5                    | 21               | One STRONG, one PARTIAL, two MISMATCH | `(10 + 4 + 0 + 0) / 4 = 3.5` |

The outcomes differ even within a tied score. Of the fourteen 6.0 profiles, thirteen have strong stage/sector and geography mismatch; one has strong stage/geography and sector mismatch. Of the twenty-one 3.5 profiles, eleven have strong stage with sector/geography mismatch; ten have strong sector with stage/geography mismatch. All have PARTIAL thesis similarity. The current comparator maps a present computed semantic similarity to PARTIAL between its configured thresholds; it reports UNKNOWN when no authorized semantic feature was retrieved (`fit/observe.ts`, `features/policy.ts`). The captured profile contains the outcome, not the underlying similarity; this audit does not establish whether that similarity deserves calibration.

This demonstrates coarse-level aggregation and ties in these real records, not a hard-coded fallback of 6 or 3.5. Four known outcomes provide limited numerical discrimination; the displayed mean also erases which dimension mismatched. Preserve the individual dimensions, unknown coverage and tie explanation. Do not add random precision or substitute a proposed InvestIQ formula. Historical 8.8 provenance remains unresolved; this sample cannot explain another actor's historical incident.

## Why 8.8 repeats

The recorded 2026-10-08 incident returned three companies, then expanded to ten
on a request to rank those companies, with repeated 8.8 scores and misleading
ranking language. See [fit-integrity.test.ts](../../../packages/model-gateway/test/fit-integrity.test.ts)
lines 16–21 and [voice-c10b845f.ts](../../../packages/q-core/test/fixtures/voice-c10b845f.ts)
lines 6–16. These are historical fixtures, not current hosted observations.

Two existing scoring mechanisms can produce 8.8:

| Mechanism                           | Computation                                                                                                                           | Source                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Model-derived quick answer-card fit | STRONG 10, GOOD 7.5, PARTIAL 4; omit UNKNOWN; require three known; arithmetic mean rounded to one decimal                             | `packages/model-gateway/src/q/answer-cards.ts:20`, `:52` |
| Canonical mandate-fit display       | STRONG 10, PARTIAL 4, MISMATCH 0; omit UNKNOWN; require three known; no score for declared exclusion or insufficient-information band | `packages/contracts/src/http/fit.ts:315`, `:329`         |

Four STRONG, one PARTIAL and two UNKNOWN produce `(4 × 10 + 4) / 5 = 8.8`,
with five of seven measures known. The regression asserts this shape at
`packages/model-gateway/test/fit-integrity.test.ts:228`. Coarse outcome levels
and omitted unknowns naturally produce ties. This does not establish that a
fixed 8.8 was hard-coded or that InvestIQ assessed business quality.

Quick-card levels are model-derived from the supplied evidence and declared
mandate/goal (`packages/q-core/src/prompts/schemas/company-analyst.ts:454`).
`analystResultBlocks` calls the quick-card composer at
`packages/model-gateway/src/q/result-blocks.ts:345`. RANKED quick cards sort by
display score, retaining original model order on ties; RESEARCH cards have no
fit (`answer-cards.ts:83`). Citation count is the number of distinct supplied
citation strings (`:121`), not independent proof that each level is supported.

Canonical fit cards instead copy the shared canonical fit display result
(`packages/model-gateway/src/q/fit-cards.ts:225`, `:242`, `:264`). Do not infer
which producer generated a hosted score merely from its number: inspect the
actual answer path, authorized input profile and stored result blocks.

## Canonical fit, internal merit and Discover order

`ranking-config.v4` is an **initial heuristic, uncalibrated mandate-fit config**,
not the FDN InvestIQ methodology (`packages/discovery/src/fit/config.ts:149`).
Its nine parameter weights are stage .18, sector .18, geography .14, cheque .12,
business model .06, traction .10, team .08, thesis .08 and round terms .06.
Its internal outcome values are STRONG 1, PARTIAL .5 and MISMATCH 0.

The implemented internal formulas are:

- Merit: sum of known applicable weight × outcome value / known weight.
- Coverage: known applicable weight / applicable weight.
- Confidence: evidence/freshness-discounted known weight / applicable weight.

See `packages/discovery/src/fit/model.ts:81`, `:121`, `:167` and
`packages/discovery/src/fit/config.ts:140`, `:166`. Unknown never counts as
zero. Evidence/freshness affects confidence; declared exclusions override
the band. These formulas describe existing fit code, not approved InvestIQ.

The displayed /10 is an unweighted mean with PARTIAL 4; band and internal merit
use weighted PARTIAL .5. Therefore the display is not internal merit × 10.
Explain these layers accurately rather than presenting them as one formula.

The base Discover ranker computes the weighted mean of present normalized
stage, geography, taxonomy and semantic features, omitting missing and
non-applicable factors (`packages/discovery/src/ranking/ranker.ts:29`, `:110`;
published configs in `packages/discovery/src/ranking/config.ts:160`, `:298`,
`:331`). Its internal score is neither a public quality score nor a probability.

Current `fit-order.v1` starts from v3 base rank, assesses canonical fit, refills
scored positions by displayed /10 descending, then internal merit/confidence,
then base rank. Unscored candidates retain their base positions. Bounded
exploration/diversity can then rerank with reasons. See
`packages/discovery/src/fit/order.ts:16`, `:90`, `:101`; composition wires the
policy at `packages/discovery/src/infrastructure/recommendation-pipeline.ts:418`,
`:471`. Historical slate versions remain historical; do not rewrite them.

## UI, speech and existing safeguards

- Q cards label the number mandate fit, expose measure/source counts and say
  ties explicitly: `apps/web/src/features/q/answer-canvas.tsx:228`, `:283`,
  `:298`, `:565`; helpers in `answer-canvas-logic.ts:47`, `:52`, `:67`.
- Discover/company breakdown uses the shared canonical display and exposes
  band, confidence and unknowns: `apps/web/src/features/fit/fit-breakdown.tsx:29`,
  `:35`, `:148`.
- Persistence applies count/reference/deduplication and tie safeguards:
  `packages/model-gateway/src/q/index.ts:3599`; provenance explicitly says
  “not a quality score” in `packages/model-gateway/src/q/fit-integrity.ts:64`,
  with tie text at `:82`.
- Spoken-fact/tie safeguards live in `packages/q-core/src/speech/spoken-facts.ts`
  and `packages/q-core/src/prompts/tasks/spoken-reply.v1.ts:24`.

## Founder readiness and missing governed InvestIQ

Existing readiness is a useful founder-private, deterministic rules diagnosis
with STRONG/DEVELOPING/GAP/UNKNOWN words and no numerical score
(`packages/contracts/src/q/readiness.ts:14`). All missing means UNKNOWN;
missing/unsupported blockers mean GAP; no open expected checks/contradictions
and sufficient evidenced checks mean STRONG; otherwise DEVELOPING
(`packages/readiness/src/domain/assess.ts:100`). Rules/basis history and
append-only revisions exist (`packages/readiness/src/application/service.ts:31`,
`:103`; `supabase/migrations/20261216090000_company_readiness.sql:19`, `:35`,
`:76`). It must remain private and outside investor ranking.

This diagnosis uses eight legacy pillars: Founder, Market Opportunity,
Product/Solution, Commercial Validation, Business Economics, Execution Capacity,
Governance/Trust and Investment Readiness (`packages/readiness/src/rules/v1.ts:109`;
`packages/contracts/src/q/readiness-blueprint.ts:51`). It is not a completed
implementation of the locked InvestIQ Core Seven.

The authoritative Chapter 4 sources require:

| Requirement                                                                                                                                                                  | Product-source text extract and line                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core Seven: Founder & Leadership; Market Opportunity; Product & Technology; Commercial Performance; Financial Health; Governance & Institutional Readiness; Capital Strategy | Locked PADL Chapter 4 #63: `Real_PADL_-_Capital_Q_Product_Architecture_Decision_Log.txt:2251`; Product Specification 4.3: `Real_CAPITAL_Q_PRODUCT_SPECIFICATION.txt:2804` |
| Contextual weighting by stage, sector, business model and evidence; proprietary numeric methodology with explainable influence                                               | PADL Chapter 4 #64: `:2290`; Specification 4.4: `:2848`                                                                                                                   |
| Separate headline, Business Quality, Investment Readiness, confidence and dimension assessments; preserve history                                                            | Specification 4.1/4.2: `:2744`, `:2771`                                                                                                                                   |
| Operations excluded from core assessment                                                                                                                                     | PADL Chapter 4 #73: `:2739`                                                                                                                                               |
| Governed methodology versions, historical reproducibility, no silent methodology change                                                                                      | PADL Chapter 4 #76: `:2939`; Specification 4.13: `:3322`                                                                                                                  |

All source extracts above are under `docs/product-sources/text/`. Decision ids
#60–#69 collide with Chapter 3; always specify **Chapter 4** when citing #63/#64.

No governed production FDN InvestIQ evaluator, approved Core Seven numeric
rubric, contextual weight profiles or methodology release was located in this
audit. GateQ independently states that no governed InvestIQ projection exists
(`packages/gateq/src/contracts/index.ts:148`). The evidence-link weight column
is an extension point without production weighting methodology
(`supabase/migrations/20260905150000_evidence_foundation.sql:438`); this comment
is about evidence-link weights, not all scoring in the system.

Marketplace readiness is a separate activation policy, not business quality or
investment readiness (`packages/companies/src/domain/marketplace-readiness.ts:13`).

## Safe continuation and verification

Preserve existing fit formulas, tie honesty, readiness history and founder
journeys. Do not add score jitter, invent extra precision, rename the legacy
stored pillar keys or expose private diagnosis to investors. The stale source
comments about v3-only feed order and “PADL nine pillars” were corrected; no
algorithm, schema or historical record changed.

Before implementing institutional InvestIQ, locate or obtain the actual
approved FDN criteria, contextual weight profiles, evidence treatment,
thresholds, benchmark rules and methodology version. PADL and Specification
define requirements; they do not supply proprietary numeric parameters. No
new InvestIQ formula or approved numerical weights are proposed here. Reuse
canonical evidence, authorization, revision storage and specialist/model
gateway seams rather than creating another scoring truth.

Existing suites worth retaining and running for a scoring change:
`packages/model-gateway/test/q-answer-cards.test.ts`, `fit-integrity.test.ts`;
`packages/discovery/test/fit.test.ts`, `fit-order.test.ts`, `ranking.test.ts`;
`packages/readiness/test/assess.test.ts`, `firewall.test.ts`. **LOCAL TESTED in the integration checkout:** all six fit/ranking/readiness suites listed above passed (101 tests); the presentation slice also passed the answer-card suite. This verifies code behavior, not hosted score provenance. Hosted score lineage and live UI/speech
remain unverified; use authorized runtime records and actual result blocks in
a subsequent verification pass.

## Authorized hosted record check — 2026-10-11

Existing synthetic investor actor, actual persisted feed records, canonical
fit HTTP routes under that actor (no fixture injection or record edits): all
42 visible companies returned ranking-config.v4 profiles. Recomputed display
histogram: 10.0 × 2, 8.5 × 1, 6.0 × 14, 4.5 × 1, 3.5 × 21, 1.0 × 3. No 8.8
occurred. Q's top-three request produced one 10.0 card, exposing a separate
candidate-window/result-size issue. This sample demonstrates repeated values
on real authorized records, but **does not reproduce the historical 8.8**.
The historical fixture and formula analysis above remain distinct. Do not
change customer data, add jitter or manufacture evidence to produce 8.8.
