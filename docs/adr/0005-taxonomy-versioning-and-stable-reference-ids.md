# ADR 0005 — Taxonomy versioning and stable reference identifiers

**Status:** Accepted (CQ-TAX-001)
**Clarifies:** Document 11 §11.4/§11.9 (`taxonomy_versions`), Document 13 §15 (`taxonomy.vocabularies.version`).

## Context

Document 11 lists a conceptual `taxonomy_versions` record; Document 13's physical schema
carries `taxonomy.vocabularies.version` plus node validity windows and status. Later
classification runs and recommendation experiments must record the exact vocabulary
versions they used, and platform taxonomy rows must carry the same identifiers in every
environment so fixtures, evals and API consumers can name the same concept.

## Decision

1. **No separate `taxonomy_versions` table.** A vocabulary's semantic/reference version is
   `taxonomy.vocabularies.version` (integer ≥ 1, bumped by a reviewed migration). Node
   identity (`id`, `canonical_code`) is stable across versions; evolution uses node
   `status` (ACTIVE / DEPRECATED), `valid_from` / `valid_to` and `successor_of` edges. The
   exact versions in force are exposed as `TaxonomyVersionSet = Record<vocabularyCode,
version>` from the query port; consumers persist that set with their results.
2. **Deterministic reference identifiers.** Platform vocabularies, nodes and aliases carry
   RFC 4122 v5 UUIDs computed from a fixed Capital Q taxonomy namespace and the concept's
   stable name (`vocabulary:<code>`, `node:<vocabulary>/<canonical_code>`,
   `alias:<vocabulary>/<code>:<locale>:<normalized>`), generated in
   `@capital-q/taxonomy/reference-data` and written as explicit constants into the forward
   migration. Local, test, staging and production share them; a database test asserts the
   database equals the TypeScript reference set.
3. **Reference data changes only by reviewed migration.** No runtime editor, no per-row
   audit/outbox events during seeding; git and migration history are the deployment
   record. A renamed display label never changes an id or canonical code; a changed
   concept is a new node plus a `successor_of` edge, and historical assignments to the old
   node are never rewritten.

## Consequences

- One versioning mechanism; classification runs (CQ-TAX-002) record `TaxonomyVersionSet`.
- Adding a vocabulary or node is additive; deprecating one is a status change with history intact.
- A second, global taxonomy version counter is not introduced unless a future packet shows
  per-vocabulary versions are insufficient.
