---
title: CQ-REC-006 persisted recommendation slates and background refresh
project: capital-q
date: 2026-09-19
tags: [session-log, recommendation, discovery, rec-006, slates, workers]
---

# CQ-REC-006 persisted recommendation slates and background refresh

**Objective:** make the REC-005 ordering durable: precomputed, versioned, immutable slates built by a worker on domain events and served by cursor through `/v1/discovery/companies` behind a read-time REC-001 guard.

**What changed**
- migration `20260929090000_recommendation_slates.sql` (slates, slate_items, refresh_requests, pgmq `recommendation-refresh`/`-dead`, triggers, RLS); pgTAP 420; schema guard; generated types
- `packages/discovery/src/slates/{contracts,ports,builder,refresh,reader}.ts`, `src/jobs/index.ts`, `infrastructure/{postgres-slate-repository,postgres-refresh-queue,recommendation-pipeline}.ts` (+ company card port in the discovery repository)
- `apps/workers/src/recommendations/{build-principal,refresh-handler}.ts`, domain-event bridge, main.ts composition; `apps/api` discovery route, app typing, problem mapping, main composition; contracts DTO (`slateId`, `reasonCodes`, two notes)
- tests: builder/refresh/reader unit, store/builder/reader integration, §92 acceptance, worker consumer, api route; docs/modules/discovery.md; ledger

**Checkpoints (each pushed, HEAD == origin):** A `29f7837`, B `105b737`, C `39bbaeb`, D `1eef635`, E (final) — see ledger.

**Decisions made**
- See decisions.md (six entries dated 2026-09-19, REC-006).

**Open questions**
- Organisation-level disclosure principal for builds; batching REC-001 port reads across tenants/pairs; scheduled rebuild on expiry; founder side still on the visibility slate.
- DEMO_PROVIDER_ROUTING_FOLLOWUP open; hosted migrations 20260925–20260929 pending.

**Next step**
- CQ-REC-007 — explanations (not started).
