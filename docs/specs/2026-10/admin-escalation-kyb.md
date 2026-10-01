# ADMIN-3 — Human review (appeals Stage 4) and manual KYB

Owner: ADMIN worker, branch `build/admin-3` from 7a3749bd. Migration prefix
`2026111501*`. Builds on ADR 0033 (operator console), CQ-VERIFY-001.

## 1. What V1 requires (controlling sources)

- **PADL #050 (locked)**: appeals are a first-class workflow in four stages —
  AI explanation, evidence submission, reassessment, and **Stage 4 human
  escalation** ("users may request formal human review … platform errors,
  exceptional circumstances, complex institutional judgement, verification
  disputes"). Human review is a safeguard, not a replacement for Q's
  reasoning; every assessment keeps **appeal history**.
- **PADL #051**: the Institutional OS surfaces "verification workflows" and
  "**human appeal queues**".
- **PADL (abuse), Spec 8.1.6**: material enforcement supports review or
  appeal; verification states can be verified / expired / disputed / revoked.
- **PADL progressive verification, Spec 8.1, doc 10 F11**: Organisation
  Verified is a distinct claim, requested near marketplace activation;
  verification is not endorsement.
- **Doc 15 §81**: store result, claim type, provider reference, time, expiry
  and minimal evidence metadata; prefer an external vendor for sensitive ID
  data; avoid retaining raw identity documents.
- **ADR-001**: `verification_claims` stays separate from truth / evidence /
  lifecycle axes.

## 2. Smallest true version

**Human review.** A person asks for a human review of something Capital Q or
Q decided: a readiness reading, a verification decision, an account action
(suspension or Q's pause), a Q assessment, or other. The case keeps a
**reference** (subject type + id) and the person's own reason — never a copy
of private data. It lands in the console's **Reviews** queue with a 3-day
SLA (due date, overdue flag). An admin with `reviews.decide` (step-up)
records an outcome — UPHELD (decision stands), CHANGED (corrected; the admin
acts through the normal console path), NEEDS_EVIDENCE (Stage 2: add
evidence) — with a reason. Decided once (DB trigger) and audited in
`platform_ops.admin_actions`. The person gets a "Needs you" notice (emailed
by the existing delivery when unread) and sees the case on `/reviews`.
Q offers it through `propose_human_review` (Prepare → Approve,
action `review.request`); the person's approval creates the case.

**KYB (manual).** An organisation member with `verification.request` submits
legal name, registration number, jurisdiction, optional address and
website, and optionally a document uploaded through the existing evidence
upload (type CORPORATE). This records the ORGANISATION verification claim
as PENDING (same row, audit and event as today) and a `core.kyb_submissions`
row pointing at it. The submission appears beside its claim in the
console's verification queue with a one-minute signed link to the document.
The admin's decision is the existing OPERATOR_DECISION (VERIFIED, or REVOKED
with the reason), and the submission closes with the same outcome; the
organisation gets a notice. A `KybProvider` adapter interface exists for a
future vendor; no vendor code.

## 3. Data (migration 20261115010000)

- `core.human_reviews` — RLS_REQUIRED: the requester reads their own
  cases while an active member of the tenant; no client writes.
- `core.kyb_submissions` — RLS_REQUIRED: active members of the organisation
  read its submissions; no client writes.
- Both decided once (trigger), never deleted. Notification kinds
  `HUMAN_REVIEW`, `VERIFICATION_DECIDED` added.

## 4. Routes

Person: `POST/GET /v1/reviews`, `GET/POST /v1/kyb` (Idempotency-Key on
POST). Console: `GET /v1/admin/reviews`, `POST /v1/admin/reviews/:id/decision`,
`GET /v1/admin/kyb/:id/document`; the verification queue rows carry their KYB
details and the existing decision route closes the submission.

## 5. Tests

pgTAP 610 (positive, cross-tenant negative, revoked member, no client
writes, decided-once); schema guard rows; unit + integration for services;
route tests incl. RBAC negatives for the new console routes; q-tools
registry/harness for the new tool.
