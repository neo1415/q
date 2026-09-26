---
title: CQ-REC-003 semantic candidate generator
project: capital-q
date: 2026-09-18
tags: [session-log, recommendation, discovery, rec-003, embeddings, pgvector]
---

# CQ-REC-003 semantic candidate generator

**Objective:** Candidate Generator B — ACTIVE mandate → deterministic investor representation → local Qwen query vector → pgvector top-K over purpose-approved company representations → REC-001 → merge-compatible provenance; hybrid pool with REC-002.

**What changed**
- `packages/discovery/src/semantic/` — contracts (`SEMANTIC_MANDATE` / `semantic-mandate.v1`, similarity as bounded provenance), pure representation builders (`company-investment-representation.v1`, `investor-mandate-representation.v1`), ports, service (explicit hash-driven refresh + generate)
- `packages/discovery/src/hybrid/` — structured UNION semantic by canonical id, both provenances, degrade-safe
- `packages/discovery/src/infrastructure/` — Postgres store over the new `recommendation` schema; domain-port adapter (Companies profile port, Taxonomy, Investors repository)
- `packages/companies` — `listDiscoverableInvestmentProfiles` (investor-visible fields only)
- `packages/q-embeddings` — additive `MANDATE_MATCHING` query instruction
- `supabase/migrations/20260927090000_recommendation_semantic_representations.sql`, pgTAP `400`, schema guard, `db:types`
- tests: representation, semantic golden A–O (concept embedder), hybrid, Postgres integration incl. live TEI block, boundary guard extended
- docs: discovery.md, q-embeddings.md, ledger

**Commit:** `2038e0b928b717ae4dd4fc83c21c86f6e5be459c`, pushed, HEAD = origin.

**Gates:** db:reset, db:lint, test:rls 890, test:integration 455 pass / 5 skipped, format (tracked), lint, typecheck (after one readonly-fixture fix), test 2722, build 41, q:eval:lint/ci, diff --check, 0 cycles, secret scan — all green. Live acceptance: refresh 6/6/6 then reused 6; top-K 4 → raw 4, ineligible 2, eligible 2; merged 3 (1 both, 1 semantic-only, 1 structured-only); ordering Kobo 0.734 > Haulr 0.542 > Berlin 0.334 > Bakehouse 0.327.

**Decisions made**
- See decisions.md (six entries dated 2026-09-18, REC-003 and the demo-routing follow-up).

**Open questions**
- DEMO_PROVIDER_ROUTING_FOLLOWUP remains open (not a REC-003 blocker).
- Hosted Supabase needs 20260925/20260926/20260927 pushed.
- Representation refresh is explicit; an event-driven worker is a later packet.

**Next step**
- CQ-REC-004 — Recommendation Feature Registry (not started).
