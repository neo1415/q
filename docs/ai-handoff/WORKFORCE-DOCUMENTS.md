# Existing workforce document connection

2026-10-11. IMPLEMENTED / LOCAL TESTED; exact-commit CI and release pending. This extends the existing
workforce, company specialist, artifact service and document worker. It creates
no second agent platform, document registry or business service.

## Scope and authority

An approved DOCUMENTS step carries a typed PREPARE request for OWN_COMPANY and
PITCH_DECK, ONE_PAGER or MEMO. JOB_PLAN v3 preserves that request through the
existing plan bounds, approval payload and durable resume. Revision, sharing,
sending and arbitrary company IDs are excluded from this capability.

`composition/workforce/documents.ts` resolves the approving actor afresh and
uses `ownCompanyOf`, the real Context Firewall and the existing composed company
specialist. The specialist's trusted EVIDENCE_ONLY preparation mode copies
canonical records and governed knowledge with their existing truth/evidence
classes. Stale or disputed knowledge contributes uncertainty rather than a
fresh asserted fact. No public research, semantic embedding, model synthesis,
memory model, statement write or profile update runs in this mode.

The existing `prepareOrReviseArtifact` composes the document, including the
existing own-company brand/deck facts. Immediately before queueing, the adapter
checks the current workforce lease/cancellation and resolves actor/firewall
again. Artifact persistence independently validates actor, tenant, run, subject
and plan freshness. No permitted plan is manufactured.

## Replay, progress and completion

Migration `20261222150000_workforce_document_binding.sql` adds a nullable,
immutable workforce job/step/approved-intent binding to the canonical artifact.
The job-owner composite FK and unique job/step index enforce identity. The
existing transaction creates exactly one artifact and one document job; a
competing request or restart reuses the same identity. Mismatched owner,
subject, document kind or approved intent cannot replay it.

The digest covers approved request/goal, original Q run, actor/organisation,
resolved own company and approved budget. It excludes regenerated content and
the retry's workforce step-run ID. A fresh authorized lookup resumes before
recomposition. The worker retains original Q-run provenance and the canonical
workforce correlation for the actual step run.

PREPARING keeps the existing workforce step RUNNING under its heartbeat; the
executor polls with cancellation/lease checks and a ten-minute operational
deadline. Only READY with an actual version yields DONE and an artifact ID.
Actual pipeline failure, unavailable authority or deadline is FAILED. There is
no outward action. Cancellation prevents later workforce continuations; a
private document job already enqueued can still finish through its existing
worker lifecycle, without making the cancelled workforce step DONE.

## Paid-generation limit

The current model gateway caps individual calls. Its optional usage ledger and
cached daily caps cannot prove a durable aggregate job allowance across crashes.
Do not claim that summing recorded usage enforces the approved budget.

This initial connection therefore adds zero paid generation calls: evidence-only
preparation and workforce-tagged document jobs skip optional polish, vision
critic and generated images. Existing deterministic design, confirmed brand,
stock-photo port and document audit remain. Foreground Q document jobs retain
their configured paid stages. Paid workforce document generation needs a real
canonical durable reservation before enabling those stages.

## Release and evidence

Run package builds, targeted workforce/document tests, root/app typechecks and
changed-file lint/format. Then require exact-commit quality and pgTAP CI green,
apply the additive migration using the existing hosted migration workflow,
deploy that exact revision and verify an authenticated private document job.

Service replay/auth tests and executor/adapter/worker regressions run without
provider calls. The PostgreSQL independent-transactions race regression is in
`packages/q-artifacts/test/artifact-repository.integration.test.ts`; it requires
an actual local database and has not been executed in this disk-limited cloud
instance. The new pgTAP suite checks owner FK, uniqueness, immutable intent/kind,
existing lifecycle, no browser writes and RLS. Do not label either database test
live-verified before its actual result.

Local validation: 52/52 package builds, 118/118 workforce/document/prompt tests
across 14 files, root and q-api typechecks, changed-file eslint/prettier and
diff check passed. The optional lock-regeneration helper was skipped; the
prompt-hash integrity test ran and passed.
