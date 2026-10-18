---
title: CQ-REC-007 recommendation explanations and synthetic-demo Gemini routing
project: capital-q
date: 2026-09-20
tags: [session-log, recommendation, discovery, rec-007, explanations, model-gateway, providers]
---

# CQ-REC-007 explanations + synthetic-demo Gemini routing

**Objective:** close DEMO_PROVIDER_ROUTING_FOLLOWUP so demo work stops hitting Groq free-tier limits, then make every persisted recommendation answer "why am I seeing this?" deterministically, with Q phrasing it when available.

**What changed**
- `packages/contracts`: `ModelDataPosture`, `dataPosture` on the gateway request, `ELIGIBLE_SYNTHETIC_DEMO`; explanation DTO + path
- `packages/model-gateway`: `policy/synthetic-demo.ts` (the attestation), the two ceiling checks in `planRoute` made conditional, posture on the trace and the served log, `dataPosture` on the Q answer seam
- `packages/config`: `CQ_SYNTHETIC_DEMO_ROUTING` (default off)
- `packages/discovery`: `explanations/{contracts,policy,service}.ts`, `findItem`, `readFeatureSnapshotById`, narrator port, boundary guard
- `packages/q-specialists`: `recommendation/narrator.ts` — first consumer of `FIT_EXPLANATION_V1`, plus `groundingFailure`
- `apps/q-api`: explanation route, app module, composition; `apps/workers` + `apps/q-api` build the attestation
- `scripts/demo-routing-smoke.mjs`; docs/modules/discovery.md; ledger

**Checkpoints (each pushed, HEAD == origin):** A `413d8c0`, B `ad3a3f0`, C `b85b7d9`, D `7f5bf0c`, E final.

**Decisions made**
- See decisions.md (six entries dated 2026-09-20).

**Open questions**
- The conversational guard (`recommendation-guard.ts`) still strips recommendation claims from the chat answer path; turning it into "cites factors the ranker produced" belongs with the conversational integration.
- Q eval cases for explanation grounding were left as deterministic unit tests; adding `QEXPL-*` to the eval datasets needs a new ROUTING scenario and possibly a new hard invariant.
- Hosted migrations 20260925–20260929 still pending; REC-007 added none.

**Next step**
- CQ-REC-008 — recommendation interaction events (not started).
