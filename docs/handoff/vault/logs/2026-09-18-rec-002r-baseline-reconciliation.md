---
title: CQ-REC-002R baseline reconciliation and REC-002 closeout
project: capital-q
date: 2026-09-18
tags: [session-log, recommendation, provider-policy, permissions, rec-002]
---

# CQ-REC-002R baseline reconciliation and REC-002 closeout

**Objective:** back up the gate-pending REC-002 checkpoint, reconcile the provider-policy integration baseline without weakening privacy, remove the permissions two-clock race, rerun the clean gate and close REC-002.

**What changed**
- `supabase/migrations/20260926090000_restore_reviewed_google_posture.sql` — google → UNREVIEWED, Gemini ceilings → PUBLIC (forward correction of 20260919/20260921, classification C; 20260920 Gemini-first preference kept)
- `packages/model-gateway/test/provider-posture-matrix.test.ts` — sensitivity × provider matrix on fake providers
- Fixtures realigned on approved, privacy-neutral changes only: gateway postgres test, orchestrator answer-seam (Gemini at PUBLIC, tools-first note), QCI-001/002/006/007/017 prompts (analysis-verb scope), pgTAP 320 counts (qwen row)
- `packages/permissions` — `NewDisclosurePolicy.createdAt` from the injected clock, written by the repository; `clock-determinism.test.ts`
- docs: runbook deploy-demo, q-voice demo posture, implementation ledger (REC-002 PASS)

**Commits** (all pushed, HEAD = origin): `65dcb05` checkpoint (gate-pending, preserved) → `b426b51` provider baseline → `236e360` clock → `aec06f9` ledger closeout.

**Gates:** db:reset; test:rls 856 PASS; test:integration 449 pass / 5 skipped / 0 fail; lint, typecheck, test 2685, build 41, db:lint, q:eval:lint, q:eval:ci (release gate PASS) all exit 0; format:check warnings only under untracked graphify-out. Live REC-002 run 13/8/5/3/0, 149–172 ms.

**Decisions made**
- See decisions.md, three entries dated 2026-09-18 (classification C, fixture-realignment rule, one clock per policy lifecycle).

**Open questions**
- Hosted Supabase still holds the demo posture until 20260925/20260926 are pushed with `pnpm db:push`.
- The 1 WARN in q:eval:ci predates this packet and is not a hard failure; worth a look before REC-003 evals grow.

**Next step**
- CQ-REC-003 (not started).
