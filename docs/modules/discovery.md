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
`ELIGIBILITY_POLICY_VERSION` (`eligibility.v1`), the mandate id and
version, the taxonomy versions when supplied, one `CriterionResult` per
criterion in fixed order (`PASS | FAIL | UNKNOWN | NOT_APPLICABLE`) and
sorted, stable reason codes. `evaluatedAt` is the only field two
evaluations of the same snapshot may differ in.

**Criteria, in order, and where each fact comes from.**

| Criterion                   | Source                                                                                                        | Missing data                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `COMPANY_ACTIVE`            | Companies: `company_status`                                                                                   | —                                                                                                                              |
| `MARKETPLACE_PARTICIPATION` | Companies: `marketplaceParticipationOf(marketplace_readiness_state)`                                          | `not_assessed` and unknown states are NOT_ELIGIBLE (fail closed)                                                               |
| `COUNTERPART_DISTINCT`      | company organisation ≠ investor organisation                                                                  | —                                                                                                                              |
| `INVESTOR_DISCOVERABILITY`  | Companies: visibility classification **and** Permissions: disclosure                                          | —                                                                                                                              |
| `ACTIVE_MANDATE`            | Investors: the one ACTIVE mandate (or the pinned one, if the actor's)                                         | none → `NO_ACTIVE_MANDATE`; two → `ACTIVE_MANDATE_AMBIGUOUS`; DRAFT/CLOSED pinned → `MANDATE_NOT_ACTIVE` — all UNDETERMINED    |
| `HARD_EXCLUSION_TAXONOMY`   | Investors: `isExclusion` preferences from `user_selected`/`admin_curated` vs Taxonomy: ACTIVE assignments     | nothing in the excluded node's vocabulary → `COMPANY_TAXONOMY_UNKNOWN`                                                         |
| `HARD_EXCLUSION_STAGE`      | Investors: HARD_EXCLUSION `stage` constraint vs `current_stage_code`                                          | `COMPANY_STAGE_UNKNOWN`                                                                                                        |
| `HARD_EXCLUSION_GEOGRAPHY`  | HARD_EXCLUSION `geography.country` vs `headquarters_country`                                                  | `COMPANY_GEOGRAPHY_UNKNOWN`                                                                                                    |
| `HARD_EXCLUSION_OTHER`      | HARD_EXCLUSION on `red_flag`, `business.attribute`, `founder.business_attribute`, `sector`, `investment_role` | always `HARD_CRITERION_NOT_EVALUABLE`: no canonical company field answers these yet                                            |
| `CHEQUE_COMPATIBILITY`      | —                                                                                                             | always NOT_APPLICABLE: cheque is a fit factor, never a hard gate in v1                                                         |
| `RELATIONSHIP_STANDING`     | Network: `relationships.current_state`                                                                        | none/DISCOVERED pass; `RELATIONSHIP_STATES_CLOSED_TO_DISCOVERY` is empty in v1; any other state → `RELATIONSHIP_STATE_UNKNOWN` |

For a HARD_EXCLUSION constraint the operator names the excluded set:
`EQ`/`IN` exclude the listed codes ("never show Series B"); `NEQ`/`NOT_IN`
exclude everything outside them ("Seed only"). MUST is a preference and
AVOID a soft negative; neither is read here. `custom.text` is MANUAL_ONLY
and never a rule. The investor's `min_cheque`/`max_cheque` carry no
importance and an investor whose maximum is below a company's total round
may fund part of it, so no cheque rule is invented — the criterion says so
rather than staying silent.

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
mandate generator: `STRUCTURED_MANDATE`, version `structured-mandate.v1`.
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
are ignored. Descendant matching reuses the taxonomy query port's
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

## Not built yet

- Semantic fit over company descriptions (CQ-RAG exists; it is not wired
  into this path).
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
- Semantic candidate generation (REC-003), ranking (REC-005) and
  persisted slates (REC-006). The structured generator above is their
  input, not a substitute.
