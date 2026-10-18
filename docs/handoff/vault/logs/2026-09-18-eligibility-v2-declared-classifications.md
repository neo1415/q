---
title: eligibility.v2 — declared company classifications only
project: capital-q
date: 2026-09-18
tags: [session-log, discovery, eligibility, defect]
---

# eligibility.v2 — declared company classifications only

**Objective:** stop a `q_inferred` / `document_extracted` / `integration` company classification from hard-excluding a company (defect found in REC-005 testing).

**What changed** (commit d0893d4 on recovery/2026-09-12)
- `packages/discovery/src/eligibility/{contracts,policy,ports}.ts` — `eligibility.v2`; classifications carry `source`; policy counts declared only.
- `packages/discovery/src/candidates/contracts.ts` — `structured-mandate.v2`.
- `packages/discovery/src/infrastructure/domain-port-{eligibility,candidate}-sources.ts` — pass source; retrieval asks for declared sources.
- `packages/taxonomy/src/{application/ports,infrastructure/postgres-assignment-repository}.ts` — optional `assignmentSources` filter in `listCurrentByNodes` SQL.
- Tests: v2 goldens in `eligibility-policy.test.ts`, integration cases in `eligibility.integration` and `candidates.integration`; version literals elsewhere.
- `docs/modules/discovery.md`, ledger.

**Decisions**
- Versioned policy change, not a patch — see [[decisions]].

**Open questions**
- None. REC-005 WIP (uncommitted in the main checkout) had its `ranking.test.ts` literal and its "Known, outside this packet" paragraph in `discovery.md` updated in place.

**Next step**
- Resume CQ-REC-005 on top of d0893d4.
