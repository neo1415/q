---
title: CQ-MKT-001 marketplace readiness and activation gate
project: capital-q
date: 2026-09-18
tags: [session-log, companies, marketplace, readiness, verification]
---

# CQ-MKT-001 marketplace readiness and activation gate

**Objective:** make `marketplace_readiness_state` a canonical, deterministic, Companies-owned assessment with an honest verification seam, so REC-001 has a legitimate state to read.

**What changed**
- `packages/contracts` — readiness states, requirement/outcome vocabulary, assessment DTO, route segments
- `packages/companies/src/domain/marketplace-readiness.ts` — policy v1 + wording table
- `packages/companies/src/application/marketplace-readiness.ts` — get (view) and assess (edit) use cases, shared reconciliation; `set-company-visibility.ts` reconciles on withdrawal
- `packages/companies` — `VerificationClaimsPort`, unavailable production adapter, `dev/` synthetic seam + CLI, `updateReadiness`, `core.company.marketplace_readiness_changed`@1
- `apps/api` routes, `packages/api-client`, web visibility screen/actions
- tests: companies policy/use-case/integration, API routes, discovery integration proof; `scripts/dev-marketplace-ready.mjs`

**Decisions**
- See decisions.md (four entries dated 2026-09-18, marketplace readiness).

**Open questions**
- A Verification bounded context (`evidence.verification_claims`, provider, admin review) is the prerequisite for any production company to be marketplace-ready.
- The dev founder must publish in the UI before `pnpm dev:marketplace-ready` can succeed; the fixture will not choose visibility for them.

**Next step**
- CQ-REC-002 — Structured Candidate Generator.
