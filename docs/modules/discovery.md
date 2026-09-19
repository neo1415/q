# Discovery (doc 19)

Who an investor or a founder could reasonably meet, chosen by declared
eligibility and declared fit, ranked deterministically, and explained from
the fields that produced it.

## The order

```
hard eligibility → candidate generation → declared hard exclusions
  → explicit fit → deterministic rank
```

Semantic fit, evidence weighting and exploration are later steps in that
same order and are deliberately absent rather than approximated. A pretend
relevance score is worse than an honest gap, and the order above is the
part that has to be right first.

No model runs in this path. The slate is reproducible from the rows alone:
the same inputs give the same order, and `DISCOVERY_RANKING_VERSION`
changes whenever a weight, a signal or the order does.

## Cross-tenant, because that is what the word means

This packet began as a bug. `network_visible` means visible to
authenticated Capital Q participants (ADR-001), but the only search that
existed scoped candidates to the caller's own tenant — and every
organisation has its own tenant. A founder could make their company
discoverable and no investor could ever see it, which is exactly what
happened in the browser.

The candidate queries in
`packages/discovery/src/infrastructure/postgres-discovery-repository.ts`
are cross-tenant and say so in SQL. The filter is the declared visibility
column; the caller's own organisation is the only exclusion, because their
own company is the subject of their own conversations rather than a
discovery result. Classification chooses candidates; the disclosure layer
still decides each one.

## What may be matched on, in each direction

**Investor → companies.** The investor's own mandate, against the
company's declared, network-visible profile. Their data, used for them:
declared stage range, and taxonomy preferences by strength (MUST 40,
STRONG 25, NICE 10) against the company's active classifications. A
mandate preference marked as an exclusion is a removal, never a low score,
and only declared rules can exclude.

**Founder → investors.** The declared investor profile and nothing else:
whether they say they are deploying, and whether the profile is filled in.
An investor's mandate is investor-private, and doc 19 §204.9 makes it
release-blocking that private investor behaviour must not shape what a
founder sees. The slate always carries
`RANKED_ON_DECLARED_PROFILE_ONLY` so the screen can say so. When an
investor deliberately publishes a mandate, that is the packet that may
change this, and not before.

## What does not exist here

No popularity, no trending, no view count, no dwell, no
recency-of-activity, no pay-to-rank. There is no port for "what this
person looked at", because a port that cannot express it cannot be misused
later. Viewing is not interest.

The score never reaches the wire. `rank` exists so a slate can be
reproduced and audited; the API drops it and the screen shows the reasons
instead, in the person's own declared vocabulary.

## Surfaces

- `GET /v1/discovery/companies` and `GET /v1/discovery/investors`, cursor-paged.
- `/discover` in the web app picks the direction from the person's own context.
- `discovery.slate` is the Q tool. It exists because the question people
  actually ask is "who can you tell me about?" — which a name search
  cannot answer, since it needs a name. Q asks the platform which side the
  person is on rather than guessing.

## Why a slate is thin

Every slate carries notes, so a person who sees three results knows
whether that is the network or their own mandate:
`NO_ACTIVE_MANDATE`, `MANDATE_HAS_NO_PREFERENCES`,
`NO_DISCOVERABLE_COUNTERPARTS`, `RANKED_ON_DECLARED_PROFILE_ONLY`.

An eligible counterpart with nothing declared in common still appears, last
and unexplained. Eligible is not the same as recommended, and hiding them
would be a ranking decision dressed as a filter.

## Hard eligibility (CQ-REC-001)

`src/eligibility/` is the gate before candidate generation (doc 19 §12–§13,
DMR-008/009). It answers one question — may this company legitimately
enter the pipeline for this investor in this context — and refuses to
answer any other: no score, no rank, no probability, no prose.

**Vocabulary.** `ELIGIBLE` when every applicable hard gate passes;
`INELIGIBLE` when an explicit hard rule is definitively violated;
`UNDETERMINED` when a hard rule exists and the canonical fact it needs is
absent. A FAIL outranks an UNKNOWN; an UNKNOWN never becomes a FAIL.
Unknown is not mismatch. Every result carries
`ELIGIBILITY_POLICY_VERSION` (`eligibility.v2`), the mandate id and
version, the taxonomy versions when supplied, one `CriterionResult` per
criterion in fixed order (`PASS | FAIL | UNKNOWN | NOT_APPLICABLE`) and
sorted, stable reason codes. `evaluatedAt` is the only field two
evaluations of the same snapshot may differ in.

**Criteria, in order, and where each fact comes from.**

| Criterion                   | Source                                                                                                                                         | Missing data                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `COMPANY_ACTIVE`            | Companies: `company_status`                                                                                                                    | —                                                                                                                              |
| `MARKETPLACE_PARTICIPATION` | Companies: `marketplaceParticipationOf(marketplace_readiness_state)`                                                                           | `not_assessed` and unknown states are NOT_ELIGIBLE (fail closed)                                                               |
| `COUNTERPART_DISTINCT`      | company organisation ≠ investor organisation                                                                                                   | —                                                                                                                              |
| `INVESTOR_DISCOVERABILITY`  | Companies: visibility classification **and** Permissions: disclosure                                                                           | —                                                                                                                              |
| `ACTIVE_MANDATE`            | Investors: the one ACTIVE mandate (or the pinned one, if the actor's)                                                                          | none → `NO_ACTIVE_MANDATE`; two → `ACTIVE_MANDATE_AMBIGUOUS`; DRAFT/CLOSED pinned → `MANDATE_NOT_ACTIVE` — all UNDETERMINED    |
| `HARD_EXCLUSION_TAXONOMY`   | Investors: `isExclusion` preferences from `user_selected`/`admin_curated` vs Taxonomy: ACTIVE assignments from `user_selected`/`admin_curated` | nothing declared in the excluded node's vocabulary → `COMPANY_TAXONOMY_UNKNOWN`                                                |
| `HARD_EXCLUSION_STAGE`      | Investors: HARD_EXCLUSION `stage` constraint vs `current_stage_code`                                                                           | `COMPANY_STAGE_UNKNOWN`                                                                                                        |
| `HARD_EXCLUSION_GEOGRAPHY`  | HARD_EXCLUSION `geography.country` vs `headquarters_country`                                                                                   | `COMPANY_GEOGRAPHY_UNKNOWN`                                                                                                    |
| `HARD_EXCLUSION_OTHER`      | HARD_EXCLUSION on `red_flag`, `business.attribute`, `founder.business_attribute`, `sector`, `investment_role`                                  | always `HARD_CRITERION_NOT_EVALUABLE`: no canonical company field answers these yet                                            |
| `CHEQUE_COMPATIBILITY`      | —                                                                                                                                              | always NOT_APPLICABLE: cheque is a fit factor, never a hard gate in v1                                                         |
| `RELATIONSHIP_STANDING`     | Network: `relationships.current_state`                                                                                                         | none/DISCOVERED pass; `RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY` is empty in v1; any other state → `RELATIONSHIP_STATE_UNKNOWN` |

For a HARD_EXCLUSION constraint the operator names the excluded set:
`EQ`/`IN` exclude the listed codes ("never show Series B"); `NEQ`/`NOT_IN`
exclude everything outside them ("Seed only"). MUST is a preference and
AVOID a soft negative; neither is read here. `custom.text` is MANUAL_ONLY
and never a rule. The investor's `min_cheque`/`max_cheque` carry no
importance and an investor whose maximum is below a company's total round
may fund part of it, so no cheque rule is invented — the criterion says so
rather than staying silent.

**Declared on both sides (`eligibility.v2`).** A taxonomy hard exclusion
compares declared mandate exclusions with declared company
classifications only (`DECLARED_TAXONOMY_SOURCES`: `user_selected`,
`admin_curated`). A `q_inferred`, `document_extracted` or `integration`
row is a candidate awaiting confirmation (ADR 0006 point 5): it neither
excludes the company nor answers the vocabulary. A company whose only
classifications in an excluded node's vocabulary are undeclared is
UNKNOWN (`COMPANY_TAXONOMY_UNKNOWN`), so UNDETERMINED — never PASS, never
FAIL. Confirming the suggestion (it becomes `user_selected`) is what makes
it exclude. `eligibility.v1` counted every ACTIVE row, so a Q inference on
an excluded node silently removed a company from an investor's
discovery. The port still returns every row with its `source`; the pure
policy decides which count, so the rule is versioned where the decision
is.

**What it cannot read.** `EligibilityPorts` has no port for Q memory,
conversations, documents, evidence text, public research, embeddings,
observed behaviour or model output, and
`test/eligibility-boundary.test.ts` fails the build if the subtree ever
imports a Q, evidence, media, onboarding or model package, names one of
their tables, or contains SQL. `test/eligibility.integration.test.ts`
inserts a founder-private memory item carrying
`REC_PRIVATE_FOUNDER_MEMORY_MUST_NOT_AFFECT_ELIGIBILITY`, a founder
conversation summary and a PUBLIC_WEB source into the real tables and
proves the decision and reasons do not move, then closes the company and
proves they do.

**Service.** `createEligibilityService` resolves the investor organisation
from the trusted actor, reads the ACTIVE mandate once, reads company facts
and disclosure in batches (`ELIGIBILITY_BATCH_MAX` = 200) and hands
snapshots to the pure `evaluateHardEligibility`. Only `INVESTOR_DISCOVER`
is evaluated; GateQ and the other doc 19 modes throw
`RecommendationModeUnsupportedError` rather than being approximated.
`createDomainEligibilityPorts` assembles the ports from the owning
contexts' public query ports — Companies, Taxonomy, Investors, Network,
Permissions — with no SQL of its own. Diagnostics are counts, versions and
duration; never a company, a mandate value or a reason per company.

**Not wired yet, on purpose.** The pre-REC slate above still gates on the
visibility column alone. REC-002 routes candidates through this service,
at which point marketplace readiness applies. The Companies context now
owns that assessment (CQ-MKT-001, `docs/modules/companies.md`): a company
is `marketplace_ready` only when its readiness policy says so, and in
production that needs a Verification context that does not exist yet, so
no real company is ELIGIBLE today. Locally, `pnpm dev:marketplace-ready`
produces one legitimately ready synthetic company. Nothing in
Recommendation decides readiness.

## Structured candidate generation (CQ-REC-002)

`src/candidates/` is Candidate Generator A (doc 19 §23), the structured
mandate generator: `STRUCTURED_MANDATE`, version `structured-mandate.v2`.
Candidate generation seeks recall; ranking (a later packet) buys
precision. Nothing here scores, ranks, counts matches, calls a model or
adds randomness.

**Input scope.** The actor's own investor organisation and its single
ACTIVE mandate, resolved through the same ports REC-001 uses. No ACTIVE
mandate, or more than one, is the typed `NO_ACTIVE_MANDATE` result; a
DRAFT is never read and there is no newest-by-date fallback. Positive
intent is derived from the mandate alone (`deriveStructuredIntent`):

| Dimension | Source of intent                                                                                                  | Company field                                                                                               | Reason code                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| STAGE     | positive `stage` constraints (EQ/IN name codes; NEQ/NOT_IN name the rest of the ladder) plus the min/max range    | `current_stage_code`                                                                                        | `STAGE_OVERLAP`                                    |
| GEOGRAPHY | positive `geography.country` constraints (EQ/IN only; "anywhere but" narrows nothing)                             | `headquarters_country`                                                                                      | `GEOGRAPHY_OVERLAP`                                |
| GEOGRAPHY | positive geography-vocabulary preference nodes, expanded to their reference descendants; `global` narrows nothing | ACTIVE geography classification                                                                             | `GEOGRAPHY_REGION_OVERLAP`                         |
| TAXONOMY  | positive preference nodes in every other vocabulary, expanded to their reference descendants                      | ACTIVE classification, exact node or a descendant                                                           | `TAXONOMY_OVERLAP` / `TAXONOMY_DESCENDANT_OVERLAP` |
| CHEQUE    | mandate cheque range                                                                                              | none: the capital objective is organisation-internal and its disclosure-safe projection is a later contract | never produced; the seam reports `NOT_COMPUTABLE`  |

Positive means MUST, STRONG or NICE. AVOID never retrieves and never
removes; HARD_EXCLUSION is REC-001's; a taxonomy preference counts only
from a `user_selected` or `admin_curated` source; MANUAL_ONLY constraints
are ignored. The same holds on the company side (`structured-mandate.v2`):
taxonomy and geography-region retrieval match only declared company
classifications, filtered inside the Taxonomy query
(`listCurrentByNodes(..., assignmentSources)`) so undeclared rows never
consume the bound; v1 matched any provenance. Descendant matching reuses the taxonomy query port's
`listDescendants` (reference hierarchy, bounded depth), with its own
reason code so an exact ask and an inherited one stay distinguishable.

**Retrieval.** Each dimension runs independently through the owning
contexts' ports (`createDomainCandidatePorts`, no SQL here): Companies
`listDiscoverableCompanies` (active, network_visible or public_external,
indexed on visibility + stage) and Taxonomy `listCurrentByNodes` (ACTIVE
assignments under the asked nodes, `entity_assignments_node_idx`),
intersected with the Companies discoverable projection so a private or
closed company never enters the pool even as an id. Every retrieval is
bounded (`CANDIDATE_DIMENSION_LIMIT` = 200) and ordered by canonical id.

**Merge.** Hits are unioned and deduplicated by canonical company id
(`mergeDimensionHits`): one candidate, every dimension and reason it
earned, matched nodes as ids only, sorted, then ordered by company id and
cut at `CANDIDATE_POOL_MAX` (200, the existing discovery budget). The
order is reproducibility, not desirability. Never merged by name, slug,
website or founder.

**Eligibility.** The deduplicated pool goes to REC-001 in one batch. Only
ELIGIBLE candidates leave; INELIGIBLE never do and UNDETERMINED is
counted, not promoted. A structured unknown (no stage on the company) is
not an eligibility unknown: the company is simply not found by that
dimension, and another may find it — but a company REC-001 cannot decide
is not rankable, whatever found it. Result: `StructuredCandidateResult`
with generator id and version, the eligibility policy version, the
recommendation context, the candidates with provenance and their
eligibility result, and safe diagnostics (raw hits by dimension, raw,
deduped, truncated, eligible, ineligible, undetermined, cheque seam
status, duration).

**Privacy.** The retrieval ports return ids, codes and matched node ids
over declared mandate intent and discovery-classified canonical state.
`eligibility-boundary.test.ts` now covers `src/candidates` and the
candidate adapter; `candidates.integration.test.ts` inserts a founder-
private memory item, a private conversation summary and a PUBLIC_WEB
source carrying `REC002_PRIVATE_FOUNDER_CONTEXT_MUST_NOT_AFFECT_CANDIDATES`
and proves ids, provenance and order do not move.

**Deferred, on purpose.** Semantic retrieval and its merge (REC-003),
feature computation and ranking, slates and the feed, portfolio,
relationship, freshness and exploration generators, GateQ, and a cheque
dimension once a disclosure-safe raise projection exists.

## Semantic candidate generation (CQ-REC-003)

Candidate Generator B (doc 19 §24–§26): the investor's ACTIVE mandate as a
query vector against precomputed vectors over a purpose-approved company
representation, through pgvector, into REC-001. It supplements the
structured generator where exact taxonomy misses nuance; it replaces
nothing, ranks nothing and enforces nothing.

- **Generator** `SEMANTIC_MANDATE` / `semantic-mandate.v1`, in
  `src/semantic/`. Same `CompanyId`, same eligibility result, same "ELIGIBLE
  only, canonical id order" output shape as REC-002. Provenance carries a
  cosine `similarity` in [-1, 1] and every version that could change it
  (representation versions, embedding configuration, instruction versions).
  The number is retrieval provenance for the ranker: never a percentage, a
  probability, a match or a threshold. No similarity cut-off rejects a
  company; top-K (`SEMANTIC_TOP_K` = 200, the structured dimension budget)
  bounds retrieval.
- **Company investment representation** `company-investment-representation.v1`
  (`buildCompanyInvestmentRepresentation`): a deterministic labelled text —
  `Company`, `Stage`, `Headquarters`, one line per canonical vocabulary,
  `Summary` — built only from the fields the Discover slate already shows an
  investor about a discoverable company (canonical name, short description,
  stage, headquarters country, ACTIVE canonical classifications). The input
  type has no field for memory, conversations, documents, evidence, research
  or a Q summary, so none can be embedded; business model, customer type,
  raise and traction are omitted because no canonical discovery-safe field
  exists for them yet. Same snapshot, same version, same text and sha256.
- **Investor representation** `investor-mandate-representation.v1`
  (`buildInvestorMandateRepresentation`): mandate name, the declared
  narrative (`raw_mandate_text`, investor-private), positive stage and
  country intent and positive taxonomy preferences, exactly as
  `deriveStructuredIntent` reads them. Hard exclusions and AVOID never enter
  the text: a "never" is REC-001's, and a soft avoidance is not a retrieval
  signal. Stored under the investor's tenant only; never joined into any
  founder-facing projection.
- **Embeddings** through `@capital-q/q-embeddings` unchanged: the local Qwen
  runtime (`Qwen/Qwen3-Embedding-0.6B`, 1024 dimensions, L2 unit vectors),
  documents without an instruction (`none-v1`), the mandate under the
  registered `MANDATE_MATCHING` task (`capital-q-mandate-matching-v1`). No
  hosted embedding provider, no Gemini, Groq, Tavily or ElevenLabs anywhere
  in the path. The runtime being down is a typed `UNAVAILABLE` result — never
  a zero, random or substitute vector.
- **Storage** is the server-only `recommendation` schema (migration
  `20260927090000`): `company_representations` and
  `mandate_representations` (one CURRENT row per subject, purpose and
  version; content immutable; superseded, never edited) and
  `company_embeddings` / `mandate_embeddings` (pgvector `vector(1024)`, work
  identity unique, immutable, cascade with their canonical row). RLS on, no
  policy, no browser grant; pgTAP `400_recommendation_semantic`. Not
  `q_knowledge.embeddings`: that store keys vectors to Q's private chunks.
  Exact scan under a `(configuration_version, instruction_version)`
  prefilter, as the q_knowledge store does at this volume; an approximate
  index is a later, measured decision.
- **Freshness** is `refreshCompanyRepresentations`: rebuild the text, compare
  its sha256 with the CURRENT row, supersede and insert on change, reuse an
  existing vector for identical content, embed the rest in one bounded
  batch. A row version bump without a visible change is not a new
  embedding. No worker yet: REC-004/REC-006 may automate the call from
  company and classification events.
- **Current discoverability wins**: the nearest-neighbour query joins
  `core.companies` for `active` and `network_visible` / `public_external`
  on every run, so a company that went private or closed never returns from
  a stale vector; readiness, disclosure and exclusions are then REC-001's.
- **Hybrid pool** `hybrid-candidate-pool.v1` (`src/hybrid/`): structured
  UNION semantic by canonical id, both provenances kept, canonical order,
  bounded by the pool budget. A semantic outage leaves the structured pool
  exactly as generated and says so (`semanticUnavailable`).
- **Boundary**: `eligibility-boundary.test.ts` scans `src/semantic`,
  `src/hybrid` and the two adapters: the embedding boundary is the only
  Q-side import allowed; no private store, generation provider or research
  tool is named; only the store adapter contains SQL, and only over its own
  schema and `core.companies`.

Golden scenarios A–O live in `semantic.test.ts` (deterministic concept
embedder, in-memory store, real REC-001 policy) and
`semantic.integration.test.ts` (real adapters, real store, local PostgreSQL;
the live Qwen block runs when the TEI runtime answers and is skipped
otherwise).

## Recommendation feature registry and privacy firewall (CQ-REC-004)

The governed, typed, versioned list of signals a ranker may read (doc 19
§38–§42, §92, §111, §144–§147), and the only legitimate input surface for
REC-005. Nothing here weighs, scores, ranks or explains.

- **Schema** `recommendation-features.v1` (`FEATURE_SCHEMA_VERSION`), separate
  from `eligibility.v2`, `structured-mandate.v2`, `semantic-mandate.v1`, the
  representation versions and any ranking version. A ranker declares the
  schema it understands and asks `registry.featuresFor(mode)`; a snapshot is
  validated against the registry (`registry.validateSnapshot`), never
  discovered by scanning rows.
- **Definitions** (`RECOMMENDATION_FEATURES`, frozen, validated at module
  load): id, version, group, data type, allowed contexts, source classes,
  sensitivity (the canonical six-class vocabulary), missing policy,
  description, and for categories/numbers the closed set or the range and
  direction. Identity is meaning, not code location; a changed meaning is a
  new version.

| Feature                              | Type                                            | Sources                                             | Sensitivity  | Missing                                                                                                                     |
| ------------------------------------ | ----------------------------------------------- | --------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `eligibility.hard_gate` v1           | boolean                                         | ELIGIBILITY_RESULT                                  | INTERNAL     | a gate reference, always true for rankable input, never weighted                                                            |
| `declared_fit.stage` v1              | MATCH / NO_MATCH                                | DECLARED_MANDATE + CANONICAL_COMPANY_STATE          | CONFIDENTIAL | MISSING when stage unknown; NOT_APPLICABLE without positive stage intent                                                    |
| `declared_fit.geography` v1          | COUNTRY_MATCH / REGION_MATCH / NO_MATCH         | + CANONICAL_TAXONOMY + TAXONOMY_REFERENCE_HIERARCHY | CONFIDENTIAL | MISSING when country and geography classification unknown; NOT_APPLICABLE without intent or with only the unrestricted node |
| `declared_fit.taxonomy` v1           | EXACT_OVERLAP / DESCENDANT_OVERLAP / NO_OVERLAP | DECLARED_MANDATE + CANONICAL_TAXONOMY + hierarchy   | CONFIDENTIAL | MISSING when the company has no declared classification in an asked vocabulary; Q-proposed rows never count                 |
| `declared_fit.cheque` v1             | number [0, 1]                                   | DECLARED_MANDATE + CANONICAL_COMPANY_STATE          | CONFIDENTIAL | always MISSING (`CHEQUE_NOT_COMPUTABLE`): no discovery-safe raise projection exists                                         |
| `semantic_fit.mandate_similarity` v1 | number [-1, 1]                                  | SEMANTIC_CANDIDATE_PROVENANCE                       | CONFIDENTIAL | MISSING (`SEMANTIC_NOT_RETRIEVED`) unless REC-003 retrieved the company; reused, never recomputed                           |

Every V1 feature allows `INVESTOR_DISCOVER` only. Any other context fails
closed (`FeatureContextNotAllowedError`), for the whole set and per feature.
The missing policy of every V1 feature is `PRESERVE_MISSING`: a reader never
imputes. Deferred groups — company state, evidence/confidence, portfolio,
behaviour, relationship, freshness, exploration, exposure — have no
definition and therefore no value, not a zero.

- **Firewall.** Feature computation reads typed projections tagged with the
  source class they are (`CANONICAL_COMPANY_STATE`, `CANONICAL_TAXONOMY`,
  `TAXONOMY_REFERENCE_HIERARCHY`, the two candidate provenances, the
  eligibility result, the ACTIVE mandate). A definition names the classes
  it accepts; a projection of any other class yields MISSING with
  `SOURCE_NOT_AUTHORISED` and a scope-violation count. The private classes
  (Q memory, conversations, transcripts, documents, evidence, data room,
  research, Q inference) are not in the vocabulary and cannot be named. The
  boundary guard holds `src/features` and its adapters to the eligibility
  list; the store adapter may touch `recommendation.feature_snapshots` only.
- **Values** (`FeatureValue`): id, version, status PRESENT / MISSING /
  NOT_APPLICABLE, typed value or null, bounded missing reason, contributing
  source classes, sensitivity, bounded provenance (ids, codes, versions;
  never text). Type-checked against the definition; JSON never coerces.
- **Snapshots** (`RecommendationFeatureSnapshot`): context, mandate and
  version, company and projection version, eligibility policy and
  decision, candidate provenance (generator, representation and
  configuration versions, reason codes), the values in registry order, the
  artifact's sensitivity (its most sensitive value; mandate-derived values
  are CONFIDENTIAL) and a sha256 fingerprint over the semantic inputs and
  values — never `computedAt` or an id. Same inputs, same fingerprint.
- **Service** (`createFeatureService`): refuses the context before any read,
  resolves the ACTIVE mandate through REC-001's ports, refuses any candidate
  that is not ELIGIBLE for this investor and mandate, reads company state
  and declared taxonomy in one batch and the preference hierarchy once, and
  computes purely. A candidate that is no longer discoverable gets no
  snapshot. Six statements per run, none per feature or per candidate.
- **Store** `recommendation.feature_snapshots` (migration `20260928090000`):
  one CURRENT row per investor organisation, mandate, company, context and
  schema version; identical fingerprint reused, changed fingerprint
  supersedes; content immutable; cascades with its canonical rows; RLS on,
  no policy, no browser grant; pgTAP `410_recommendation_features`. Rebuild
  and event-driven invalidation are REC-006's.
- **REC-005 seam.** The ranker consumes `ComputeFeaturesResult.snapshots`
  (or the CURRENT rows) under `recommendation-features.v1`, binds weights in
  its own versioned config, and never reaches around the service.

Golden scenarios A–W live in `features.test.ts` (registry, pure policy,
service over a fake world with founder-private markers in memory,
conversation, document and research) and `features.integration.test.ts`
(the real hybrid pool, the real store, markers in the real private tables,
ACTIVE/DRAFT changes, an unauthorised context).

## Deterministic V1 ranker (CQ-REC-005)

The first implementation of doc 19 §108's `Ranker`: REC-004 feature
snapshots in, an internal ordering out. Its only inputs are the snapshots
and one ranking config; it reads no database, calls no model, draws no
random number and reads no clock.

- **Identity.** Ranker `DETERMINISTIC`, implementation `deterministic-ranker.v1`,
  config `ranking-config.v1`, required feature schema
  `recommendation-features.v1`, context `INVESTOR_DISCOVER` only. Three
  separate versions; a result records all of them.
- **`ranking-config.v1`** (`RANKING_CONFIG_V1`, deep-frozen, validated
  against the registry at construction). Status `INITIAL_HEURISTIC_UNCALIBRATED`:
  no ADR fixes weights and doc 19 §53 leaves exact scoring open until
  outcome data exists, so v1 is the simplest transparent baseline.

| Factor                               | Weight | Normalization                                            |
| ------------------------------------ | ------ | -------------------------------------------------------- |
| `declared_fit.stage` v1              | 1      | MATCH 1 · NO_MATCH 0                                     |
| `declared_fit.geography` v1          | 1      | COUNTRY_MATCH 1 · REGION_MATCH 0.75 · NO_MATCH 0         |
| `declared_fit.taxonomy` v1           | 1      | EXACT_OVERLAP 1 · DESCENDANT_OVERLAP 0.75 · NO_OVERLAP 0 |
| `semantic_fit.mandate_similarity` v1 | 1      | (similarity + 1) / 2, clamped to [0, 1]                  |

Inactive, accounted for explicitly: `eligibility.hard_gate` (GATE_ONLY,
validated, never weighted) and `declared_fit.cheque` (NOT_COMPUTABLE).
Thresholds: `minimumFit` unset. Tie-break: score descending, then
canonical company id ascending; unscored after scored, by company id.
Score precision 12 decimal places. Exploration and diversity: `NONE`
(REC-009). Every registry feature allowed in the context must be either
a factor or inactive, so a new feature can be neither silently scored
nor silently ignored; a feature version change fails config validation.

- **Score.** For the factors whose feature is PRESENT:
  `Σ(normalized × weight) ÷ Σ(weight)`, in [0, 1]. MISSING and
  NOT_APPLICABLE factors are excluded from the denominator, never zero.
  With no present factor the candidate is unscored (`internalScore` null,
  reason `NO_SCOREABLE_FEATURES`), never "poor". Coverage
  (`availableWeight ÷ configuredWeight`) is a diagnostic, not a penalty.
  The number orders one pool under one config; it is not a probability, a
  quality score, readiness, or anything a user sees.
- **Output** (`RankedCandidate`): rank, internal score or null, ranker /
  config / schema versions, the snapshot fingerprint with mandate and
  company projection versions, both candidate provenances, one
  `FactorResult` per configured factor (value, normalized value, weight,
  contribution, polarity POSITIVE / SOFT_MISMATCH / SIGNAL, reason code,
  source classes) and bounded reason codes. Contributions sum to the score.
  No prose, no mandate text, no private data.
- **Refusal, fail closed** (`RankingInputError`): another context, tenant,
  investor, mandate or mandate version; another company or a duplicate;
  another feature schema; an unregistered, other-context or GateQ feature;
  a feature version the config was not written for; an ineligible
  decision or a false gate; content that no longer matches its
  fingerprint (a tampered value or client-supplied score).
- **Service** (`createRankingService`): one call ranks a pool — REC-004
  snapshots (computed now, reused on an identical fingerprint), then the
  ranker bound to the server's config. A caller names an actor, the mode,
  optionally its own mandate and the pool; never a config, weight, score or
  feature.
- **Boundary.** The ranking subtree is held to the eligibility list, may
  not import a domain context, the database or an infrastructure adapter,
  and may not contain randomness, clock reads or popularity terms.
- **REC-006 seam.** Persist `RankedCandidate[]` with its three versions and
  snapshot fingerprints on a slate; rebuild when snapshots supersede.

Golden cases A–R and GM-01..04 live in `ranking.test.ts`; the live local
ranking over the full pipeline in `ranking.integration.test.ts`, with the
reusable world in `test/support/recommendation-world.ts`.

Upstream versions. The ranker also refuses a snapshot computed under a
superseded eligibility policy (`ELIGIBILITY_POLICY_MISMATCH`) or candidate
generator (`CANDIDATE_VERSION_MISMATCH`): a v1-era snapshot is
self-consistent, so its fingerprint alone cannot reveal that it is stale.
It currently requires `eligibility.v2` and `structured-mandate.v2`, where
only declared company classifications decide exclusion and retrieval; a
Q-inferred classification on an excluded node changes no ranking (proved
in the integration privacy test).

The legacy Discover slate (`domain/ranking.ts`, `DISCOVERY_RANKING_VERSION`)
still serves the current UI with its own weights; REC-006 moves the slate
onto this pipeline.

## Not built yet

- Semantic _fit_ as a ranking factor (REC-004/REC-005). Semantic
  _retrieval_ exists above; its similarity is provenance, not a score.
- Evidence and freshness as ranking signals.
- Exploration and diversity.
- Precomputed slates. Today each request ranks a bounded candidate set of
  200 live; that is well within budget at this size and will not be at the
  next one.
- GateQ. Discovery answers "who could you meet"; whether a founder may
  reach an investor is a different question with its own rules.
- A closed or blocked relationship state. Network defines only
  DISCOVERED; when it defines more, `RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY`
  names them and the policy version moves.
- Persisted slates, the background worker and cursor feed (REC-006).
  The ranker above returns an in-memory ordering; nothing persists it yet.
- Feature groups beyond eligibility, declared fit and semantic fit: no
  definition, no value, no zero, until their source infrastructure exists.
- An event-driven representation refresh worker; today `refreshCompanyRepresentations`
  is an explicit, idempotent call.
