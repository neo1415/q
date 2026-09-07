# Q contracts (`@capital-q/contracts/q`, CQ-Q-001)

**Purpose.** The stable, typed, provider-neutral and framework-neutral language
through which Capital Q — web now, mobile and GateQ later, partners after that —
talks to Q, and through which Q answers. This packet defines that language and
nothing else: no model is called, no graph runs, no retrieval occurs, no tool
executes, no action executes, no table exists.

**What Q is.** One institutional investment analyst the user experiences as a
single Q, which internally orchestrates specialists that are never named,
selectable or visible.

**What Q is not.** Not the database, not the source of canonical company truth,
not a generic chatbot, not LangGraph, not a model provider, not the tool
registry, not the memory store. The contract surface encodes this: nothing in it
names a graph node, a checkpoint, a provider thread, a model, a prompt, a
specialist, a scratchpad or a chain of thought, and nothing may be added that
does.

**Invariant.**

```
Available knowledge ≠ authorised reasoning context
Q knows ≠ user may know ≠ user may share ≠ Q may execute
Model output ≠ authoritative application state
Model-generated confidence ≠ permission
Run status ≠ visible stage ≠ relationship state
Claim ≠ Evidence ≠ Verification
Tool proposal ≠ tool execution
Action proposal ≠ approval ≠ execution result
Q stream event ≠ domain event ≠ audit event ≠ analytics event
Unknown ≠ negative
```

## Ownership and layout

Q contracts live in `packages/contracts/src/q/` — the location doc 22 §4 names —
and are exported both from the package root (`@capital-q/contracts`, the
repository's established consumer style) and from the `@capital-q/contracts/q`
subpath. There is no `packages/q-contracts`: the repository centralises every
versioned inter-component contract in one package, and Q is not an exception.
Every schema is Zod with the TypeScript type inferred from it, so the two cannot
drift. Every trust-boundary object is `.strict()`: an unknown field fails
validation rather than being silently dropped.

`Q_CONTRACT_VERSION = 1` is stamped on the three shapes that outlive a request
(`QRequestEnvelope`, `QStreamEvent`, `QActionProposal`). Evolution is additive;
external HTTP versioning stays at `/v1`.

Q-owned identifiers (`QRunId`, `QConversationId`, `QMessageId`, `QFindingId`,
`QActionProposalId`, `QApprovalId`, `QToolCallId`, `QStreamEventId`) use the
shared branded-UUID convention. Domain identifiers are never redeclared: as with
every DTO in this package they cross the wire as plain UUIDs under typed field
names, because the branded `CompanyId`, `EvidenceItemId`, `TenantId` and so on
belong to packages that depend on this one.

## Two trust zones

Every type is labelled PUBLIC or INTERNAL, and no type serves both.

| PUBLIC (may reach a client)                                                                                | INTERNAL (runtime only)                   |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `CreateQRunRequest`, `AppendQRunMessageRequest`                                                            | `QRequestContext`, `QRequestEnvelope`     |
| `QRunHandle`, `QRunSummary`                                                                                | —                                         |
| `QPublicFinding`                                                                                           | `QInternalFinding` (+ sensitivity, scope) |
| `QPublicFailure`                                                                                           | `QRunFailure` (+ diagnostic code, detail) |
| `QToolProgress` (no tool name)                                                                             | `QToolCallRecord`                         |
| `QStreamEvent`, `QResultBlock`, `QMessage`, `QEvidenceRef`, `QUiIntent`, `QActionProposal`, `QApprovalRef` | —                                         |

Public schemas are allowlists. A response is produced by parsing into one; no
internal object is ever `JSON.stringify`'d to a client.

## Request and context

`CreateQRunRequest` is what a client sends: capability, optional objective, a
bounded message (`Q_MESSAGE_TEXT_MAX_LENGTH` = 8000), typed subjects, a client
modality (`TEXT` | `VOICE`), locale and an optional conversation to continue.
It has no field for actor, tenant, organisation, roles, capabilities,
consequence class, knowledge scopes, system prompt, provider, model, tool list,
tool results or approval — and every such field fails validation. The test
`q-request.test.ts` enumerates twenty-eight of them.

`QRequestContext` is what the server resolves: request and correlation ids,
source application, an actor mirrored field-for-field from
`@capital-q/security`'s `ActorContext` (still no roles or capabilities), the
tenant, the purpose (objective, capability, **server-decided** consequence
class), subjects, interaction, and `requestedKnowledgeScopes` in the ADR-001
disclosure vocabulary. Requested means requested. An organisation context
without the membership that granted it is rejected.

`QRequestEnvelope` = context + input + optional `continuesRunId`. Internal only.

`QCapability` is the six outcomes doc 12 §7.1 names — `ANSWER`, `INVESTIGATE`,
`COMPARE`, `ASSESS`, `CLASSIFY`, `PREPARE_ACTION`. There is no agent-shaped
capability.

`QSubjectRef` is a discriminated union with a distinct identifier field per
kind: `COMPANY`, `INVESTOR_ORGANISATION`, `RELATIONSHIP`, `CAPITAL_OBJECTIVE`,
`DOCUMENT`, `USER`, `ORGANISATION`. No `{ type, id }`; no meeting until a
Meeting context exists.

## Run status vs visible stage

`QRunStatus` is the deterministic machine lifecycle from doc 12 §9.1 plus
`AWAITING_INPUT` (doc 22 §77) and `CANCEL_REQUESTED` (doc 22 §78); terminal
states are `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`
(`isTerminalQRunStatus`).

`QVisibleStage` is the ten-member approved progress vocabulary a person may see,
with plain-English labels in `Q_VISIBLE_STAGE_LABELS` ("Understanding your
request", "Checking evidence", "Waiting for your approval", …). The two
vocabularies are disjoint by test: no internal state parses as a stage, no stage
parses as a status, and there is no free-text stage a model could fill.

`QRunHandle` (run id, status, created time) is what accepting work returns.
`QRunSummary` is the read-back projection: identity, capability, status, stage,
subjects, result blocks so far, public failure only when `FAILED`, timestamps.

## Structured results

`QResultBlock` is a closed union: `TEXT` (plain text only — no HTML, no Markdown
contract, script-looking text is text), `COMPANY_REFERENCE`,
`INVESTOR_REFERENCE`, `COMPARISON` (2–6 subjects, one value per subject per
row), `EVIDENCE`, `FINDING`, `UNCERTAINTY` (uncertain confidence levels only),
`CLARIFICATION_REQUEST`, `ACTION_PROPOSAL`, `UI_INTENT`. Blocks carry
references, never embedded domain objects. `QMessage` is `USER` or `Q` — never a
provider's `assistant`/`developer`/`tool` roles — and a Q message carries text,
blocks or both.

`QConfidenceLevel` is `HIGH`, `MODERATE`, `LOW`, `INSUFFICIENT_EVIDENCE`,
`CONFLICTING_EVIDENCE` (doc 12 §21). No number. A finding keeps truth class,
evidence status, lifecycle status and confidence as four fields.

`QEvidenceRef` points at an `EVIDENCE_ITEM`, `CLAIM`, `DOCUMENT` (optionally a
version and a page) or `SOURCE`. It never carries text, an excerpt, a title, a
filename, a URL, a storage key or metadata. A reference existing in a run is
not permission to show it; which references survive into a public projection is
the Context Firewall's decision, which is why no field-stripping helper exists
here.

`QUiIntent` is `OPEN_COMPANY`, `SHOW_COMPARISON`, `FOCUS_SECTION` (known
sections only) or `SHOW_EVIDENCE`, each with identifier or enum parameters. No
URL, no script, no HTML, no API call.

## Actions, approvals, tools

`QActionProposal` is a prepared action: type (dotted name), class (doc 12 §30),
typed targets, plain summary, bounded preview, an approval requirement, and its
own status (`PROPOSED` | `WITHDRAWN` | `EXPIRED`). `CONFIRM_REQUIRED` and
`RESTRICTED` must declare approval required; `PROHIBITED` is never proposable.
`QApprovalRef` is the minimum pointer (`approvalId`, `PENDING` | `APPROVED` |
`REJECTED` | `EXPIRED` | `REVOKED`). There is no `approved: true`, no
`executed`, no payload and no payload hash on the proposal — those are
CQ-Q-008's.

Tool contracts are shapes only: `QToolName`, `QToolClassification`
(`READ_ONLY` | `ANALYTICAL` | `PREPARE` | `SIDE_EFFECT`), `QToolCallStatus`,
an internal `QToolCallRecord` and a public `QToolProgress` that withholds the
tool name. Neither carries arguments or results; per-tool Zod schemas are
CQ-Q-007's, and no client can submit a "tool result".

## Stream events

`QStreamEvent` is a closed union on `type`: `q.run.started`, `q.stage.changed`,
`q.message.delta`, `q.message.completed`, `q.finding.available`,
`q.action.proposed`, `q.approval.required`, `q.input.required`,
`q.run.completed`, `q.run.failed`. Every event carries `contractVersion`,
`eventId`, `runId`, a per-run monotonic `sequence` starting at 1, and
`occurredAt`; the sequence is what CQ-Q-009 will persist and replay from on
`Last-Event-ID`. Deltas are bounded (4000 chars) and ephemeral; `q.run.failed`
carries only the public failure. There is no chain-of-thought, reasoning,
specialist or node event, and these are not domain events: they are never
registered in the event registry or written to the outbox.

## Public-safe failures

`QRunFailure` (internal) holds a stable diagnostic code from
`Q_FAILURE_DIAGNOSTIC_CODES`, optional private detail and the provider error
kind. `QPublicFailure` holds a public code, a fixed plain-English sentence from
`Q_PUBLIC_FAILURE_MESSAGES`, `retryable`, and optional run/request ids.
`toPublicQFailure` is the only producer; it reads the diagnostic code and
nothing else (a Proxy test proves it), and `SUBJECT_NOT_RESOLVED`,
`CONTEXT_RESOLUTION_FAILED` and `POLICY_DENIED` all collapse to the same
`NOT_AVAILABLE_IN_CONTEXT` wording so a failure cannot enumerate restricted
objects. The marker `PRIVATE-Q-DIAGNOSTIC-DO-NOT-EMIT`, stack text, SQLSTATE,
provider JSON, Zod issues, connection strings and private filenames are proven
not to reach a serialised public failure.

## Security boundaries

- Actor and tenant exist only on the internal context; the public request
  cannot express them, and cannot grant itself consequence class, scopes,
  roles or approval.
- Subjects and evidence are typed references — no dynamic table semantics.
- UI intents cannot execute code or open arbitrary destinations.
- Tool and action envelopes carry no untyped payload.
- Public findings, failures and tool progress are separate types from their
  internal counterparts; sensitivity and visibility scope never leave the
  runtime.
- Public schemas are strict; every leak test injects a private marker and
  proves the schema rejects it or the projector omits it.

## Explicit CQ-Q-001 deferrals

- Run persistence (`q_runtime.*`), `POST /v1/q/runs` and run lifecycle
  → CQ-Q-002 (delivered; see "Q runtime" below).
- LangGraph orchestration and checkpoints → CQ-Q-003.
- Context Firewall: permission filtering, founder/investor-private handling,
  combination risk, derived sensitivity, projection of internal findings and
  evidence refs to public → CQ-Q-004.
- Model Gateway and any provider SDK or credential → CQ-Q-005.
- Prompt Registry → CQ-Q-006. Tool Registry and per-tool schemas → CQ-Q-007.
- Approval persistence, payload hash, approve/reject, execution → CQ-Q-008.
- SSE endpoint, heartbeat, replay → CQ-Q-009. Eval harness → CQ-Q-010.
- Retrieval and embeddings → CQ-RAG. Q Knowledge persistence → CQ-KNW.
- Specialist intelligence → CQ-Q-020+. Voice sessions, meeting subjects,
  public tool-progress events, an event-stream URL on the run handle: additive
  later.

## Next integration point (after CQ-Q-001)

Delivered by CQ-Q-002 below: `POST /v1/q/runs` is mounted in `apps/q-api`
behind the actor-context hook, the run is persisted and `QRunHandle` returned.
The contract gained two additive fields for it: `conversationId` on the
handle and `messages` on the summary.

# Q runtime (`@capital-q/q-runtime`, CQ-Q-002)

## Purpose

The durable spine of a Q interaction: the conversation that contains it, the
messages exchanged in it, the run that does the work, and the append-only
events the run emits. After this packet Q **persists**; it does not reason.
No model, graph, retrieval, tool, approval or stream exists. A process
restart loses nothing.

```
Q conversation ≠ Q institutional memory     Q run       ≠ Q Knowledge Object
Q message      ≠ canonical company truth    Q run event ≠ domain event ≠ audit
run accepted   ≠ analysis completed         message persisted ≠ message understood
```

## Schema (`q_runtime`, migration `20260906120000`)

Doc 13 §34/§47, one canonical message store, all tables
`INTERNAL_SERVER_ONLY` (RLS on, no policies, no client grants; guarded by
`rls/130_schema_guard` and `rls/300_q_runtime`).

| Table                       | Notes                                                                                                                                                                                                                                                                 |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `conversations`             | owner `user_id`; `organisation_id` is acting context, not visibility; `context_type` PERSONAL/ORGANISATION agrees with it by check; bounded `subject_refs` jsonb                                                                                                      |
| `runs`                      | `status` = `QRunStatus` exactly; server-derived `consequence_class`; `orchestration/prompt_bundle/model_policy_version` **NULL** until those systems exist; `started_at` NULL until orchestration begins; `completed_at` ⇔ terminal; `version`; `last_event_sequence` |
| `conversation_messages`     | roles USER/Q only; plain text bounded 8000 (USER) / 32000 (Q); `content_type` TEXT; `provider_message_ref` reserved NULL; `run_id NOT NULL` (the contract requires `runId`)                                                                                           |
| `run_events`                | `event_type` = `QStreamEventType`; `visible_stage` = `QVisibleStage`; payload ≤ 16 KiB; `UNIQUE (run_id, sequence)`; **append-only by trigger**                                                                                                                       |
| `run_creation_requests`     | idempotency, hashes only, `(user, key hash)`                                                                                                                                                                                                                          |
| `message_creation_requests` | idempotency, hashes only, `(user, run, key hash)`                                                                                                                                                                                                                     |
| `actions` (CQ-Q-008)        | migration `20260908090000`; exact proposed payload + `sha256` binding hash, 10-status action lifecycle, unique idempotency key; `rls/330_q_actions`                                                                                                                   |
| `approvals` (CQ-Q-008)      | migration `20260908090000`; one PENDING per action, decision evidence per status, `expires_at`, `approval_payload_hash`; `rls/330_q_actions`                                                                                                                          |

Refinements over doc 13, stated: `tenant_id` on messages and events (every
tenant-owned table carries tenant ownership; composite FKs give a tenant-safe
path), `run_id NOT NULL` on messages, `version`/`last_event_sequence`/
`created_at` on runs, the two idempotency tables. No chain-of-thought,
prompt, provider-payload or model column exists anywhere.

## Ownership and privacy

A conversation and its runs are readable by exactly one person: the owner,
in the tenant that holds them. Every repository read carries **tenant +
owner**; there is no `findById(id)`. A colleague in the same organisation
receives the same 404 as a stranger in another tenant and as a nonexistent
id; the refusal is recorded as a `permission_denied` security event with
identifiers only. Organisation-shared Q is a deliberate later feature, never
a side effect of `organisation_id`.

Continuing a conversation requires the same owner, tenant and organisation
context; a conversation's `subject_refs` are never rewritten by a later run.

## Subjects

A `QSubjectRef` is a selection, never authority. Each kind resolves through
the owning context's public query port inside the actor's tenant
(COMPANY, INVESTOR_ORGANISATION, ORGANISATION, USER = self,
CAPITAL_OBJECTIVE, DOCUMENT, RELATIONSHIP); absent, foreign and unsupported
all fail closed before anything is written. This is **not** the Context
Firewall: cross-tenant subjects an investor may legitimately ask about
arrive with CQ-Q-004.

## Run lifecycle

`Q_RUN_TRANSITIONS` in `domain/lifecycle.ts` is the single map. Initial
status `RECEIVED`; terminal states have no outgoing edge; no route or
repository sets a status directly — `runs.transition` applies one move under
the version that was read. Consequence class is derived from capability
(ANSWER/CLASSIFY → LOW, INVESTIGATE/COMPARE/ASSESS → MODERATE,
PREPARE_ACTION → HIGH) and never accepted from a client.

Cancellation (`decideCancellation`): nothing in flight (`RECEIVED`,
`AWAITING_INPUT`, `AWAITING_APPROVAL`) → `CANCELLED` now, `completed_at`
set, `failure_code = RUN_CANCELLED`, one `q.run.failed` event carrying the
public "cancelled" projection; work in flight → `CANCEL_REQUESTED` (the
orchestrator finishes it in CQ-Q-003); already cancelling → idempotent
no-op, no duplicate event; otherwise terminal → conflict "This request has
already finished." Messages are accepted only into a live run that is not
being cancelled; a person continues a finished conversation with a new run.

## Events and sequencing

`appendRunEvent` allocates the next sequence with
`UPDATE runs SET last_event_sequence = last_event_sequence + 1 … RETURNING`
(the row lock serialises concurrent writers), assembles a complete
`QStreamEvent`, parses it against the contract, then inserts. The store can
never hold a payload the stream could not replay, and events carry
`messageId`s, never message text. `listForRun(afterSequence)` is the replay
cursor CQ-Q-009 will use. **SSE is not implemented.**

## Idempotency

Same person + same key + same canonical payload → the run/message already
created (202 / 200); same key + different payload → `IDEMPOTENCY_CONFLICT`.
Hash-only records written inside the creating transaction under a
`pg_advisory_xact_lock`, so two concurrent identical requests produce one
row.

## API (`apps/q-api`)

| Route                                        | Result                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `POST /v1/q/runs`                            | 202 `QRunHandle` (`RECEIVED`); `Idempotency-Key` required; `Location` set |
| `GET /v1/q/runs/:runId`                      | 200 `QRunSummary` incl. `messages`; 404 for anyone but the owner          |
| `POST /v1/q/runs/:runId/messages`            | 201 (200 on replay) `{ message }`; stored, not answered                   |
| `POST /v1/q/runs/:runId/cancel`              | 200 `QRunSummary`; idempotent                                             |
| `GET /v1/q/approvals/:approvalId` (CQ-Q-008) | 200 `QApprovalView` for the requested approver; 404 for everyone else     |
| `POST /v1/q/approvals/:approvalId/approve`   | body `{}` exactly; 200 view; resumes the run once after the decision      |
| `POST /v1/q/approvals/:approvalId/reject`    | body `{ reason?: ≤500 }`; 200 view                                        |

| `GET /v1/q/runs/:runId/events` (CQ-Q-009) | 200 `text/event-stream`; owner only; `Last-Event-ID` replay; see `docs/modules/q-stream.md` |

Not exposed: any tool, model or retrieval route. q-api now composes the request-class
database client, the Postgres actor-context resolver, the domain query
ports for subjects and the runtime service; it holds no SQL and no rule.
`DATABASE_URL` (already in `.env.example`) is now read by q-api.

## Errors

Runtime errors map in q-api's problem handler: not-found family →
`RESOURCE_NOT_FOUND` ("I couldn't find that Q request."), terminal /
not-accepting / transition / archived → `RESOURCE_CONFLICT`, idempotency →
`IDEMPOTENCY_CONFLICT`, stale version → `VERSION_CONFLICT`, unsupported
subject kind → `INVALID_REQUEST`. Details are the runtime's plain sentences;
none names a tenant, person, table or status word.

## Observability and privacy

Logs carry `qRunId`, conversation/message ids, capability, status and
correlation id — never message text. The privacy marker
`PRIVATE-Q-RUN-CONTENT-DO-NOT-EMIT` is persisted as real message content
and proven absent from log lines, run-event payloads, `audit.security_events`
/ `audit.material_actions` rows, every problem response, and the run
projection minus its messages. Only the owner's message read returns it.

## Explicit CQ-Q-002 deferrals

Orchestration and `started_at` → CQ-Q-003 · Context Firewall and
cross-tenant subjects → CQ-Q-004 · model gateway → CQ-Q-005 · prompt
registry → CQ-Q-006 · tools → CQ-Q-007 · approvals → CQ-Q-008 · resumable
SSE over `run_events` → CQ-Q-009 · evals → CQ-Q-010 · retrieval → CQ-RAG ·
Q Knowledge → CQ-KNW · Q response messages/blocks persistence (needs an
orchestrator to produce them) → CQ-Q-003.

## Next integration point (after CQ-Q-002)

Delivered by CQ-Q-003 below: `RECEIVED` runs are picked up through the
orchestration runtime (`begin` = `RECEIVED → PREFLIGHT` with `started_at` and
the orchestration version), stages flow through `appendRunEvent`, and
`CANCEL_REQUESTED` is honoured at every node boundary.

# Q orchestration (`@capital-q/q-orchestrator`, CQ-Q-003)

## QOrchestrator and where LangGraph sits

`QOrchestrator` (`start`, `resume`, `cancel`) is declared in
`@capital-q/q-runtime` and names nothing framework-shaped. The Q API — and the
worker later — depend on it. `@capital-q/q-orchestrator` is the only package
that imports LangGraph; it implements the port, and its exports are factories
and Capital Q types (no graph, command, interrupt, checkpoint or node type).
`@langchain/core` is present only as LangGraph's required peer; no LangChain
abstraction is used.

```
Q ≠ LangGraph            LangGraph ≠ Capital Q public contract
Q run ≠ thread           graph checkpoint ≠ Q institutional memory
graph state ≠ Company ≠ Evidence ≠ Q Knowledge ≠ audit
```

Order of every operation, which is the security boundary:
authorise the actor against the canonical run (404-safe, security event on
refusal) → check canonical status and orchestration version → move the
canonical lifecycle → only then touch the engine.

## Version and initial graph

`Q_ORCHESTRATION_VERSION = "q-orchestrator-v1"` is stamped on
`runs.orchestration_version` when a run is picked up. `resume` continues only
versions in `Q_RESUMABLE_ORCHESTRATION_VERSIONS`; an unknown or missing
version is refused (`QOrchestrationVersionError`) before the lifecycle moves
or a checkpoint is read. A graph change that alters resume semantics gets a
new version; old suspended runs wait for a build that lists theirs. No
checkpoint migration engine exists.

```
START → preflight → context → pause → retrieve → answer → END
RECEIVED → PREFLIGHT → CONTEXT_RESOLUTION → POLICY_CHECK → PLANNING
        → [AWAITING_INPUT ⇄ PLANNING] → RETRIEVAL → SYNTHESIS → FAILED*
```

- **preflight** — deterministic checks only (run exists, executable, has a
  conversation, carries a version this build understands).
- **context** — assembles already-resolved refs; passes `POLICY_CHECK`
  through untouched. **Not** the Context Firewall: CQ-Q-004 fills that slot.
- **pause** — the only node that may `interrupt()`, and it does nothing else,
  so its replay on resume is free. Production `neverPause`s; an injected
  `QPausePolicy` proves durable pause/resume. Not an approval (CQ-Q-008).
- **retrieve** — `QRetrievalPort` seam; the only implementation returns
  `NOT_CONFIGURED`. No table, document, vector or knowledge is read.
- **answer** — `QAnswerPort` seam; the only implementation returns
  `NOT_CONFIGURED`. \*The run then ends **FAILED /
  `MODEL_PROVIDER_UNAVAILABLE`** (public `Q_UNAVAILABLE`, retryable). No text
  is produced anywhere; there is no fake answer and no `COMPLETED`.

Visible stages emitted: `UNDERSTANDING_REQUEST` at pick-up,
`PREPARING_ANALYSIS` at the answer seam. Nothing is emitted for the retrieval
seam because nothing is checked. Node names never leave `graph.ts`.

## Graph state = working state

`QGraphStateSchema` (strict): `runId`, `tenantId`, `actorUserId`,
`conversationId`, `capability`, `subjects` (typed refs), `orchestrationVersion`,
`correlationId`, and four coded outcomes (`preflight`, `context`, `retrieval`,
`answer`). No objective, no message text, no document, no token, no prompt, no
provider output, no reasoning. Nodes re-read the run (owner- and tenant-scoped)
for anything else. The integration suite decodes the stored checkpoint bytes
and asserts exactly this allowlist and the absence of the privacy marker.
Institutional knowledge lives in the governed `q_knowledge` architecture
(CQ-KNW); LangGraph Store is not used.

## Persistence

`PostgresSaver` in schema `q_runtime` (`checkpoints`, `checkpoint_blobs`,
`checkpoint_writes`, `checkpoint_migrations`), created by migration
`20260906150000` with the saver's exact DDL and its ledger pre-seeded; the
saver's `setup()` is never called in production. All four are
`INTERNAL_SERVER_ONLY` (schema guard + `rls/310_q_checkpoints`), never in
`public`. `thread_id = runId`, namespace `""`; knowing a thread id grants
nothing — no API accepts one. `MemorySaver` exists for unit tests only and is
**not acceptable as sole production persistence**. Restart is proven by
resuming with a second orchestrator over a second store.

## Resume, cancellation, replay, failure

- **resume**: owner + `AWAITING_INPUT` + resumable version →
  `AWAITING_INPUT → PLANNING` under the row lock (a concurrent second resume is
  refused, so the engine is driven once) → `Command({ resume })`.
- **cancel**: delegates to the Q-002 use case; the canonical status is the
  authority. A running engine sees `CANCEL_REQUESTED` at its next boundary and
  the adapter finishes `→ CANCELLED` with the terminal event; a suspended run is
  simply never resumed; a terminal run refuses `start`/`resume`.
- **replay**: every lifecycle move is idempotent (`UNCHANGED` when already
  there) and stage events dedupe on the latest stage, so a replayed node cannot
  duplicate a status change, an event or a message.
- **failure**: any engine/node error → `FAILED / INTERNAL_ERROR` (public
  `Q_FAILED`), diagnostics logged with identifiers only. No automatic retry:
  nothing here is a known-transient infrastructure failure yet, and no
  side-effecting seam exists to retry safely.
- **deadline**: `QOrchestrationInput.signal` propagates to the engine; the
  canonical lifecycle still ends the run.

## API wiring

`POST /v1/q/runs` hands a _created_ run to the orchestrator detached from the
request behind a composition boundary (`Q_ORCHESTRATION_AUTOSTART = true` in
`apps/q-api/src/main.ts`); the response is still `202 RECEIVED`, and the
outcome is read back through `GET`. A replayed retry never starts twice. No
resume, thread or checkpoint route exists.

## Observability and privacy

One span per invocation (`q.orchestration.start|resume`) with run id, version,
outcome and duration; log lines carry identifiers, statuses and stages only.
The marker `PRIVATE-Q-GRAPH-STATE-DO-NOT-EMIT` is written as message text and
objective and proven absent from checkpoint rows, run events, logs, the public
projection and failure payloads.

## Seams for the next packets

Context Firewall → `POLICY_CHECK` slot between `context` and `pause`
(CQ-Q-004). Model Gateway → `QAnswerPort` (CQ-Q-005). Retrieval →
`QRetrievalPort` (CQ-Q-004 / CQ-RAG). Specialists → bounded ports returning
structured findings to this one central orchestrator (CQ-Q-020+); none is
fabricated now. Approvals → `interrupt` with an application approval record
(CQ-Q-008).

## Explicit CQ-Q-003 deferrals

Context Firewall → CQ-Q-004 · model gateway and any LLM call → CQ-Q-005 ·
prompt registry → CQ-Q-006 · tools → CQ-Q-007 · approvals → CQ-Q-008 · SSE →
CQ-Q-009 · evals → CQ-Q-010 · RAG → CQ-RAG · Q Knowledge → CQ-KNW ·
specialists → CQ-Q-020+ · worker-hosted orchestration (the port is reusable;
nothing binds it to the HTTP process).

## Next integration point (after CQ-Q-003)

CQ-Q-004 adds the Context Firewall between `context` and `pause`: it owns the
`POLICY_CHECK` transition, produces the permitted context plan the
`QRetrievalPort` consumes, and may pause for clarification through the same
interrupt seam. `Q_ORCHESTRATION_VERSION` becomes `q-orchestrator-v2` if the
node set changes.

## Tests

`packages/contracts/test/q-request.test.ts` (request, context, envelope,
escalation fields, subject refs); `q-run.test.ts` (status, terminal helper,
stage separation and labels, handle, summary); `q-result-blocks.test.ts`
(every block kind, malformed unions, script-as-text, UI intents, evidence refs,
findings, confidence); `q-action.test.ts` (proposal ≠ approval ≠ execution,
action classes, tool envelopes, id brand separation); `q-stream.test.ts`
(every event, required ids, sequence, delta bound, public failure only,
exhaustive discrimination); `q-failure.test.ts` (projection table, private
marker, enumeration safety, plain wording); `q-surface.test.ts` (exports,
forbidden keys across a complete public run, marker rejection, enum
vocabularies, type-level exhaustiveness and subject typing).

# Context Firewall (`@capital-q/q-firewall`, CQ-Q-004)

## Purpose

The deterministic boundary between what the platform can access and what Q
may reason over for this actor, this active organisation, this purpose and
this subject set. It runs inside the orchestrator **before** any retrieval and
before any model is involved, and its output is the only thing the retrieval
and answer seams may act on. Requested scope ≠ permission; the model never
decides what it is allowed to see; deny by default; no `ALL_DATA`, wildcard
or admin bypass exists in the vocabulary.

```
Available knowledge ≠ authorised reasoning context
Checkpoint resume ≠ automatic reuse of an earlier permission
Same person ≠ same permission across organisations
```

## Inputs and outputs

Input (`ContextFirewallRequest`, `q-runtime`): the server-resolved
`ActorContext`, the run id, the correlation id, the requested capability, the
typed subject references from the run, and optionally the labels the caller
wants to narrow to. Nothing in it is trusted as authority: text, objectives,
purposes, roles, tenant or organisation ids arriving alongside are ignored
(`firewall.integration` "smuggled" test).

Output (`ContextFirewallDecision`): `AUTHORISED` with a
`PermittedContextPlan`, or `DENIED` with an INTERNAL reason and the denied
scopes. Reasons never reach a client: the orchestrator turns every denial
into `POLICY_DENIED`, which the public projection collapses with
`SUBJECT_NOT_RESOLVED` into `NOT_AVAILABLE_IN_CONTEXT`. An unshared subject
and a non-existent one are the same sentence.

## Policy order (deterministic pipeline)

1. Actor validation: parsed against `ActorContextSchema`; only `HUMAN`
   actors get context (`NON_HUMAN_ACTOR`).
2. Organisation context: any entity subject requires an active organisation
   (`ORGANISATION_CONTEXT_REQUIRED`).
3. Subject resolution, each on its own, through the owning contexts' typed
   ports via the Permissions resolver registry (`SUBJECT_UNRESOLVED`,
   `SUBJECT_KIND_UNSUPPORTED`, `RELATIONSHIP_SCOPE_MISMATCH`). Any failure
   denies the whole request: no partial plan.
4. Task class derived from capability + the actor's relation to the
   subjects (`OWN_COMPANY_QUESTION`, `COUNTERPARTY_COMPANY_QUESTION`,
   `INVESTOR_QUESTION`, `RELATIONSHIP_QUESTION`, `COMPARISON`,
   `ACTION_PREPARATION`, `GENERAL_QUESTION`). Never accepted from input.
5. Candidate scopes from the purpose table (`purpose.ts`): the most a task
   may need. Everything after only removes.
6. Batch disclosure evaluation (`DisclosureAccessService.evaluateMany`, one
   round trip) plus, for owner-side scopes, the capability check
   (`AuthorizationService.authorize` on the owning organisation's resource
   scope). Owner scopes need **both**; non-owner scopes need a disclosure
   path and are otherwise `OWNER_ONLY` / `DISCLOSURE_DENIED` /
   `DISCLOSURE_EXPIRED` / `DISCLOSURE_REVOKED`.
7. Sensitivity ceiling per task class (`SENSITIVITY_NOT_PERMITTED`);
   `RESTRICTED` never enters Q.
8. Combination-risk rules (`combination.ts`).
9. Requested-label narrowing (`SCOPE_NOT_REQUESTED`) — narrowing only.
10. Minimum context: an entity subject with no surviving scope is a denial
    (`NO_AUTHORISED_CONTEXT`), not a plan of actor-wide scopes.
11. Plan assembly with a content-free sha256 fingerprint.

## Context labels and sensitivity

Labels are the eight ADR-001 scopes (`MarketplaceVisibilitySchema`):
`personal_private`, `founder_private`, `investor_private`,
`organisation_private`, `relationship_shared`, `specifically_shared`,
`network_visible`, `public_external`. Sensitivity classes are the doc 15
baseline (`MessageSensitivitySchema`): `PUBLIC`, `NETWORK_VISIBLE`,
`INTERNAL`, `CONFIDENTIAL`, `HIGHLY_CONFIDENTIAL`, `RESTRICTED`.

The owner holds a scope under its intrinsic label (the class the data lives
in: a capital objective is `founder_private` for its own founder even when
same-organisation membership is the path that reaches it). A recipient holds
it under the label of the path that discloses it (`network_visible`,
`specifically_shared`, `relationship_shared`, `public_external`).

Derived sensitivity: a scope's class is the catalogue's owner or shared
class, and the plan's `maxSensitivity` is the strongest class present.
Downstream layers inherit; nothing derived may be weaker than its source.

## Knowledge scope catalogue (`catalogue.ts`)

| Kind                       | Intrinsic label      | Owner needs                     | Shared via disclosure resource |
| -------------------------- | -------------------- | ------------------------------- | ------------------------------ |
| COMPANY_PROFILE            | organisation_private | `company.view`                  | company                        |
| COMPANY_CAPITAL_OBJECTIVE  | founder_private      | `capital_objective.view`        | capital_objective              |
| COMPANY_PRIVATE_FINANCIALS | founder_private      | `company.financials.view`       | never (owner only)             |
| INVESTOR_PROFILE           | investor_private     | `investor.view`                 | investor_organisation          |
| INVESTOR_MANDATE           | investor_private     | `investor.mandate.view`         | never (owner only)             |
| RELATIONSHIP_CONTEXT       | relationship_shared  | exact party, own side's labels  | relationship                   |
| EVIDENCE_DOCUMENTS         | founder_private      | `document.view`                 | never (Data Room, later)       |
| OWN_Q_CONVERSATION         | personal_private     | the actor's own conversation    | —                              |
| NETWORK_VISIBLE_DATA       | network_visible      | any authenticated human context | —                              |
| PUBLIC_EXTERNAL_DATA       | public_external      | any                             | —                              |
| GENERAL_MODEL_KNOWLEDGE    | public_external      | any (never entity evidence)     | —                              |

No seeded role holds `company.financials.view`, so today the capability
layer denies financials even to the founder (`CAPABILITY_MISSING`); the
firewall reports what the capability layer says rather than assuming
ownership implies access.

A relationship scope carries only the actor's own side of the history:
`founder_private` + `organisation_private` + `relationship_shared` for the
company party, `investor_private` + `relationship_shared` for the investor
party. Non-parties do not learn that the relationship exists.

## Subjects and the permission envelope

Subject references are typed (`QSubjectRef`), never free text; a subject is
resolved through the owning context's public port and re-validated against
`QSubjectRefSchema` even though it arrives from the run store. A person as a
subject is only oneself; an organisation as a subject is only the one the
actor acts for; a document is tenant-scoped; cross-tenant companies and
investors resolve only through the disclosure view port (`QSubjectViewPort`)
that the run creation path also uses.

The permission envelope is the existing capability model (`security`) and
the existing disclosure evaluator (`permissions`): recipient, expiry and
revocation are evaluated at plan time with the injected clock. Nothing new
is persisted; the firewall has no table.

## Disclosure rights

Each scope carries `rights`: `canUseForReasoning` (always true for a
permitted scope — otherwise it is not in the plan), `canDiscloseExistence`,
`canQuote`, `canProvideLink`. Owner scopes may quote and link; shared scopes
may be reasoned over and referenced but not quoted or linked — the Data Room
(CQ-DR) decides sharing of bytes, never Q.

## Combination risk (`COMBINATION_RISK_RULES`)

Applied only to scopes the actor does not own:

- `LIQUIDITY_POSITION`: two or more of CASH_POSITION / BURN_RATE / PAYROLL /
  FUNDING_DEADLINE across permitted scopes → financial scopes are denied
  (`COMBINATION_RISK`).
- `NEGOTIATION_LEVERAGE`: FUNDING_DEADLINE together with NEGOTIATION_STATE
  (a shared capital objective next to the relationship history) → the
  objective survives as an `AGGREGATE` projection without the deadline
  category.

Constraints are recorded on the plan (`combinationConstraints`) so the
retrieval seam can honour projections it did not invent.

## Source existence

A denial never counts, names, titles or describes what was withheld. The
internal `denied` list carries catalogue kind names and subject ids only,
and the public projection carries nothing. The golden source-existence test
holds the internal decision and the captured logs against every marker and
against row-derived text.

## The plan (`PermittedContextPlan`, INTERNAL)

`contractVersion` 1, `policyVersion` `context-firewall-v1`, a fresh `planId`
per evaluation, a `fingerprint` over the policy-relevant content (identical
inputs → identical fingerprint, so a re-plan can be compared without holding
the old plan), the run and tenant ids, the actor (user + organisation), the
purpose (capability + derived task class), the subjects, ≤32 scopes, ≤64
denials, `maxSensitivity`, `allowedLayers` (the retrieval layers the scopes
live in), ≤16 combination constraints, `evaluatedAt`, `revalidateAfter`
(15 minutes) and `revalidateOnResume: true` as a literal: no plan can say
otherwise.

## Orchestrator integration (`q-orchestrator-v2`)

Graph: `preflight_gate → context_firewall → pause_seam → retrieval_seam →
answer_seam`. `context_firewall` owns `PREFLIGHT → POLICY_CHECK → PLANNING`;
a denial ends the graph and the run fails with `POLICY_DENIED` before any
seam runs. The graph state holds only a descriptor of the plan (plan id,
fingerprint, policy version, task class, scope kinds, max sensitivity,
timestamps) — never scopes' filters, never rights, never content — and the
descriptor is informational: `retrieval_seam` re-plans every time it runs,
including after a resume, and `answer_seam` uses the plan produced in the
same process or re-plans. A resume under a different active organisation is
refused as `QRunNotFoundError` before the engine is touched.

`q-orchestrator-v1` checkpoints are not resumable (no firewall in that
graph): the version policy fails them closed.

## Retrieval and model seams

`QRetrievalPort.retrieve(request, plan)` and `QAnswerRequest.plan`: the
seams receive the plan and nothing else about permissions. The RAG packet
must build its queries from `plan.scopes[].filter` and honour `projection`,
`rights` and `combinationConstraints`; the model gateway packet must build
its context from what retrieval returns under that plan. Neither may
retrieve first and filter later.

## Observability and privacy

The firewall logs decision outcomes, internal reasons, kinds, ids and
fingerprints — never subject content, never a plan's filters. The
integration suites capture the logger and assert the five privacy markers
(`FOUNDER-PRIVATE-SECRET-DO-NOT-LEAK`, `INVESTOR-PRIVATE-SECRET-DO-NOT-LEAK`,
`ORG-A-PRIVATE-SECRET-DO-NOT-LEAK`, `RELATIONSHIP-A-ONLY-DO-NOT-LEAK`,
`SOURCE-EXISTENCE-SECRET-DO-NOT-HINT`) appear in no decision, log line,
checkpoint or run event.

## Explicit CQ-Q-004 deferrals

Real retrieval, pgvector, embeddings, ranking → CQ-RAG · model gateway →
CQ-Q-005 · tools → CQ-Q-007 · approvals → CQ-Q-008 · Data Room sharing of
documents and bytes → CQ-DR · a `company.financials.view` role mapping and a
financials store → the financials packet · recommendation feature filtering
→ CQ-REC · output-side checks (a second layer, never a substitute for
filtering first) → CQ-Q-005+ · a persisted plan record (none is needed: the
plan is re-derived).

## Next integration point (after CQ-Q-004)

CQ-Q-005 (Model Gateway) implements `QAnswerPort` behind the same seam,
receiving `plan` and treating it as the outer bound of the context it may
assemble; the prompt it builds may carry only material retrieved under that
plan. `Q_ORCHESTRATION_VERSION` stays `q-orchestrator-v2` unless the node
set changes.

## Tests

`packages/q-firewall/test/policy.test.ts` (task class derivation, candidate
tables, ceilings, combination rules, catalogue invariants);
`packages/q-firewall/test/firewall.integration.test.ts` (golden §73-78:
founder-private → investor, investor-private → founder, other organisation,
relationship parties, source existence, combination risk; expiry and
revocation; organisation context and non-human actors; malformed input;
smuggled authority; minimum context; fingerprint determinism);
`packages/q-orchestrator/test/firewall-resume.integration.test.ts` (golden
§79-81: revoked access after resume, denial on resume and at start with no
retrieval and one public sentence, active organisation switch, owner plan
handed to both seams). `apps/q-api/src/main.ts` passes
`createContextFirewall(...)` as the orchestrator's required `firewall`
dependency; that wiring is enforced by the type of
`createLangGraphQOrchestrator`, and the only stub firewall lives in the
orchestrator's own test file.

# Model execution (CQ-Q-005)

The answer seam is now the Model Gateway (`docs/modules/model-gateway.md`).
The graph is unchanged in shape — `preflight_gate → context_firewall →
pause_seam → retrieval_seam → answer_seam` — and `Q_ORCHESTRATION_VERSION`
is `q-orchestrator-v3`: the state gains `answerFailure` (a Q diagnostic
code) and `modelPolicyVersion` (the ai_ops routing policy code), so v2
checkpoints are not resumable.

## What a run does now

1. The Context Firewall produces the plan; `maxSensitivity` is the strongest
   class Q may reason over in this run.
2. Retrieval is still unconfigured: no company, investor or evidence context
   is assembled.
3. The answer seam (`createModelGatewayQAnswer`) asks the gateway for text
   under the task class derived from the capability, with the plan's
   `maxSensitivity` as the request sensitivity, a TEMPORARY dev-only
   instruction and the run's messages. Nothing else is sent.
4. On success the reply is stored as the run's `Q` message, the run
   completes, and `model_policy_version` records the routing policy code.
5. On a gateway failure the run fails with a coded diagnostic
   (`MODEL_PROVIDER_TIMEOUT`, `BUDGET_EXCEEDED`, `RUN_CANCELLED`, otherwise
   `MODEL_PROVIDER_UNAVAILABLE`) and the person sees the same plain public
   sentence family as before. No provider text travels.

Because both seeded providers are recorded as unreviewed (Gemini ceiling
PUBLIC, Groq ceiling INTERNAL), a run whose plan admits CONFIDENTIAL context
is refused by every model before any call and ends as `Q_UNAVAILABLE`. That
is the honest state until a provider is reviewed (an `ai_ops` data change)
and until retrieval can declare what it actually assembled.

## What has not changed

The Q public request accepts no provider or model; a model result writes no
canonical truth; the firewall runs before the gateway and the gateway
re-checks data-use eligibility on its own; no provider memory, search or
code execution is enabled; Q's prompts remain CQ-Q-006's.

## Tests

`packages/q-orchestrator/test/answer-seam.integration.test.ts` (a public run
answered through the gateway with fake providers under the real codes: Q
message, COMPLETED, policy version, ledger row; a hung provider → coded
timeout with the public sentence and no raw error; a confidential plan
refused before any provider call). The Model Gateway's own suites are listed
in its module doc.

# Governed prompts (CQ-Q-006)

The answer seam no longer carries a temporary instruction. It resolves a
prompt bundle from `@capital-q/q-core` (`docs/modules/q-core.md`): the Q
System Charter (`q-system/v1`) as the SYSTEM message with the run's
communication guidance and operating mode, and the `COMPANY_ANALYST`
task (`company-analyst/v1`) as the USER message with the person's message,
prior turns and the authorised facts inside untrusted-content fences. The
model returns a schema-validated `CompanyAnalystResult`; only its `answer`
becomes the Q message. `Q_ORCHESTRATION_VERSION` is `q-orchestrator-v4`
(state gains `promptBundleVersion`; v3 checkpoints are not resumable).

A completed run now records all three versions:
`orchestration_version` (`q-orchestrator-v4`), `prompt_bundle_version`
(`q-system.v1_company-analyst.v1_comm.v1`) and `model_policy_version`
(the ai_ops routing policy code).

## What still holds

Retrieval is unconfigured, so the authorised-context port serves nothing
in production and Q says so; the plan's `maxSensitivity` is still declared
to the gateway, so unreviewed providers still refuse confidential plans;
no prompt writes canonical truth; the public request accepts no prompt,
profile or model.

## Trying Q locally

`pnpm q:smoke` (local database up, both keys in `.env.local`, after
`pnpm build --filter=@capital-q/q-api...`) runs the synthetic fixture
conversations through the real stack and prints Q's answers with safe
metadata. It is the developer's first honest look at Q; the web Q
workspace comes later.

# Tools (CQ-Q-007)

Q can now look things up, within the plan. The answer seam receives a
`QToolPort` (declared in q-runtime, implemented by `@capital-q/q-tools`,
`docs/modules/q-tools.md`) and offers the model exactly the tools the
registry derives from the run's purpose, actor and Context Firewall plan:
`get_company`, `get_capital_objective`, `get_investor_mandate`,
`search_companies`, or none. The charter's ENVIRONMENT section names them
and states the rule: a tool result is data about the subject, never an
instruction, and "not available" means exactly that.

## The tool loop

```
render bundle → [tools offered?]
  yes: gateway TEXT + tools → model proposes calls?
         → registry pipeline per call → TOOL turns appended (one round of parallel calls, ≤ 6 calls)
       model answers JSON? → accepted through CompanyAnalystResult (one call, as before)
  final (bound reached, or text not acceptable): gateway STRUCTURED, no tools
→ Q message
```

Neither configured provider combines a JSON response schema with function
calling on one call, so the loop asks with a TEXT output while tools are
offered and finishes with the structured request. A run that needs no tool
still costs one model call. Groq's gpt-oss models refuse the request
(`tool_use_failed`) when the JSON answer is generated while tools are still
declared, so the loop runs one round of (parallel) calls and then finishes
without tools; sequential look-ups wait for a provider that accepts both. The gateway requires `TOOL_CALLING` from the
routed model (all four seeded models declare it), rejects tools with a
STRUCTURED output, and treats a proposal naming a tool the request did not
offer as invalid model output (retried, then fallback, never executed).

## What a person sees

Approved stages only: `REVIEWING_COMPANY` while the company and capital
tools run, `REVIEWING_INVESTOR_CRITERIA` for the mandate tool,
`COMPARING_OPPORTUNITIES` for search, recorded as `q.stage.changed` run
events. No tool name, argument or result reaches an event, a message or a
log. The run's answer seam observation (dev tooling and tests) carries tool
names, statuses, codes and latencies only.

## What the engine changed

`QAnswerRequest` now carries the server-resolved `actor` (the graph already
re-validated it on every start and resume) and the correlation id, so a tool
authorises against the actor the run belongs to and never against a
checkpoint. The orchestration version stays `q-orchestrator-v4`: no state
channel changed. No migration: tool calls are not persisted as rows in this
packet; they are traced (`q.tool.execute`), metered (`q.tool.calls`,
`q.tool.latency_ms`) and logged with bounded fields.

## Trying it

`pnpm q:smoke -- --tools` runs six synthetic tool conversations as the
founder of Northwind Sensor Systems and the admin of Apex Ventures: a
profile question, a raise question, a network search, the investor's own
mandate, a founder asking for that mandate (not offered, not served), and
an unknown company (denied, said plainly). Private rows carry
`TOOL-*-DO-NOT-LEAK` markers that must never appear. The same scenarios
run under `pnpm test:live-model`, once with default routing and once per
provider.

## Tests

`packages/model-gateway/test/tools.test.ts` (gateway capability
requirement, TOOL_CALLS output, unoffered tool refused, tools with
STRUCTURED refused, tool turns accepted; Gemini and Groq projections),
`packages/model-gateway/test/q-answer-tools.test.ts` (the loop: no port →
one structured call; direct JSON → one call; proposal → TOOL turn + stage;
denial as data; round and call bounds; repair; cancellation),
`packages/q-orchestrator/test/answer-seam.integration.test.ts` (a run
through the graph offers, executes, records the stage and completes with
the re-validated actor), `packages/contracts/test/model-tools.test.ts`,
and the q-tools suites listed in `docs/modules/q-tools.md`.

# Approvals (CQ-Q-008)

Q can now prepare a consequential action and wait for a person. The
Approval Engine (`@capital-q/q-actions`, `docs/modules/q-actions.md`) owns
`Prepare → Approve → Execute`: an exact proposal persisted with its
SHA-256 binding hash, one approval requested from the run's owner, a
server-derived decision under live `q.action.approve` authority, and an
idempotent execution gate that re-verifies person, permission, hash and
status before the single side effect. The production registry holds no
action, so nothing consequential can happen yet; the flow is proven with
the test-only `test.confirm_required` executor.

## What the engine changed

`Q_ORCHESTRATION_VERSION` is `q-orchestrator-v5` (v4 checkpoints are not
resumable): the graph gains `action_prepare` after the answer seam and
`approval_gate`, which `interrupt()`s while the run is durably
`AWAITING_APPROVAL` (stage `WAITING_FOR_APPROVAL`, run events
`q.action.proposed` and `q.approval.required`). The checkpoint carries the
action id only. `POST /v1/q/approvals/:id/approve` records the decision and
then resumes the run (`ACTION_EXECUTION`, stage
`COMPLETING_APPROVED_ACTION`); the resumed node calls the gate, which reads
the database, never the checkpoint. Rejection completes the run in the
decision's transaction. A resume with no decision executes nothing.
`QActionPort` (q-runtime) is the seam; production wires
`createQActionPort` with no proposer.

## What a person sees

The approval as `QApprovalView`: what Q wants to do (summary, preview,
targets, action status), when it expires, whether they may decide. Never a
hash, a tenant, an approver id or an internal code. Every refusal is one
plain sentence. Typing or saying "approve" in a message changes nothing;
only the approve route with the person's own session is a decision.

## Tests

`packages/q-actions/test/*` (pure and integration, incl. the required
deterministic demo and the RT-05 approval-swap demo),
`packages/q-orchestrator/test/approval-flow.integration.test.ts`,
`apps/q-api/test/q-approvals.test.ts`, pgTAP `rls/330_q_actions`.

# Streaming (CQ-Q-009)

A person can now watch a run. `GET /v1/q/runs/:runId/events` is a
Server-Sent Events projection of `q_runtime.run_events`
(`docs/modules/q-stream.md`): durable events with their sequence as the
SSE id, live text deltas without an id, heartbeat comments, replay from
`Last-Event-ID`, and a close on the terminal event. The wake-up is
Postgres NOTIFY issued by the run-event repository inside the append
transaction; the reader re-reads after its cursor on every notice, which
is what closes the replay/live race and lets one instance stream a run
another instance executes.

## What the engine changed

The answer seam appends `q.message.completed` with the persisted message
in the same transaction as the message (it never had a durable completion
event before), and a message may be inserted with a caller-generated id so
a streaming answer can name it before its text exists. The orchestration
version is unchanged (`q-orchestrator-v5`): no graph state changed. No
migration.

## What a person sees

Stages in plain English, text arriving progressively where a source
publishes deltas (none in production yet: providers do not stream and the
answer is a structured call, so the message arrives whole), the persisted
answer, prepared actions and approval requests, and the run's end.
Approval remains an HTTP command; the stream only announces it.

## Trying it

`pnpm q:stream-smoke -- --synthetic --verbose` (no model), or without
`--synthetic` through the real gateway. It creates a run, streams it,
disconnects on purpose, reconnects with `Last-Event-ID`, and checks the
recovered answer against the persisted run.

## Proving Q behaves — the eval harness (CQ-Q-010)

`packages/q-evals` (see `docs/modules/q-evals.md`) is the Wave-4 quality
gate. It runs synthetic cases through the real run path — `createRun`, the
orchestrator, the Context Firewall, the Prompt Registry, the Model Gateway
with the real catalogue and policies, the Tool Registry, the Approval
Engine and the stream — and grades what it observes. `pnpm q:eval:ci`
uses a scripted model under the real provider codes with no key and no
spend; `pnpm q:eval:live` is the explicit opt-in through Gemini/Groq.
Eleven hard invariants (founder-private, investor-private, cross-tenant,
relationship-private, prohibited tool, unapproved execution, model
self-approval, payload swap, duplicate execution, provider misrouting,
internal-reasoning leakage) are graded deterministically on the provider
input, the answer, the events and the logs, and are never averaged: one
leak fails the run. Quality is observed and, where nuanced, handed to a
person; no LLM judges an invariant.

# Q specialists (`@capital-q/q-specialists`, CQ-Q-020)

Q's first real specialist intelligence capability. Full module documentation
lives in [`q-specialists.md`](./q-specialists.md); what matters for the Q
picture is where it sits and what it does not become.

## Where it sits

The specialist registers through the runtime's existing `QAnswerPort`, so
the investigation graph, the Context Firewall, the run lifecycle and the
stream are unchanged. `createSpecialistQAnswer` asks `supports()`; a request
about one company goes to Company Intelligence, and anything else falls
through to the conversational answer path as its delegate.

```
QOrchestrator → Context Firewall → answer seam → specialist → findings
                                              ↘ unsupported → conversational path
                                                                → Q writes the message
```

## One Q

A specialist is a bounded capability Q reaches for, never an agent a person
talks to. Nothing a person reads names the specialist, its version, the
provider, the prompt bundle or a graph node; the person asks Q and Q answers.
`QSpecialistProbe` reads the question only to decide whether it is that
specialist's kind of question — never as an instruction about what it may do.

## What it must never become

```
Company Intelligence ≠ InvestIQ ≠ matching ≠ recommendation ≠ investor fit
Company Intelligence ≠ the canonical Company domain
```

No company score, no investor fit, no funding probability, no readiness
level, no peer benchmark and no InvestIQ methodology. Findings whose language
asserts one are dropped rather than softened. Canonical company state and the
capital objective are read, never written, and the specialist has no write
path, no approval path and no consequential action at all.

## Where the guarantees live

The prompt states the rules; code enforces them. Contradictions, staleness,
material change, gaps, coverage and information confidence are computed
before any model runs and shown to the model as a frame it may not overturn.
Citations are opaque per-render labels resolved on the server, so a model
cannot cite a source it was never given — not because it is told not to, but
because it never sees an identifier to write.
