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

## CQ-TAX-002 boundary

Not here: classification runs and candidates, exact/alias search endpoints,
full-text or semantic retrieval, embeddings, model classification,
confidence calibration, human review workflow, recommendation weighting,
taxonomy UI, an exhaustive global vocabulary.
