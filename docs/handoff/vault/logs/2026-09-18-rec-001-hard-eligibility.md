---
title: CQ-REC-001 deterministic hard eligibility
project: capital-q
date: 2026-09-18
tags: [session-log, recommendation, discovery, rec-001]
---

# CQ-REC-001 deterministic hard eligibility

**Objective:** a deterministic, private-safe, tri-state hard eligibility gate for INVESTOR_DISCOVER inside the existing Recommendation context, usable by REC-002.

**What changed**
- `packages/discovery/src/eligibility/{contracts,ports,policy,service}.ts` — vocabulary, ports that cannot express private material, pure policy v1, batch service
- `packages/discovery/src/infrastructure/domain-port-eligibility-sources.ts` — ports assembled from Companies/Taxonomy/Investors/Network/Permissions query ports, no SQL
- `packages/companies/src/domain/marketplace-participation.ts`, `CompanyMarketplaceQueryPort` + Postgres impl — readiness read as a participation verdict, owned by Companies
- `packages/contracts` — `MARKETPLACE_READINESS_MARKETPLACE_READY`
- tests: policy golden A–P, service fake-world privacy tests, static boundary guard, Postgres integration with the memory marker
- `docs/modules/discovery.md` — eligibility section; ledger postflight

**Decisions**
- See decisions.md (four entries dated 2026-09-18).

**Open questions**
- The pre-REC slate still gates on visibility only; REC-002 routes through eligibility and will be empty until a readiness engine writes `marketplace_ready`.
- Network defines only DISCOVERED; the closed set in policy v1 is empty.
- Onboarding writes stage as MUST + range, so a hard stage gate only arises from an explicitly declared HARD_EXCLUSION constraint.

**Next step**
- CQ-REC-002 — Structured Candidate Generator, consuming `createEligibilityService`.
