# Taxonomy module (`@capital-q/taxonomy`)

**Purpose.** One canonical Capital Q classification language, shared by both
sides of capital: companies are classified with, and investor mandates prefer,
the same `TaxonomyNodeId`s. A platform capability, not a UI enum. It makes
founder and investor language machine-comparable without losing the original
wording. No feature may introduce its own sector/industry/technology enum.

**Invariants.** Company classification ≠ Investor preference (same nodes).
`id` + `canonical_code` = identity; `display_name` ≠ identity.
`raw_source_text` = what was said; node = what Capital Q mapped it to.
Taxonomy = classification, never assessment, interest, outcome or a ranking
weight. Q suggestions are never canonical assignments until a human confirms.

## Canonical vocabularies (V1)

`industry`, `product_category`, `technology`, `business_model`,
`customer_type`, `company_stage`, `geography`, plus minimal shells
`impact_theme` and `regulatory_profile`. Separate vocabularies, never one
mega-tree; multi-label within and across vocabularies. Stage and geography
nodes are shared vocabulary for existing `current_stage_code`,
`target_stage`, mandate stage codes and `headquarters_country`; those columns
stay canonical and are not duplicated as assignments automatically.

## Stable identity and versioning (ADR 0005)

Reference ids are v5 UUIDs over a fixed namespace and the vocabulary/canonical
codes, rendered from `src/reference-data` into the migration; every
environment shares them and a DB test asserts equality. Versioning is
`vocabularies.version` + node status/validity + `successor_of` edges;
`TaxonomyVersionSet` (`code → version`) is what classification runs and
recommendation experiments record. No `taxonomy_versions` table.

## Primary hierarchy and edges

`parent_node_id` + `depth` form the primary tree (breadcrumbs, navigation,
ancestry). A parent is always in the same vocabulary (composite FK) and a
`BEFORE` trigger enforces `depth = parent.depth + 1`, roots at 0 and no
cycles with a bounded ancestor walk; the reference data is validated in
TypeScript before rendering. `node_edges` carry non-tree semantics only:
`broader_than`, `related_to`, `overlaps`, `commonly_co_occurs`,
`successor_of` (from = replacement, to = deprecated concept). No self-edges,
no duplicate `(from, to, type)`, no weights.

## Aliases

`normalizeTaxonomyAlias`: NFKC → trim → lowercase → collapse whitespace → no
spaces around `/` and `-`, single spaces around `&` and `,`. Exact lookups
via `(normalized_alias)`, `(locale, normalized_alias)` and `(node_id)`; unique
only per node and locale, so "payments" may name nodes in several
vocabularies (CQ-TAX-002 disambiguates). Aliases never replace the node's
canonical identity or the user's text.

## Entity assignments (company classification)

`taxonomy.entity_assignments`: typed subject (`COMPANY`, resolved through
`CompanyQueryPort` under the actor's tenant, enumeration-safe), node,
`assignment_source` (user_selected | q_inferred | document_extracted |
admin_curated | integration — chosen by the owning flow, never a client),
optional exact `confidence`, `raw_source_text` (≤ 4000, verbatim, never
emitted), provenance hooks (`source_id`, `classification_run_id`, no FK
until their targets exist), confirmation, validity. Current = ACTIVE with no
`valid_to`; replacement supersedes removed rows (`valid_to`) and inserts new
ones; unchanged rows are untouched; nothing is deleted. One current row per
subject + node. `replaceCompanyAssignments` requires `company.edit` on the
exact company (founder status alone grants nothing), audits
`taxonomy.company_assignments.updated` (vocabulary, counts) and emits
`taxonomy.entity_assignments.changed@1` (subject + vocabulary codes only).

## Mandate taxonomy preferences

`taxonomy.mandate_preferences` keyed `(mandate_id, node_id)` with the existing
strength scale (MUST … HARD_EXCLUSION), `HARD_EXCLUSION ⇔ is_exclusion`
(AVOID stays soft). Written only through the Investor mandate create/update
command: `investor.mandate.edit`, version check and increment, audit, and
`core.investor_mandate.updated` with change kind `TAXONOMY`. No taxonomy-only
route, no observed-behaviour or Q write path. Investor-private.

## Reference data and API

Deployed by the forward migration (production mechanism), idempotent, not
dev-seed-only. Read-only API for authenticated users:
`GET /v1/taxonomy/vocabularies`,
`GET /v1/taxonomy/vocabularies/:code/nodes` (`roots=true` | `parentNodeId`,
`status`, cursor pagination), `GET /v1/taxonomy/nodes/:id` (node + ancestors

- aliases). Typed client methods in `@capital-q/api-client`.

## Security posture

All six tables are `INTERNAL_SERVER_ONLY` (RLS enabled, no policies, no
client grants). Tenant identity comes from `ActorContext`; subject identity
from the company query port. `entity_type` never selects a table.

## Classification (CQ-TAX-002)

Deterministic language → canonical `TaxonomyNodeId` candidates. Pipeline:
normalise (the CQ-TAX-001 alias normaliser) → scope active vocabularies →
generators `canonical_code_exact` → `alias_exact` → `display_name_exact` →
`lexical_search` → merge/dedupe by node → rank (exact tiers before lexical
score) → ambiguity → abstention → typed result. Strategies `AUTO` (exact
first, lexical only if nothing exact), `EXACT`, `LEXICAL`; `SEMANTIC` and
`MODEL` are declared but refused with `TaxonomyClassifierNotAvailableError`
(HTTP 503 `PROVIDER_UNAVAILABLE`, detail `CLASSIFIER_NOT_AVAILABLE`).
Classifier identity: `capital_q / deterministic_lexical / taxonomy-lexical-v1`.

**Lexical search** uses `pg_trgm` (`extensions` schema): SQL retrieves ACTIVE
nodes whose label, code words or alias share a token with the query or whose
`word_similarity(candidate, query)` reaches the floor (candidate text ≥ 6
chars); the versioned TypeScript formula scores them
(`max(0.55·tokenCoverage + 0.45·similarity, similarity)`, alias field × 0.95).
No trigram index yet (plans prefer sequential scans at reference size). Lexical
is never presented as semantic.

**Resolution.** One exact-tier node → `EXACT`; several (an alias shared across
vocabularies) → `AMBIGUOUS`; lexical hits ≥ 0.35 → `CANDIDATES` unless the two
best in one vocabulary are ≥ 0.60 and within 0.02 (`AMBIGUOUS`); otherwise
`ABSTAINED` with `NO_CANDIDATES` / `LOW_CONFIDENCE` / `NO_ACTIVE_VOCABULARY`.
Confidence is a deterministic indicator, **not a calibrated probability**:
`1.0000` canonical code, `0.9500` exact alias/display, lexical ≤ `0.8500`.
Every threshold lives in `TAXONOMY_CLASSIFICATION_POLICY_V1`.

**API.** `POST /v1/taxonomy/candidates` `{ text ≤ 2048, vocabularyCodes? ≤ 16,
strategy?, limit? ≤ 20 }` → `{ resolution, candidates[rank, confidence,
matchTypes, rationaleSummary], abstentionReason?, taxonomyVersions, classifier }`.
Authenticated, read/compute only, persists nothing, `Cache-Control: no-store`.
Client: `findTaxonomyCandidates`. No classification-run, decision or alias
route exists for the browser.

**Provenance.** `taxonomy.classification_runs` (tenant from the resolved
subject, `COMPANY` subject, optional `COMPANY_PROFILE` input source, classifier
provider/model/version, `taxonomy_version` jsonb version set, status
`RUNNING → COMPLETED | ABSTAINED | FAILED`, `cost_usd = 0`, bounded metadata:
strategy, resolution, counts, vocabulary codes, abstention reason, SHA-256
input hash, input length — never raw text) and
`taxonomy.classification_candidates` (PK run + node, unique run + rank,
confidence numeric(5,4), closed `match_types`, rationale ≤ 300, tri-state
`accepted` with `decided_by_user_id` / `decided_at`).
`entity_assignments.classification_run_id` now has a RESTRICT FK. Internal
service only (`classifyWithProvenance`, `company.edit`); the stateless
endpoint creates no run. Runs are provenance, not audit; no outbox event.

**Human confirmation.** `acceptCompanyCandidate` (run in the actor's tenant,
enumeration-safe → company visible → `company.edit` → candidate belongs to the
run and is undecided → node ACTIVE → tx: assignment `user_selected` with the
caller-supplied raw source text, `classification_run_id`, confirmed by the
actor; candidate `accepted = true`; the CQ-TAX-001 audit action (with
`classificationRunId`) and `taxonomy.entity_assignments.changed`).
`rejectCompanyCandidate` records `accepted = false` only. A decision is never
toggled; no alias is ever created by a decision. Investor language yields
concept candidates only — preference strength and `HARD_EXCLUSION` are never
inferred and `mandate_preferences` is never written here.

**Privacy and telemetry.** Input text is never logged, stored in run metadata,
audited or published; logs carry lengths, hashes, counts, resolution and
classifier version; metrics (`taxonomy_candidate_requests_total`,
`_resolution_total`, `_latency`, `taxonomy_abstentions_total`,
`taxonomy_ambiguities_total`, `taxonomy_persistent_runs_total`,
`taxonomy_classification_failures_total`) use bounded labels only.

**Eval.** `pnpm eval:taxonomy` runs the golden fixtures
(`src/classification/evaluation/fixtures.ts`, `taxonomy-golden-v1`) against
the database and writes `evals/reports/taxonomy-lexical-v1.json`: exact top-1,
lexical top-1 / top-k, multi-label precision / recall, ambiguity and abstention
correctness. Exact top-1, ambiguity and abstention are hard gates; lexical and
multi-label numbers are reported as they are. Re-run after any change to alias
normalisation, scoring or reference data.

## Not here (later packets)

Semantic candidate retrieval (interface `SemanticTaxonomyCandidateProvider`
only), model classification (interface `ModelTaxonomyClassifier` only),
ModelGateway, embeddings / pgvector, a classification worker or queue, a
reviewer queue UI, onboarding and evidence sources, recommendation weighting,
taxonomy UI, an exhaustive global vocabulary.
