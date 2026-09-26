---
title: CQ-REC-002 structured candidate generator
project: capital-q
date: 2026-09-18
tags: [session-log, recommendation, discovery, rec-002]
---

# CQ-REC-002 structured candidate generator

**Objective:** high-recall, provenance-aware, eligibility-gated structured retrieval for INVESTOR_DISCOVER inside the existing Discovery context.

**What changed**
- `packages/discovery/src/candidates/{contracts,ports,structured,service}.ts` — vocabulary, retrieval ports, pure intent/merge, orchestration
- `packages/discovery/src/infrastructure/domain-port-candidate-sources.ts` — adapters over Companies and Taxonomy ports, discoverable-projection intersection, NOT_COMPUTABLE cheque seam
- `packages/companies` — `CompanyMarketplaceQueryPort.listDiscoverableCompanies` (bounded, id-ordered, visibility + stage index)
- `packages/taxonomy` — `TaxonomyAssignmentRepository.listCurrentByNodes` (node index, cross-tenant, ids only)
- tests: `candidates.test.ts` (golden A–U over fakes with the real REC-001 policy), `candidates.integration.test.ts` (live local acceptance), boundary guard extended
- chore commit `a78f87a`: three integration test-isolation fixes

**Decisions**
- See decisions.md (four entries dated 2026-09-18, REC-002).

**Open questions**
- Full integration gate is not green: eight failures remain, all traced to the demo Google posture migration versus tests scripted for the reviewed posture (Q/gateway test alignment).
- A disclosure-safe raise projection is the prerequisite for a cheque dimension.

**Next step**
- Realign the Q/gateway tests with the approved posture (or revert the demo posture) so `pnpm test:integration` exits 0; then CQ-REC-003.
