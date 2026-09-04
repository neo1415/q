# ADR 0006 — Taxonomy classification provenance and the deterministic classifier

**Status:** Accepted (CQ-TAX-002)
**Clarifies:** Document 13 §16 (`taxonomy.classification_runs`, `taxonomy.classification_candidates`),
Document 25 §60 (exact/search first; model mapping in Wave 5), Document 24 §297 (taxonomy eval),
ADR 0005 (`TaxonomyVersionSet`).

## Context

Capital Q must turn founder and investor language into canonical `TaxonomyNodeId`
candidates now, without an LLM, embeddings or Q runtime coupling, while leaving a clean seam
for later semantic and model adapters. Document 13 lists the provenance tables but leaves
three details open: the physical form of `taxonomy_version`, the run lifecycle, and how a
candidate becomes canonical truth.

## Decisions

1. **`taxonomy_version` is a jsonb version-set snapshot.** A classification may span several
   vocabularies, so the column stores the `TaxonomyVersionSet` in force
   (`{"industry": 1, "product_category": 1}`), never a single global integer. This is the
   representation ADR 0005 already exposes from the query port.
2. **Classifier identity is recorded honestly.** The V1 classifier is
   `capital_q / deterministic_lexical / taxonomy-lexical-v1`. `classifier_provider`,
   `classifier_model` and `classifier_version` are generic text so a future model adapter records
   its own provider, model and prompt/classifier version without a schema change. Lexical
   search is never labelled semantic; `SEMANTIC` and `MODEL` strategies are refused with a typed
   error until an adapter exists.
3. **Run lifecycle is `RUNNING → COMPLETED | ABSTAINED | FAILED`.** `FAILED` means execution
   failure only; "no confident candidate" is `ABSTAINED` with zero candidates. Abstention is a
   correct outcome and an eval metric.
4. **Confidence is a deterministic indicator, not a calibrated probability.** Exact canonical
   code = `1.0000`; exact alias / display name = `0.9500`; lexical = versioned score × `0.85`
   ceiling. Thresholds, weights and tiers live in one versioned policy object
   (`TAXONOMY_CLASSIFICATION_POLICY_V1`); changing any of them is a new classifier version and
   re-runs the golden eval.
5. **A candidate never becomes canonical on its own.** Acceptance is a human decision recorded
   on the candidate (`accepted`, `decided_by_user_id`, `decided_at`) and applied through the
   CQ-TAX-001 assignment path: `assignment_source = user_selected` (a deterministic suggestion
   confirmed by a person is not `q_inferred`), `classification_run_id` links provenance,
   `raw_source_text` is supplied by the owning workflow from the canonical source, and the
   existing audit action and `taxonomy.entity_assignments.changed` event fire. Rejections are
   kept as evaluation data. No alias is ever created by a user decision.
6. **Runs are provenance, not audit, and not events.** No audit row per lookup, no outbox event
   per run; the stateless candidate endpoint persists nothing.
7. **Raw text never enters a run.** Metadata is a bounded, strict object (strategy, resolution,
   counts, vocabulary codes, abstention reason, SHA-256 input hash, input length, failure code);
   the database rejects `text`, `rawText`, `prompt` and `response` keys.
8. **`pg_trgm` is the lexical engine; no trigram index yet.** Installed in the `extensions`
   schema like `btree_gist`. Retrieval is token overlap or `word_similarity` above a floor,
   restricted to candidate texts of at least six characters so abbreviations and ISO codes
   match by exact token only. Query plans over the reference-size taxonomy choose sequential
   scans and GIN trigram indexes serve only the operator forms, so none is added; a forward
   migration adds one when plans justify it.

## Consequences

- Onboarding, Q and Evidence call one classifier service; Q gets no taxonomy classifier of its own.
- Future semantic / model generators implement `TaxonomyCandidateGenerator` and return
  canonical node ids; vector storage never becomes taxonomy truth.
- Investor language yields concept candidates only; preference strength and hard exclusions are
  decided by the Investor mandate workflow, never inferred here.
