# Q Approval Engine and Consequential Action Authority (`@capital-q/q-actions`, CQ-Q-008)

**Purpose.** The deterministic authority path for anything Q wants to do to
the world: `Prepare → Approve → Execute`. Q prepares an exact proposal, a
human with live authority approves that exact proposal, and Capital Q
executes it once through an idempotent gate that re-verifies everything
before the side effect. Nothing here sends an email, books a meeting or
calls a connector: the production registry holds no action definition, and
the only executor that exists is the test-only `test.confirm_required`.

```
proposal ≠ approval ≠ execution
approval = exact-payload binding + live human authority   (never a checkpoint, a message, a tool result, a voice)
executed = the persisted status after the gate            (never the model's word, never the executor's)
modality ≠ authority                                       (typing "approve" is not approving)
```

Sources: doc 12 §31 (actions and approval), §30 (action classes); doc 15
§49 (excessive agency), §53-54 (action authority, idempotency); doc 22
§79-82 (proposal, approval, hash, API), §207; doc 16 rows TM-Q-03..09,
TM-AUD-01/02, RT-05 (approval swap); Locked PADL (human commercial
authority, Capital Q integrity authority, "a model never gains authority
because it generated the action").

## Vocabulary

| Term           | Meaning                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Action         | A persisted proposal (`q_runtime.actions`): type, version, class, targets, exact payload, its fingerprint, and a status                                                  |
| Approval       | A persisted request for one person's decision about one action (`q_runtime.approvals`): who was asked, until when, what they decided and when                            |
| Definition     | A source-controlled `QActionDefinition`: Zod payload and result, targets, plain-English description, `authorize`, and the executor. Only `CONFIRM_REQUIRED` may register |
| Binding        | The envelope the approval hashes: binding version, tenant, organisation, run, action id, type, version, class, targets, payload. Nothing volatile                        |
| Execution gate | `executeApproved`: the only path to an executor; atomic claim, side effect outside the transaction, finalise with the persisted truth                                    |

## Action state machine (`Q_ACTION_TRANSITIONS`)

```
PROPOSED ──► AWAITING_APPROVAL ──► APPROVED ──► EXECUTING ──► EXECUTED
    │              │  │  │             │  │          │  └────► RECONCILIATION_REQUIRED
    │              │  │  └► REJECTED   │  └► EXPIRED └──────► FAILED ──► EXECUTING (if retryPermitted)
    │              │  └───► EXPIRED    └────► WITHDRAWN                    └──────► EXPIRED | WITHDRAWN
    └► WITHDRAWN   └──────► WITHDRAWN
       EXPIRED
```

Terminal: `EXECUTED`, `RECONCILIATION_REQUIRED`, `REJECTED`, `EXPIRED`,
`WITHDRAWN`. `FAILED` is retryable only when the executor said so and the
attempt budget (`maxExecutionAttempts`, default 3) is not spent; a retry
re-claims from `FAILED` with the previous failure cleared. Nothing moves
backwards and nothing skips `EXECUTING`; the database check constraints
(`executed_at ⇔ EXECUTED`, `failure_code ⇔ FAILED|RECONCILIATION_REQUIRED`)
refuse what the code would not.

## Approval state machine (`Q_APPROVAL_TRANSITIONS`)

`PENDING → APPROVED | REJECTED | EXPIRED | REVOKED`, decided exactly once.
A decision by a person who already made that same decision is the same
decision (`decided: false`, no second audit row, no second resume); any
other decision after the first is "already decided". One `PENDING`
approval per action is a partial unique index.

## Exact-payload binding and the hash

`hashBindingEnvelope(envelope)` = `sha256:` + SHA-256 over
`canonicalJsonStringify(envelope)` (`@capital-q/contracts` canonical JSON:
sorted keys at every level, arrays in order, `undefined` dropped, no
NaN/Infinity/bigint/Date/function). `QActionBindingEnvelopeSchema` is
strict, so a timestamp, a trace id or a request id can never enter the
binding. The hash is computed at proposal (`proposed_payload_hash`),
recorded on the approval at decision (`approval_payload_hash`, after
recomputing from the persisted row and comparing), and recomputed again at
execution against both. Recipient, body, attachments, targets, action
version, class, organisation, tenant or run changed ⇒ different hash ⇒ the
approval no longer applies (`PAYLOAD_HASH_MISMATCH`, security event
`q_action_payload_mismatch` HIGH, audit `q.action.execution_blocked`
DENIED). The hash never contains the payload, never reaches the public API,
an event, a log line or an error message. `hashesMatch` is constant-time.

## Who may decide, and when

- **Server-derived approver.** The route takes the actor from the verified
  session; the request body has no approver, tenant, role or hash field.
- **The requested person, in the right context.** Only
  `requested_from_user_id`, acting for the action's organisation, in the
  action's tenant, may read or decide. A colleague, the same person in
  another organisation context, a personal context and another tenant all
  receive one answer: "We couldn't find that approval." (404), with a
  `permission_denied` security event (`not_requested_approver`,
  `wrong_organisation_context`, `foreign_tenant`, `non_human_actor`).
- **Live authority.** Approving requires `q.action.approve` at
  ORGANISATION scope (granted to `organisation_admin` and
  `organisation_member` by migration) and the definition's own
  `authorize(payload, actor)`. Both are evaluated at proposal, at approval
  and again at execution. A membership revoked between approval and
  execution blocks execution (`AUTHORITY_REVOKED:*`); the approval row
  stays APPROVED, nothing runs, audit records DENIED.
- **Approval creates no permission.** A payload the person may not act on
  is refused at proposal; there is nothing an approval could legitimise.

## Expiry

`requested_at + approvalTtlMs` (default 24h) is stored as `expires_at`.
Expiry is a comparison against the injected `QActionClock` at read, at
decision and at execution: an open request read after expiry shows
`EXPIRED`/`canDecide:false`; an approve after expiry commits `EXPIRED` on
the approval and the action and then answers 410 `Q_ACTION_EXPIRED`
("This approval has expired. Ask Q to prepare the action again."); an
approved-but-not-executed action past expiry is marked `EXPIRED` at the
gate and never executed. No sweeper is required; one may later be added
for tidiness, never for correctness.

## Idempotency and the execution gate

Every action carries `idempotency_key = q_action:<run_id>:<action_id>`
(unique). The gate:

```
load action (run must match) ─► status switch (EXECUTED → ALREADY_EXECUTED; EXECUTING → IN_PROGRESS;
   non-retryable FAILED → FAILED; not APPROVED → NOT_APPROVED)
─► find the APPROVED approval, still usable (else action EXPIRED, NOT_APPROVED)
─► definition present, same version (else BLOCKED DEFINITION_UNAVAILABLE)
─► actor is the approver, same tenant and organisation; reauthorize (else BLOCKED AUTHORITY_REVOKED)
─► recompute hash vs proposed and approved (else BLOCKED PAYLOAD_HASH_MISMATCH)
─► attempts < max (else FAILED EXECUTION_ATTEMPTS_EXHAUSTED)
─► CLAIM  one short transaction: lock row, status APPROVED or retryable FAILED, → EXECUTING, attempts+1
─► EXECUTE outside any transaction, with the ApprovedQAction (idempotency key included for the adapter)
─► FINALISE one short transaction: EXECUTED (result validated by the definition) | FAILED (retryable or not)
   | RECONCILIATION_REQUIRED (UNKNOWN or the executor threw: never resent)
```

Two workers, a retried request or a replayed resume: one claims, the other
sees `IN_PROGRESS` or `ALREADY_EXECUTED`, and the side effect happens once
(proven with a held executor and two concurrent calls against real
Postgres). An executor that throws is an unknown outcome, not a retry: the
message class is logged, never its text.

## The run and LangGraph

`q-orchestrator-v5` adds `action_prepare` and `approval_gate` after the
answer seam. `QActionPort.prepare` (implemented by `createQActionPort`, fed
by a `QActionProposer`; production's proposer proposes nothing) persists
the action and the approval and moves the run to `AWAITING_APPROVAL` with
visible stage `WAITING_FOR_APPROVAL` and run events `q.action.proposed`
(public proposal, no hash) and `q.approval.required` (`approvalId`), all in
one transaction. The graph then `interrupt()`s. The checkpoint holds the
action id and nothing else about it: no payload, no hash, no decision.
`POST …/approve` records the decision and only then resumes the run
(`AWAITING_APPROVAL → ACTION_EXECUTION`, stage
`COMPLETING_APPROVED_ACTION`); the resumed node calls `executeApproved`,
which re-verifies against the database, never against the checkpoint.
Resuming an undecided run executes nothing (the gate answers
`NOT_APPROVED`) — only the approve route resumes a waiting run today. A
rejection completes the run in the same transaction as the decision and a
resume is refused as terminal. Expiry at the gate fails the run with the
public `APPROVAL_EXPIRED`; a blocked execution with `POLICY_DENIED`; a
failed or unknown execution with `TOOL_FAILED`.

## Audit versus events

| Record                                                                                      | What it says                                                                   |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `audit.material_actions` `q.action.proposed`                                                | actor Q (id = run), authority = the requesting person; ids and hash            |
| `q.action.approved` / `q.action.rejected`                                                   | actor human; approval id, action id, hash                                      |
| `q.action.executed` / `execution_failed` / `execution_blocked`                              | actor Q under the approver's authority; outcome SUCCEEDED/FAILED/DENIED        |
| `audit.security_events`                                                                     | `permission_denied`, `q_action_payload_mismatch`, `q_action_execution_blocked` |
| outbox `q.action.prepared/approved/rejected/executed/execution_failed` v1                   | ids, type, version, class, status, failure code; CONFIDENTIAL, replay-safe     |
| run events `q.action.proposed`, `q.approval.required`, `q.stage.changed`, `q.run.completed` | what the person's stream shows                                                 |

No record carries the payload, the preview, a reason text, a hash in an
event, or any executor error text. The audit trail alone reconstructs
"Q proposed → this person authorised → Q executed under that authority".

## Public API (`apps/q-api`)

| Route                                      | Behaviour                                                                                    |
| ------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `GET /v1/q/approvals/:approvalId`          | 200 `QApprovalView` for the requested approver only; `no-store`; 404 for everyone else       |
| `POST /v1/q/approvals/:approvalId/approve` | body `{}` exactly (422 otherwise); 200 view; resumes the run once after the decision commits |
| `POST /v1/q/approvals/:approvalId/reject`  | body `{ reason?: ≤500 }`; 200 view; run completed                                            |

`QApprovalView`: `approvalId`, `runId`, `status`, `requestedAt`,
`expiresAt`, `decidedAt?`, `canDecide`, and the action as the approver may
see it (`actionId`, type, version, class, `actionStatus`, targets,
summary, preview, `executedAt?`). No hash, no internal code, no tenant, no
approver id. Errors: 404 `RESOURCE_NOT_FOUND`, 403 `PERMISSION_DENIED`,
410 `Q_ACTION_EXPIRED`, 409 `RESOURCE_CONFLICT` (already decided, changed,
unavailable), each with one plain sentence. Doc 22 §80's
`expectedPayloadHash` field is deliberately not accepted: the server owns
the fingerprint and the client addresses the approval by id.

## Plain-English policy

Every message a person can read is on the domain error class:
"We couldn't find that approval.", "You can't approve this action.",
"This approval has expired. Ask Q to prepare the action again.",
"This action has already been approved/declined.", "This action changed
and needs to be reviewed again.", "Q can't perform that kind of action."
Internal codes (`errorCode`) go to logs, spans and metrics only. The field
is named `errorCode`, not `code`, because the transaction manager treats a
thrown object carrying `code` as a driver failure.

## Schema (`q_runtime`, migration `20260908090000`)

Both tables `INTERNAL_SERVER_ONLY` (RLS on, no policies, no client grants;
`rls/130_schema_guard` inventory, `rls/330_q_actions` 31 assertions).

| Table       | Notes                                                                                                                                                                                                                                                                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `actions`   | tenant, run, organisation, proposer; `action_type` dotted, `action_version`, `risk_class` (5 classes, never PROHIBITED); `target_refs` 1..20; `proposed_payload` ≤ 64 KiB + `proposed_payload_hash`; summary ≤ 1000, preview ≤ 4000; 10 statuses; unique idempotency key; result ≤ 16 KiB; failure code, retry permitted, attempts, version |
| `approvals` | tenant, action, `requested_from_user_id`; 5 statuses with evidence constraints (who/when per decision); `expires_at > requested_at`; `approval_payload_hash`; one PENDING per action; version                                                                                                                                               |

No credential, token, provider, prompt or reasoning column exists.

## Testing seam

`@capital-q/q-actions/testing` exports `test.confirm_required`: payload
`{ companyId, note, recipientUserId?, behaviour }` with behaviours
`SUCCEED | FAIL_RETRYABLE | FAIL_PERMANENT | UNKNOWN | THROW`, a note
beginning `FORBIDDEN` denied by `authorize`, an in-memory executor with
`executions()`, `executedActionIds()` and `holdNext()` for concurrency
tests. It is never registered in `apps/q-api/src/main.ts`.

## Future external actions (not built)

A Gmail send, a calendar booking, a Data Room share or an MCP call becomes
a `QActionDefinition` whose executor calls a provider adapter with the
action's idempotency key, reports `EXECUTED | FAILED(retryable?) |
UNKNOWN`, and gains no authority the gate does not check. A voice
"approve" is a transcript, not a decision: the same route with the same
session is the only decision.

## Deferrals (explicit)

No production action definition; no PREPARE_ONLY tool proposing actions
(`noQActionProposer`); no delegation/standing approvals; no admin
withdraw; no expiry sweeper; no approvals list or SSE surfacing
(`q.approval.required` is in the run event log for CQ-Q-009); no
`expectedPayloadHash` request field (doc 22 §80 divergence, recorded); no
worker-driven resume of `AWAITING_APPROVAL` runs — such a worker must
check the decision before resuming.

## Tests

- `canonical-json.test` (5), `binding.test` (5), `lifecycle-registry.test` (6): pure.
- `approval-engine.integration.test` (10, real Postgres): the required
  deterministic demo (propose → view → approve → execute once → retry no-op,
  audit and outbox reconstruct authority), the RT-05 mutation demo,
  targets/version invalidation, authorization (colleague, other context,
  other tenant, revoked membership, no permission from approval), state
  machine and expiry, concurrency (approve vs reject, double approve,
  double execute with a held executor), failure semantics (retryable,
  permanent, unknown, thrown), model/tool/hash/type injection, privacy
  markers.
- `approval-flow.integration.test` (4, real Postgres + LangGraph): pause,
  approve, resume, execute once; rejection; undecided resume executes
  nothing; two processes resume once.
- `q-approvals.test` (32, HTTP boundary): body strictness, actor from
  session, single resume, error mapping, no internal leak.
- pgTAP `rls/330_q_actions` (31) and the schema guard.
