---
title: CQ-REC-004 recommendation feature registry + privacy firewall
project: capital-q
date: 2026-09-18
tags: [session-log, recommendation, discovery, rec-004, features, privacy]
---

# CQ-REC-004 recommendation feature registry + privacy firewall

**Objective:** a typed, versioned, context-allowlisted feature registry and a FeatureService that turns the REC-002/REC-003 hybrid pool into governed feature snapshots for INVESTOR_DISCOVER, as the only input surface for the REC-005 ranker; founder-private data structurally unable to enter.

**What changed**
- `packages/discovery/src/features/` — contracts (`recommendation-features.v1`, six frozen V1 definitions, FeatureValue and snapshot schemas), policy (registry access that fails closed, pure computations over source-tagged projections, fingerprint, sensitivity), ports, service (batch compute, reuse/supersede)
- `packages/discovery/src/infrastructure/` — Postgres snapshot store; domain-port adapter (Companies profile port, Taxonomy with provenance, hierarchy)
- `supabase/migrations/20260928090000_recommendation_feature_snapshots.sql`, pgTAP `410`, schema guard, generated types
- tests: `features.test.ts` (23, golden A–W), `features.integration.test.ts` (4), boundary guard extended; pgTAP 400 table count corrected
- docs: discovery.md, ledger

**Commit:** `9efc3dc02cd023357f53ec9468e7417b94903c3d`, pushed, HEAD = origin.

**Gates:** db:reset, db:lint, db:types:check (clean after commit), test:rls 912, test:integration 459 pass / 5 skipped, format (tracked), lint, typecheck, test 2747, build 41, q:eval:lint/ci, diff --check, 0 cycles, secret scan — all green. Live acceptance: 3 candidates → 18 values, 14 present, 4 missing (cheque ×3, semantic ×1), 6 statements, 29 ms compute, 20 ms persist, 0 provider calls.

**Decisions made**
- See decisions.md (four entries dated 2026-09-18, REC-004).

**Open questions**
- DEMO_PROVIDER_ROUTING_FOLLOWUP remains open.
- Hosted Supabase needs 20260925–20260928 pushed (HOSTED_MIGRATIONS_PENDING).
- Snapshot invalidation/rebuild is REC-006's; behaviour/exposure features REC-008's.

**Next step**
- CQ-REC-005 — Deterministic Ranker (not started).
