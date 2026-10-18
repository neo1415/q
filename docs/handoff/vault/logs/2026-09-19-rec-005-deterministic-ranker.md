---
title: CQ-REC-005 deterministic V1 ranker
project: capital-q
date: 2026-09-19
tags: [session-log, recommendation, discovery, rec-005, ranking]
---

# CQ-REC-005 deterministic V1 ranker

**Objective:** a deterministic, versioned ranker that orders eligible candidates from REC-004 feature snapshots only, with missingness preserved and no hidden factors.

**What changed**
- `packages/discovery/src/ranking/` — config (`ranking-config.v1`, INITIAL_HEURISTIC_UNCALIBRATED), contracts (`RankedCandidate`, `FactorResult`, typed refusals), ranker (pure scoring, validation, ordering), service (one-call pool ranking through the feature service)
- tests: `ranking.test.ts` (37), `ranking.integration.test.ts` (4), reusable `test/support/recommendation-world.ts`, ranking boundary guard
- docs: discovery.md, ledger

**Sequencing:** a concurrent session fixed REC-001 (eligibility.v2 / structured-mandate.v2, `d0893d4`) in the same checkout mid-packet. REC-005 was preserved as the non-PASS checkpoint `e074553` on `scratch/rec005-v1-checkpoint`, the fix landed first, then REC-005 was cherry-picked without committing and reconciled.

**Commit:** `d0e5d17fedc6f7018732174f0da297ba76507033`, pushed, HEAD = origin.

**Gates:** all green on a reset DB — RLS 912, integration 465 pass / 5 skipped, unit 2792, build 41, lint, typecheck, format, Q eval CI.

**Decisions made**
- See decisions.md (five entries dated 2026-09-18, REC-005); plus: the ranker refuses snapshots from a superseded eligibility policy or generator version, since a stale snapshot's fingerprint is self-consistent.

**Open questions**
- `scratch/rec005-v1-checkpoint` (remote) and the `scratchpad/rec005-verify` worktree are left in place; delete when no longer wanted.
- DEMO_PROVIDER_ROUTING_FOLLOWUP open; hosted migrations 20260925–20260928 pending.

**Next step**
- CQ-REC-006 — Slate Persistence / Background Worker (not started).
