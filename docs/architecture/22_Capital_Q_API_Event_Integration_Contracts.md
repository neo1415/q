# 22 — Capital Q API, Event & Integration Contracts

**Document type:** API / Event / Integration Contract Architecture  
**Status:** V1 / MVP Architecture Baseline  
**Audience:** Backend Engineering, Frontend Engineering, Q/AI Engineering, Platform Engineering, Integration Engineering, Security Engineering, Coding Agents  
**Primary runtime contracts:** TypeScript + Zod  
**HTTP contract documentation:** OpenAPI 3.2  
**Event contract documentation:** AsyncAPI 3.1 where useful  
**Event envelope:** Capital Q canonical event envelope, CloudEvents-inspired  
**Error representation:** RFC 9457 Problem Details-compatible JSON  
**Streaming:** Server-Sent Events for Q run/event streaming in V1  
**Source authority:** Locked PADL → Product Specification → Final System Review → Documents 10–21 → this document

---

# 1. Purpose

Capital Q is not one request/response application.

It contains:

```text
web
api
q-api
workers
database
queues
Q tools
video
model providers
OAuth connectors
webhooks
future partner APIs
```

The product only remains one coherent intelligence system if these components communicate through stable, explicit contracts.

This document defines those contracts.

The core rule is:

> **If two components exchange information, the shape, meaning, authority and version of that information must be explicit.**

Do not allow integrations to emerge as:

```text
some JSON
sent somewhere
that "both sides understand"
```

That is how systems become tightly coupled and impossible to evolve safely.

---

# 2. Source-Derived Contract Requirements

The Product Specification requires Capital Q to behave as a living, continuously synchronized intelligence system.

Every material event may affect:

- knowledge;
- assessments;
- recommendations;
- profiles;
- analytics;
- relationships;
- notifications;
- workflows.

The Product Specification explicitly defines material-event synchronization and states that significant changes should propagate through the same institutional understanding rather than create separate truths.

The Final System Review also requires:

```text
one canonical company
one canonical investor organisation
one canonical company-investor relationship
append-oriented event history
Q action authority
permission enforcement below UI
```

Therefore:

```text
API contracts
+
domain events
+
job contracts
+
integration contracts
```

are not documentation overhead.

They are part of Capital Q's institutional architecture.

---

# 3. Contract Categories

Capital Q defines separate contract classes.

## 3.1 HTTP API Contracts

Used for:

```text
browser → api
browser → q-api
service → service where request/response is appropriate
future partner API
```

## 3.2 Streaming Contracts

Used for:

```text
q-api → browser
```

for progressive Q run events.

## 3.3 Domain Event Contracts

Used for:

```text
domain mutation
→ transactional outbox
→ downstream consumers
```

A domain event states:

> Something happened.

## 3.4 Job Contracts

Used for:

```text
queue → worker
```

A job states:

> Perform this work.

A job is not a domain event.

## 3.5 Webhook Contracts

Used for:

```text
external provider → Capital Q
```

## 3.6 Provider Adapter Contracts

Used internally for:

- video;
- model providers;
- embeddings;
- rerankers;
- calendars;
- email;
- verification;
- future CRM/storage connectors.

## 3.7 Q Tool Contracts

Used for:

```text
Q orchestration
→ deterministic Capital Q capability
```

Each layer has different semantics and lifecycle.

---

# 4. Contract Source of Truth

Recommended package:

```text
packages/contracts/
├── src/
│   ├── common/
│   ├── api/
│   ├── q/
│   ├── events/
│   ├── jobs/
│   ├── integrations/
│   └── providers/
├── generated/
│   ├── openapi/
│   ├── asyncapi/
│   └── json-schema/
└── tests/
```

The source is:

```text
Zod schema
+
TypeScript type
+
semantic documentation
```

Generated specifications are artifacts.

---

# 5. Why Zod First

Capital Q is TypeScript-first.

Zod provides:

- runtime validation;
- compile-time inference;
- shared schemas;
- trust-boundary validation;
- structured-output validation for Q/models.

Avoid maintaining three manually synchronized definitions:

```text
TypeScript interface
OpenAPI YAML
JSON Schema
```

that slowly diverge.

---

# 6. Contract Ownership

Every contract has an owner.

Example:

```text
company API → core/company domain
relationship event → network/relationship domain
Q run schema → q platform
document webhook adapter → evidence/media domain
```

No "shared contracts" without a responsible bounded context.

---

# 7. Generated Artifacts

Build/codegen may produce:

```text
openapi.json
openapi.yaml
asyncapi.yaml
JSON Schema
frontend client types
provider fixture schemas
```

Generated artifacts are not manually edited.

---

# 8. OpenAPI Baseline

HTTP APIs are documented with:

```text
OpenAPI 3.2
```

for V1 architecture.

If a specific generator/library temporarily supports only an earlier compatible OpenAPI version:

- runtime Zod schema remains authoritative;
- generation may target the supported version;
- no architectural change is implied.

---

# 9. AsyncAPI Baseline

Stable event/message channels may be described with:

```text
AsyncAPI 3.1
```

especially as event volume/integration complexity grows.

Do not make perfect AsyncAPI documentation a two-day MVP blocker.

The runtime event registry still exists from day one.

---

# 10. API Major Versioning

Public/application API paths use:

```text
/v1
```

Examples:

```text
/v1/companies/:companyId
/v1/discover/companies
/v1/q/runs
```

Major version belongs at the external HTTP boundary.

---

# 11. What Requires `/v2`

Examples:

- resource semantic redefinition;
- incompatible field-type change;
- removing required client dependency;
- incompatible authentication change;
- fundamentally changing command semantics.

Do not create `/v2` for every additive field.

---

# 12. Compatible API Evolution

Usually compatible:

```text
add optional request field
add response field
add endpoint
add relation/link
add new event type
```

Enum additions require consumers designed to tolerate future values.

---

# 13. Deprecation

A deprecated API operation/field records:

```text
deprecated
replacement
deprecated_at
removal_not_before
```

Do not break an open browser session because backend deployed five minutes later.

---

# 14. Resource Naming

Use plural nouns:

```text
/companies
/investor-organisations
/relationships
/documents
/data-rooms
```

Prefer domain language over database table names.

---

# 15. Command Endpoints

Some actions are commands rather than CRUD.

Examples:

```text
POST /v1/relationships/:id/express-interest
POST /v1/documents/:id/shares
POST /v1/q/actions/:id/approve
```

This is cleaner than pretending every action is a generic PATCH.

---

# 16. Prohibited Generic Action Endpoint

Do not create:

```text
POST /v1/action
{
  "type": "ANYTHING"
}
```

It becomes an untyped RPC dumping ground and destroys ownership.

---

# 17. HTTP Methods

General semantics:

```text
GET     read
POST    create / command
PUT     full replacement where appropriate
PATCH   partial update
DELETE  delete/revoke when resource semantics fit
```

---

# 18. Response Status Codes

Use standard codes honestly.

```text
200 OK
201 Created
202 Accepted
204 No Content
400 Bad Request
401 Unauthorized
403 Forbidden
404 Not Found
409 Conflict
412 Precondition Failed
422 Unprocessable Content
429 Too Many Requests
500 Internal Server Error
503 Service Unavailable
```

---

# 19. `202 Accepted`

Use when work is durably accepted but incomplete.

Example:

```text
POST /v1/documents/:id/reprocess
→ 202
```

Response references:

```text
jobId
runId
statusUrl
```

Do not claim completion while background work is still running.

---

# 20. Error Representation

Use:

```text
application/problem+json
```

compatible with RFC 9457.

Conceptual shape:

```json
{
  "type": "https://api.capitalq.example/problems/permission-denied",
  "title": "You do not have permission to perform this action.",
  "status": 403,
  "detail": "Your current organisation role cannot share this document.",
  "instance": "/problems/01J...",
  "code": "PERMISSION_DENIED",
  "requestId": "req_...",
  "errors": []
}
```

Capital Q extension members are permitted.

---

# 21. Stable Error Codes

Examples:

```text
VALIDATION_FAILED
AUTHENTICATION_REQUIRED
PERMISSION_DENIED
RESOURCE_NOT_FOUND
RESOURCE_CONFLICT
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
RATE_LIMITED
Q_APPROVAL_REQUIRED
Q_ACTION_EXPIRED
PROVIDER_UNAVAILABLE
UPLOAD_NOT_READY
```

Clients branch on `code`.

Do not parse prose.

---

# 22. Error Security

Do not return:

- SQL;
- stack traces;
- file-system paths;
- provider secrets;
- model keys;
- sensitive object existence where disclosure is restricted.

Problem Details is user/API information, not a debug dump.

---

# 23. Validation Error Extension

Example:

```json
{
  "type": ".../validation-failed",
  "title": "The request is not valid.",
  "status": 422,
  "code": "VALIDATION_FAILED",
  "errors": [
    {
      "path": "targetAmount",
      "code": "too_small",
      "message": "Enter an amount greater than zero."
    }
  ]
}
```

Keep `path` stable enough for forms.

---

# 24. Request IDs

Every HTTP request has:

```text
request_id
```

Expose via:

```text
X-Request-Id
```

or equivalent response header.

Generated server-side unless an upstream trusted request ID is accepted.

---

# 25. Correlation IDs

A business workflow can span many HTTP requests/jobs/events.

Use:

```text
correlation_id
```

Example:

```text
upload audited accounts
→ document ready
→ extraction
→ knowledge update
→ InvestIQ refresh
→ recommendation refresh
```

One correlation lineage.

---

# 26. Causation IDs

Events/jobs can carry:

```text
causation_id
```

meaning:

> This message exists because of this preceding command/event.

This supports explainability and debugging.

---

# 27. Actor Context

Protected APIs derive actor context server-side.

```ts
type ActorContext = {
  userId: string;
  tenantId: string;
  organisationId?: string;
  membershipId?: string;
  actorType:
    | "HUMAN"
    | "Q"
    | "SYSTEM"
    | "CONNECTED_SYSTEM";
};
```

---

# 28. Never Trust Client Actor Authority

Prohibited:

```json
{
  "actorRole": "ADMIN",
  "actorOrganisationId": "..."
}
```

as security proof.

Client can identify desired target/context.

Server verifies authority.

---

# 29. Tenant Context

Tenant context is resolved from:

```text
authenticated identity
membership
active organisation
resource ownership
```

If a header such as `X-Organisation-Id` is used as a selector:

it remains an untrusted selector until server authorization succeeds.

---

# 30. Timestamps

JSON timestamps use RFC 3339/ISO 8601.

Prefer UTC:

```text
2026-09-01T13:30:00Z
```

Business timezone may exist separately.

---

# 31. Identifiers

Use stable opaque identifiers.

Implementation may use:

```text
UUID
UUIDv7
```

as defined in Document 13.

Do not expose sequential numeric IDs as security boundary.

---

# 32. Money

Do not send financial values as JavaScript floating point when exactness matters.

Example:

```ts
type Money = {
  amount: string;
  currency: string;
};
```

Example:

```json
{
  "amount": "2000000.00",
  "currency": "USD"
}
```

Postgres uses NUMERIC.

---

# 33. Ratios / Percentages

Define representation explicitly.

Example:

```ts
type Percentage = {
  value: string;
  unit: "PERCENT";
};
```

Never let one endpoint mean:

```text
0.25
```

and another:

```text
25
```

without type distinction.

---

# 34. Pagination

Default large-list contract:

```ts
type CursorPage<T> = {
  items: T[];
  nextCursor?: string;
};
```

No total count unless product actually needs it.

Exact count can be expensive.

---

# 35. Cursor Rules

Cursor:

- opaque;
- server-generated;
- stable for the list ordering;
- not client-constructed.

For feed:

```text
slate + rank
```

can form internal continuation.

---

# 36. Page Size

Server enforces max.

Common normal endpoint:

```text
default 20
max 100
```

Feed uses a smaller tuned size per Document 20.

---

# 37. Filtering

Prefer explicit typed filters.

Example:

```text
stage
geography
taxonomy
status
```

No arbitrary SQL expression API.

---

# 38. Sorting

Allowlist sorts.

Example:

```text
sort=updated_at
order=desc
```

Never interpolate untrusted database field names.

---

# 39. Purpose-Built Projections

Do not expose one gigantic Company DTO everywhere.

Use:

```text
CompanySummary
CompanyProfile
CompanyDiscoveryProjection
PublicCompanyProjection
CompanyAdminProjection
```

Each has explicit purpose/privacy.

---

# 40. Optimistic Concurrency

Resources vulnerable to concurrent update should use versioning.

Example:

```ts
{
  version: 7
}
```

Client update includes expected version.

---

# 41. HTTP Conditional Requests

Where useful:

```text
ETag
If-Match
```

If resource changed:

```text
412 Precondition Failed
```

This is valuable for:

- mandate;
- permissions;
- organisation settings;
- company facts.

---

# 42. Idempotency

Consequential POST commands use:

```text
Idempotency-Key
```

as a Capital Q convention.

Examples:

- express interest;
- send outbound message;
- share document;
- book meeting;
- execute approved Q action;
- create external provider resource.

---

# 43. Idempotency Semantics

Key uniqueness scoped by:

```text
tenant/actor
command/endpoint
idempotency key
```

Store payload fingerprint.

---

# 44. Idempotency Replay

Same key + same fingerprint:

return original command result.

Same key + different fingerprint:

```text
409
IDEMPOTENCY_CONFLICT
```

---

# 45. Idempotency Retention

Per-command policy.

Typical:

```text
24h+
```

Higher-consequence commands may retain longer.

---

# 46. Idempotency Standard Status

`Idempotency-Key` is widely used and has an IETF HTTPAPI working-group draft, but as of September 2026 it is not a published RFC.

Capital Q adopts it as a documented application convention.

Do not claim it is already an RFC standard.

---

# 47. Command IDs

Every material command receives:

```text
command_id
```

This is distinct from:

- request ID;
- idempotency key;
- event ID.

It helps causation/audit.

---

# 48. Browser Authentication

Supabase-authenticated identity/session.

API verifies token/session and builds ActorContext.

Authorization remains Capital Q application policy + RLS.

---

# 49. Internal Service Authentication

Private networking helps transport isolation.

It does not replace service identity.

Sensitive internal endpoints can require:

- scoped service token;
- signed internal assertion;
- mTLS later if infrastructure justifies.

---

# 50. CORS

Strict origin allowlist for browser APIs.

CORS is not authorization.

---

# 51. Content Types

Normal:

```text
application/json
```

Problems:

```text
application/problem+json
```

SSE:

```text
text/event-stream
```

File/video bytes go direct to managed providers where designed.

---

# 52. Companies API

Conceptual:

```text
GET   /v1/companies/:companyId
PATCH /v1/companies/:companyId
GET   /v1/companies/:companyId/intelligence
GET   /v1/companies/:companyId/evidence
```

Avoid returning private Q knowledge through normal profile endpoint.

---

# 53. Capital Objectives

```text
POST  /v1/companies/:companyId/capital-objectives
GET   /v1/capital-objectives/:capitalObjectiveId
PATCH /v1/capital-objectives/:capitalObjectiveId
```

Only one active objective may be constrained by domain rules, not generic API framework.

---

# 54. Investor Mandates

```text
GET   /v1/investor-organisations/:id/mandate
PATCH /v1/investor-organisations/:id/mandate
```

Response distinguishes:

```text
declared mandate
```

from internal observed/inferred intelligence.

---

# 55. Discovery

```text
GET /v1/discover/companies
GET /v1/discover/investors
GET /v1/discover/saved
```

Feed response uses discovery projection.

---

# 56. Search

Structured:

```text
GET /v1/search/companies
GET /v1/search/investors
```

Natural-language Q search compiles to typed query and invokes same deterministic search capability.

---

# 57. Recommendation Explanation

```text
GET /v1/recommendations/:recommendationId/explanation
```

Returns:

- reason codes;
- matched factors;
- mismatches;
- uncertainties;
- evidence refs where permitted.

---

# 58. Relationship API

One canonical company/investor relationship.

```text
GET /v1/relationships/:id
GET /v1/relationships/:id/events
```

Commands:

```text
POST /v1/relationships/:id/express-interest
POST /v1/relationships/:id/accept-connection
POST /v1/relationships/:id/pass
```

---

# 59. Relationship State

Response:

```ts
type RelationshipResponse = {
  id: string;
  companyId: string;
  investorOrganisationId: string;
  currentState: RelationshipState;
  stateVersion: number;
  lastMaterialEventAt?: string;
};
```

History remains separate/append-oriented.

---

# 60. Relationship Event History

The Final System Review explicitly requires:

```text
relationship entity
+
event history
+
current derived state
```

rather than one mutable status.

API architecture preserves that.

---

# 61. GateQ

Conceptual:

```text
GET  /v1/investor-organisations/:id/gateq
PUT  /v1/investor-organisations/:id/gateq
POST /v1/gateq/evaluate
POST /v1/gateq/requests
```

GateQ rule evaluation is typed and separate from recommendation ranking.

---

# 62. Data Room

```text
GET    /v1/data-rooms/:id
GET    /v1/data-rooms/:id/documents
POST   /v1/data-rooms/:id/grants
PATCH  /v1/data-room-grants/:grantId
DELETE /v1/data-room-grants/:grantId
```

---

# 63. Document Sharing Command

Example:

```http
POST /v1/documents/:documentId/shares
Idempotency-Key: "..."
```

Request:

```json
{
  "recipientOrganisationId": "...",
  "relationshipId": "...",
  "access": "VIEW_ONLY",
  "expiresAt": "2026-10-01T00:00:00Z"
}
```

Server derives:

- actor;
- authority;
- tenant.

---

# 64. Document Upload Session

```text
POST /v1/documents/upload-sessions
```

Returns scoped upload authorization.

Application does not accept arbitrary storage path from client as authority.

---

# 65. Video Upload Session

```text
POST /v1/media/pitch-upload-sessions
```

Returns one-time provider upload session.

Provider-specific URL stays an adapter detail.

---

# 66. Q API Boundary

Q is independently deployable.

Primary endpoints:

```text
POST /v1/q/runs
GET  /v1/q/runs/:runId
GET  /v1/q/runs/:runId/events
POST /v1/q/runs/:runId/messages
POST /v1/q/runs/:runId/cancel

POST /v1/q/actions/:actionId/approve
POST /v1/q/actions/:actionId/reject
```

---

# 67. Create Q Run

Conceptual request:

```ts
type CreateQRunRequest = {
  purpose: QPurpose;

  subject?: {
    type: QSubjectType;
    id: string;
  };

  modality: "TEXT" | "VOICE";

  message?: {
    text: string;
  };

  contextRefs?: Array<{
    type: string;
    id: string;
  }>;
};
```

Actor/tenant are server-derived.

---

# 68. Create Q Run Response

```ts
type CreateQRunResponse = {
  runId: string;
  status: QRunStatus;
  eventStreamUrl: string;
  createdAt: string;
};
```

Run creation should return quickly.

---

# 69. Q Streaming Transport

V1 uses:

```text
Server-Sent Events
```

for Q output/events.

Why:

- server → browser stream is dominant;
- browser commands can remain HTTP POST;
- built-in reconnect semantics;
- simple infrastructure;
- works well with text/event-stream.

---

# 70. Q SSE Event Format

Example:

```text
event: q.stage.changed
id: 42
data: {"stage":"RETRIEVAL"}
```

Use:

- `event`;
- `id`;
- `data`.

Heartbeat can be comment line.

---

# 71. Q Stream Event Types

Potential:

```text
q.run.started
q.stage.changed
q.message.delta
q.message.completed
q.result.created
q.evidence.available
q.action.proposed
q.input.required
q.run.completed
q.run.failed
```

---

# 72. No Chain-of-Thought Event

Prohibited:

```text
q.chain_of_thought
q.internal_reasoning
q.specialist_secret_notes
```

Only user-safe high-level stages/events.

---

# 73. SSE Event IDs

Per-run event sequence:

```text
1
2
3
...
```

or stable comparable sequence.

Client reconnect can use:

```text
Last-Event-ID
```

to request missed events.

---

# 74. Durable Q Event Store

SSE is transport.

It is not source of truth.

Persist relevant Q run events.

On reconnect:

```text
last event
→ replay missed durable events
→ continue live stream
```

---

# 75. SSE Heartbeat

Send periodic comments:

```text
: heartbeat
```

to keep intermediaries alive.

No fake business event.

---

# 76. Q Delta Persistence

Do not persist each token as institutional event.

Persist:

- final message;
- structured results;
- material state transitions.

Delta transport is ephemeral presentation.

---

# 77. Q Clarification

If Q needs user input:

```text
q.input.required
```

Client sends:

```text
POST /v1/q/runs/:id/messages
```

No WebSocket required.

---

# 78. Q Cancellation

```text
POST /v1/q/runs/:id/cancel
```

State:

```text
CANCEL_REQUESTED
→ CANCELLED
```

External provider call already in-flight may only be cancellable best effort.

---

# 79. Q Action Proposal

```ts
type QActionProposal = {
  id: string;
  runId: string;

  actionType: string;

  target: {
    type: string;
    id: string;
  };

  payload: unknown;
  payloadHash: string;

  consequenceClass: QActionConsequenceClass;

  approvalState:
    | "NOT_REQUIRED"
    | "PENDING"
    | "APPROVED"
    | "REJECTED"
    | "EXPIRED";

  expiresAt?: string;
};
```

---

# 80. Q Approval

```text
POST /v1/q/actions/:id/approve
```

Request includes:

```text
expectedPayloadHash
```

Server verifies:

- proposal still active;
- actor authorized;
- payload unchanged;
- approval not expired.

---

# 81. Approval Payload Hash

If Q changes:

```text
recipient
message
document
permission
amount
date
```

after approval:

hash changes.

Prior approval invalid.

This is required to prevent approval-swap attacks.

---

# 82. Q Execution

Approval:

```text
persists authority
```

Then deterministic executor performs side effect.

Execution result creates:

- action execution record;
- audit;
- domain event;
- provider ID where relevant.

---

# 83. Q Tool Contract

A Q tool is typed.

Example:

```ts
const ShareDocumentInput = z.object({
  documentId: Id,
  recipientOrganisationId: Id,
  relationshipId: Id.optional(),
  access: z.enum(["VIEW_ONLY", "VIEW_AND_DOWNLOAD"]),
  expiresAt: DateTime.optional()
});
```

---

# 84. Q Tool Metadata

Every registered tool includes:

```text
tool ID
version
input schema
output schema
risk class
required capabilities
allowed purposes
approval class
idempotency semantics
owner
```

---

# 85. No Raw SQL Tool

Never expose:

```text
run_sql
execute_query
shell
fetch_any_url
```

as unrestricted general Q tools.

Q invokes bounded capabilities.

---

# 86. Tool Output

Return bounded structured result.

```ts
type ToolResult<T> = {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    safeMessage: string;
  };
  auditRef?: string;
};
```

No stack traces/raw DB rows.

---

# 87. Tool Versioning

Breaking schema:

```text
tool version increments
```

LangGraph checkpoints/workflow versions must know compatible tool versions.

Do not silently mutate a tool used by resumable runs.

---

# 88. Voice Session API

```text
POST /v1/q/voice/sessions
```

Returns ephemeral scoped provider credential/session.

Never send permanent model provider key to browser.

---

# 89. Voice and Text Unification

Voice transcript enters same:

- Q run;
- message;
- knowledge candidate;
- approval;

architecture as text.

No separate "voice database."

---

# 90. Domain Event Definition

A domain event states:

> A material business fact has occurred.

Examples:

```text
company profile updated
document became ready
relationship interest expressed
permission revoked
Q action executed
```

---

# 91. Job Definition

A job states:

> Perform a piece of work.

Examples:

```text
extract document
rebuild recommendation slate
reassess knowledge
send notification
```

Jobs may result from events.

Do not name commands as past-tense events.

---

# 92. Canonical Event Envelope

Capital Q envelope:

```ts
type CapitalQEvent<T> = {
  specVersion: "1.0";

  id: string;
  type: string;
  source: string;

  time: string;
  subject?: string;

  dataContentType: "application/json";

  eventVersion: number;

  tenantId?: string;
  organisationId?: string;

  actor?: {
    type:
      | "HUMAN"
      | "Q"
      | "SYSTEM"
      | "CONNECTED_SYSTEM";
    id?: string;
  };

  correlationId?: string;
  causationId?: string;

  aggregate?: {
    type: string;
    id: string;
    version?: number;
  };

  data: T;
};
```

---

# 93. CloudEvents Inspiration

The envelope deliberately borrows stable concepts:

```text
id
source
type
subject
time
datacontenttype
data
```

from CloudEvents.

Capital Q adds:

- eventVersion;
- tenant/org;
- actor;
- correlation;
- causation;
- aggregate metadata.

We do not have to serialize every internal record as literal CloudEvents HTTP format.

---

# 94. Event Naming

Format:

```text
<context>.<entity-or-capability>.<past-tense-event>
```

Examples:

```text
core.company.updated
core.capital_objective.created
evidence.document.ready
network.relationship.interest_expressed
network.relationship.matched
permissions.access.revoked
q.action.executed
recommendation.slate.generated
```

---

# 95. Past Tense Rule

Good event:

```text
evidence.document.ready
```

Bad event:

```text
evidence.process_document
```

The latter is a job:

```text
evidence.document.process
```

or explicit job type.

---

# 96. Event IDs

Globally unique.

Consumer dedupe uses event ID.

---

# 97. Event Source

Example:

```text
capitalq://api/core/company
capitalq://q-api/actions
capitalq://workers/evidence
```

Source identifies producer logically, not current hostname.

---

# 98. Event Subject

Example:

```text
company/<id>
relationship/<id>
document/<id>
```

Useful for routing/debugging.

---

# 99. Event Data Minimality

Do not emit full private aggregates.

Example event:

```json
{
  "companyId": "...",
  "changedFields": ["stage", "raiseTarget"]
}
```

Consumers fetch permitted authoritative state if needed.

---

# 100. Event Snapshot Data

When historical interpretation requires exact before/after:

include safe immutable values.

Example:

```json
{
  "companyId": "...",
  "field": "stage",
  "from": "PRE_SEED",
  "to": "SEED"
}
```

Do not force consumer to reconstruct old value from current DB.

---

# 101. Sensitive Event Payload

Sensitivity applies to event data too.

Generic queue should not carry:

- founder's private confession;
- full financial model;
- investor private note.

Use resource refs/knowledge IDs.

---

# 102. Event Tenant

Tenant-owned event requires tenant ID.

Consumers verify fetched resources remain same tenant.

No event payload bypasses authorization.

---

# 103. Event Actor

Material user/Q action records actor.

For Q:

```text
actor.type = Q
```

Authority points to approval/action record.

This aligns with source requirements for consequential-action reconstruction.

---

# 104. Event Version

Each event type has:

```text
eventVersion
```

Start:

```text
1
```

Breaking payload change increments.

---

# 105. Event Schema Registry

Repository:

```text
packages/contracts/src/events/
```

Every event contract records:

```text
name
version
owner
producer
consumers
sensitivity class
replay safety
schema
description
```

---

# 106. Event Catalogue

Generate human-readable catalogue.

Example:

| Event | Version | Producer | Consumers |
|---|---:|---|---|
| `evidence.document.ready` | 1 | evidence worker | knowledge, notifications |
| `core.company.updated` | 2 | company domain | recommendations, projections |
| `network.relationship.matched` | 1 | network | capital workspace, notifications |

Coding agents consult catalogue before creating event.

---

# 107. AsyncAPI Use

As event surface grows, generate AsyncAPI 3.1 contract for:

- queue channels;
- event messages;
- external event subscriptions.

This provides machine-readable communication contracts.

---

# 108. Transactional Outbox

Domain mutation and event creation occur in same database transaction.

Example:

```text
BEGIN
  UPDATE company
  INSERT outbox(event)
COMMIT
```

No:

```text
UPDATE DB
then publish queue
```

dual-write race.

---

# 109. Outbox Record

Conceptual:

```text
event_id
type
event_version
tenant_id
payload
correlation_id
causation_id
status
attempts
created_at
published_at
```

---

# 110. Event Publisher

Worker:

```text
lease pending outbox
→ validate
→ publish to queue/dispatcher
→ mark delivered
```

Retry transient failures.

---

# 111. Delivery Assumption

Assume:

```text
at least once
```

at application level.

Even if infrastructure offers stronger claims, consumers remain idempotent.

---

# 112. Event Ordering

No global total order required.

Where order matters:

use:

```text
aggregate.version
```

or entity sequence.

---

# 113. Relationship Ordering

Relationship events can have sequence:

```text
1
2
3
...
```

Current relationship state derives from ordered event history.

---

# 114. Duplicate Event Handling

Consumer:

```text
event_id already processed?
→ no-op
```

For projection rebuild, idempotent replace/upsert.

---

# 115. Consumer Transaction

Pattern:

```text
receive
validate envelope
validate event schema/version
dedupe
process transaction
record processed event
ack
```

---

# 116. Invalid Event

Malformed material event:

```text
quarantine / DLQ
alert
```

Do not silently discard.

---

# 117. Unknown Event Version

Consumer should:

- reject unsupported breaking version;
- DLQ;
- alert.

Do not guess semantics.

---

# 118. Event Replay

Replay can rebuild derived systems.

Examples:

- discovery projection;
- analytics projection;
- recommendation invalidation.

But replay must not repeat external side effects.

---

# 119. Consumer Replay Class

Declare:

```text
REPLAY_SAFE
SIDE_EFFECTING
```

Side-effecting consumers require exact dedupe/replay mode.

---

# 120. Analytics Events Are Separate

Analytics event:

```text
discover.company_impression
```

is not domain truth.

Analytics loss should not cause:

- missed Match;
- missing permission;
- missing relationship event.

---

# 121. Audit Is Separate

Audit:

> Who acted, under what authority, on what?

Domain event:

> What business state changed?

Both may be generated by one transaction/action.

Do not use audit log as event bus.

---

# 122. Material Events

Do not trigger intelligence workflow on:

- every keystroke;
- hover;
- scroll;
- token delta.

The Product Specification specifically distinguishes material events from ordinary interactions.

---

# 123. Manual Refresh Contract

Automatic synchronization is primary, but source documents also preserve manual refresh for confidence/transparency.

Examples:

```text
POST /v1/companies/:id/refresh-intelligence
POST /v1/recommendations/refresh
```

Return:

```text
202 Accepted
```

and enqueue normal workflow.

Manual refresh does not create a second synchronization architecture.

---

# 124. Job Envelope

```ts
type CapitalQJob<T> = {
  id: string;
  type: string;
  jobVersion: number;

  tenantId?: string;

  correlationId?: string;
  causationId?: string;

  createdAt: string;

  attempt?: number;

  data: T;
};
```

---

# 125. Job Type Naming

Use imperative/action names:

```text
evidence.document.process
knowledge.subject.reassess
recommendation.slate.rebuild
notification.delivery.send
integration.connection.sync
```

---

# 126. Job Data Minimality

Job contains IDs/config references, not giant source content.

Worker loads data under service/policy context.

---

# 127. Job Idempotency

Every job defines idempotency key.

Examples:

```text
documentId + processingPipelineVersion
companyId + recommendationFeatureVersion
subjectId + reassessmentVersion
```

---

# 128. Job Retry Class

Each job declares:

```text
retryable errors
max attempts
visibility timeout
backoff policy
DLQ
```

No one global retry policy.

---

# 129. Webhook Boundary

Inbound provider webhook is untrusted external input.

Examples:

```text
/v1/webhooks/cloudflare-stream
/v1/webhooks/google
/v1/webhooks/verification-provider
```

Provider-specific adapters verify it.

---

# 130. Webhook Pipeline

```text
raw HTTP bytes
→ identify provider/config
→ signature verification
→ timestamp/replay check
→ dedupe
→ schema parse
→ persist inbox receipt
→ respond quickly
→ async normalization/domain processing
```

---

# 131. Raw Request Body

Preserve raw bytes when provider signature verification requires exact content.

Do not parse JSON first and then recreate body.

---

# 132. Webhook Response Time

Respond promptly after durable receipt.

Do not run:

- Q analysis;
- embedding;
- recommendation refresh;
- email follow-up;

inside webhook request.

---

# 133. Webhook Inbox

Conceptual:

```text
provider
provider_event_id
received_at
signature_status
payload_hash
processing_status
attempts
error
```

Raw payload storage policy depends sensitivity/need.

---

# 134. Webhook Dedupe

Use provider event ID where reliable.

Duplicate event:

```text
acknowledge
no duplicate domain effect
```

---

# 135. Webhook Normalization

External:

```text
Cloudflare video ready
```

maps to Capital Q:

```text
media.pitch.ready
```

Application consumers never depend on raw Cloudflare payload.

---

# 136. Outbound Webhooks Future

Partners can subscribe to approved integration events.

Subscription includes:

```text
endpoint
event allowlist
secret
status
tenant
```

Do not send every internal event externally.

---

# 137. Outbound Webhook Signing

Use:

- HMAC;
- timestamp;
- event ID.

Document verification.

---

# 138. Outbound Webhook Retry

Transient:

```text
5xx/network/429
```

→ backoff + jitter.

Permanent 4xx:

stop after policy threshold.

Expose delivery status to admin.

---

# 139. Outbound Replay

Manual replay uses same event ID.

Partner should dedupe.

---

# 140. Provider Adapter Principle

Application code uses Capital Q semantics.

Provider adapter handles vendor format.

Examples:

```text
VideoProvider
CalendarProvider
EmailProvider
ModelProvider
EmbeddingProvider
RerankingProvider
IdentityVerificationProvider
```

---

# 141. Adapter Error Mapping

Provider-specific error:

```text
Google 403
DeepSeek 429
Cloudflare error code
```

becomes stable internal classes:

```text
ProviderAuthenticationError
ProviderRateLimitError
ProviderUnavailableError
ProviderValidationError
```

Provider code preserved in private observability.

---

# 142. Adapter Capability Metadata

Not all providers support same features.

Example:

```ts
type CalendarCapabilities = {
  createEvent: boolean;
  reschedule: boolean;
  createConferenceLink: boolean;
  readAvailability: boolean;
};
```

Product can degrade intelligently.

---

# 143. Provider Raw Data

Normalize external records.

Store raw payload only when:

- evidence;
- audit;
- debugging;
- future reprocessing;

justifies it.

Provider payload is not canonical application entity.

---

# 144. Integration Entity

Canonical connection record:

```text
id
tenant_id
provider
connection_type
status
granted_scopes
credential_reference
connected_by
connected_at
last_sync_at
last_error
```

---

# 145. OAuth Start

```text
POST /v1/integrations/:provider/connect
```

Server creates:

- state;
- PKCE challenge;
- intended tenant;
- redirect.

---

# 146. OAuth Callback

Callback:

```text
verify state
verify current session/context
exchange code server-side
store encrypted/token reference
emit integration.connected
```

---

# 147. OAuth State Content

Bind:

```text
nonce
user/session
tenant
provider
return path
expiry
```

Do not trust caller-provided redirect target without allowlist.

---

# 148. Integration Sync

Job:

```text
integration.connection.sync
```

External data normalized into:

- sources;
- meetings;
- portfolio;
- contact;
- evidence;

depending connector.

---

# 149. Disconnect

Flow:

```text
revoke token if possible
mark disconnected
stop sync
emit integration.disconnected
preserve legitimate historical records
```

No silent historical erasure.

---

# 150. Calendar Integration

Capital Q owns capital relationship/meeting semantics.

Calendar provider owns calendar event.

Canonical request:

```ts
type CreateMeetingRequest = {
  relationshipId: string;
  participantRefs: string[];
  startAt: string;
  endAt: string;
  timezone: string;
  providerPreference?: string;
};
```

Provider adapter returns:

```text
externalEventId
joinUrl
calendarUrl
status
```

---

# 151. External Meeting Provider

V1 uses Zoom/Meet/Teams/external meeting systems rather than building native meeting video.

Capital Q stores:

- relationship;
- participants;
- scheduled time;
- provider reference;
- preparation/follow-up intelligence.

---

# 152. Messaging Integration

Capital Q's message/action remains canonical.

External email provider ID is a delivery reference.

Never let:

```text
Gmail message ID
```

be the only relationship communication record.

---

# 153. Outbound Messaging Idempotency

Store:

```text
Capital Q action ID
idempotency key
provider message ID
status
```

Retry must not duplicate outbound email/message.

---

# 154. Public Q Identity Contract

External Q Card/link uses a purpose-built public projection.

Example:

```text
GET /v1/public/q/:shareToken
```

Response contains only approved shareable information.

---

# 155. Public Projection Rule

Do not:

```text
load canonical company record
serialize all
remove private fields
```

Use:

```text
PublicCompanyProjection
```

built from allowed visibility data.

---

# 156. Public Action Escalation

External user can view safe Q identity.

Actions such as:

```text
Ask Q
Save
Express Interest
Request Data Room
Schedule Meeting
```

may require authentication/verification.

API returns structured requirement state.

---

# 157. Integration Events

Examples:

```text
integration.connected
integration.disconnected
integration.sync.completed
integration.sync.failed
```

No tokens/secrets in payload.

---

# 158. Future Partner API

Potential clients:

- accelerators;
- family offices;
- banks;
- institutional platforms.

External partner API gets:

- scoped OAuth/service auth;
- separate rate limit;
- documented version;
- explicit data scope.

Do not expose internal database API as partner API.

---

# 159. External Event Projection

Internal event may contain concepts inappropriate externally.

Create partner event:

```text
capitalq.company.profile.updated
```

with safe contract.

Do not simply forward internal outbox raw payload.

---

# 160. Schema Evolution

Use contract equivalent of database expand-contract.

```text
add compatible fields
→ consumers adopt
→ mark old deprecated
→ remove in major/breaking version
```

---

# 161. Consumer Inventory

Before breaking contract:

identify:

- web;
- q-api;
- workers;
- partner;
- automation;
- test fixtures.

Do not assume an endpoint has only one consumer.

---

# 162. Contract Tests

At minimum:

- schema validates examples;
- producer output validates schema;
- consumer fixtures compile/parse;
- incompatible changes fail CI.

---

# 163. Consumer-Driven Contract Testing

Use selectively for important independently deployed boundaries:

```text
web ↔ api
api ↔ q-api
partner ↔ public API
```

Do not add Pact everywhere if TypeScript monorepo compile-time contracts already provide enough value.

---

# 164. API Client Package

Recommended:

```text
packages/api-client
```

Frontend imports:

```text
capitalQApi.companies.get(...)
```

rather than 200 ad hoc fetch calls.

---

# 165. API Client Responsibilities

- auth token;
- request ID;
- JSON serialization;
- problem parsing;
- safe retry;
- typed response;
- timeout;
- telemetry.

---

# 166. Retry Rules

GET:

may retry transient network/503.

POST/PATCH:

only retry when operation is safely idempotent or uses idempotency key.

Never global retry all HTTP methods.

---

# 167. `Retry-After`

Respect `Retry-After` for:

```text
429
503
```

where server/provider sends it.

---

# 168. Request Timeouts

Normal API requests bounded.

Long Q work:

```text
create run quickly
stream/status separately
```

No 10-minute ordinary POST.

---

# 169. API Rate Limits

Apply by:

- IP;
- actor;
- tenant;
- route;
- cost class.

Q/model routes have stricter budgets than normal metadata GET.

---

# 170. Rate-Limit Errors

Return:

```text
429
RATE_LIMITED
```

and safe retry metadata.

---

# 171. Query Cost Classes

Routes can carry internal class:

```text
CHEAP
NORMAL
EXPENSIVE
MODEL
```

Useful for rate/budget policy.

---

# 172. Caching

Private GET responses conservative.

Public Q projections can be CDN cached.

Personalized recommendation responses must be scoped.

---

# 173. ETag

Where useful:

```text
ETag
If-None-Match
```

for:

- public profiles;
- stable company data.

Not required on every endpoint.

---

# 174. Uploads

Application creates scoped upload session.

Actual bytes go direct to:

- Supabase Storage;
- Cloudflare Stream;

when architecture says so.

Application references:

```text
documentId
mediaAssetId
```

not provider path.

---

# 175. Download

Authorized file retrieval may return:

- short-lived signed URL;
- redirect;
- controlled proxy for special cases.

Permanent storage object URL is not permission.

---

# 176. Supabase Realtime

Realtime can enhance UI for:

- notification counts;
- status;
- presence.

It is not durable institutional event transport.

---

# 177. Why Realtime ≠ Domain Event Backbone

Capital Q needs:

- replay;
- durable queue;
- retry;
- event version;
- outbox;
- worker processing.

Use queues/outbox for business event processing.

---

# 178. Event-Driven Synchronization Example

Founder updates revenue.

```text
PATCH company metric
↓
transaction:
  authoritative metric changes
  core.company.metric_updated event added to outbox
↓
outbox publisher
↓
event consumers
├─ knowledge reassessment
├─ InvestIQ refresh
├─ company discovery projection refresh
├─ recommendation invalidation if material
└─ analytics
```

No module manually calls every other module.

---

# 179. Avoid Event Choreography Chaos

Event-driven does not mean:

```text
everything reacts to everything
```

Each event has known consumers.

Major workflow requiring sequencing may use orchestration/job state.

---

# 180. Event vs Orchestrated Workflow

Use event choreography for:

- independent derived updates.

Use explicit workflow/orchestrator for:

- multi-step process;
- strict sequence;
- compensation;
- approval.

Q action execution is orchestrated.

---

# 181. Cross-Domain Writes

Domain service should not update another domain's tables directly merely because they're in same Postgres.

Use:

- contract/service;
- domain event;
- explicit transactional coordination if true invariant requires.

---

# 182. Same-Transaction Invariants

Some operations genuinely span boundaries.

Example:

```text
relationship interest
+
relationship event
```

may be same domain transaction.

Do not force async events for invariants requiring atomicity.

---

# 183. Integration Consistency

External provider success and Capital Q state can diverge.

Use state machine.

Example meeting:

```text
REQUESTED
PROVIDER_CREATING
SCHEDULED
FAILED
CANCEL_PENDING
CANCELLED
```

Do not pretend external call is atomic with Postgres.

---

# 184. External Side Effect Pattern

```text
persist action intent
→ commit
→ worker/executor calls provider
→ persist provider outcome
→ emit domain event
```

For user-facing fast action, executor may run immediately after persistence but idempotency remains.

---

# 185. Compensating Actions

If external effect succeeded but DB update failed:

reconciliation process detects provider reference/idempotency record.

Do not blindly resend.

---

# 186. Provider Reconciliation

Periodic/specific reconciliation for:

- calendar events;
- video state;
- future payments if ever applicable;
- verification.

Not every provider needs full polling.

---

# 187. Secrets in Contracts

Never include:

- OAuth refresh token;
- API secret;
- service-role key;

in event/API response.

Return references/status only.

---

# 188. PII Minimization

Contracts carry IDs over personal detail unless detail needed by consumer.

Example event:

```text
userId
```

not full email/phone unless event purpose requires it.

---

# 189. Sensitivity Metadata

Internal contract can reference:

```text
sensitivity class
disclosure scope
```

for retrieved/derived content.

Do not trust model-generated sensitivity field without policy validation.

---

# 190. Provenance Contracts

Knowledge/evidence API responses include stable provenance refs.

Example:

```ts
type EvidenceRef = {
  evidenceId: string;
  sourceId: string;
  locator?: SourceLocator;
};
```

Do not expose raw hidden source through unauthorized citation.

---

# 191. Source Locators

Potential:

```text
page
section
paragraph
timestamp
spreadsheet cell/range
```

Contract is typed union.

---

# 192. Q Response Grounding

Q response block may include:

```ts
type QGroundedStatement = {
  text: string;
  truthClass: string;
  confidence?: string;
  evidenceRefs: EvidenceRef[];
};
```

Not every conversational sentence requires explicit object, but material structured results do.

---

# 193. Recommendation Contracts

Recommendation result includes:

```text
recommendationId
slateId
rank
candidate
reasonCodes
rankingVersion
```

Internal score may remain internal.

---

# 194. Feed Interaction Contracts

Examples:

```text
POST /v1/recommendations/:id/save
POST /v1/recommendations/:id/pass
POST /v1/recommendations/:id/interest
```

Analytics impression can use telemetry endpoint.

Business action `interest` is authoritative.

---

# 195. Analytics Ingestion

Analytics can batch:

```text
POST /v1/telemetry/events
```

with bounded known event schemas.

Do not accept arbitrary huge JSON and call it analytics.

---

# 196. Analytics Trust

Client analytics are untrusted observations.

Do not let:

```text
client says investment happened
```

update relationship outcome.

---

# 197. API Security Tests

Every protected endpoint tests:

```text
unauthenticated
wrong tenant
wrong role
wrong object
correct user
```

Q endpoint additionally:

```text
context firewall
tool authority
```

---

# 198. Contract Fuzzing

For trust boundaries:

- invalid strings;
- huge numbers;
- malformed IDs;
- unknown enums;
- oversized arrays;
- extra properties where prohibited.

Zod rejects safely.

---

# 199. Strict Schemas

External inbound schemas generally use:

```text
strict object
```

where unexpected fields are suspicious.

For intentionally extensible formats, allow known extension mechanism.

---

# 200. Payload Limits

Every route has bounded body size.

Examples:

- Q text;
- webhook;
- JSON update;
- analytics batch.

Files use file-upload infrastructure, not huge JSON base64.

---

# 201. Text Length Limits

Open-text inputs define sane max.

This is:

- security;
- model cost;
- UX.

Do not allow 20MB onboarding text.

---

# 202. Contract Observability

Metrics:

```text
validation failure by endpoint
unknown event version
webhook signature failure
idempotency replay
idempotency conflict
API p95
SSE reconnect rate
event DLQ
consumer lag
provider error mapping
```

---

# 203. Contract Breaking-Change CI

CI compares generated OpenAPI/event schemas.

Breaking change requires:

- explicit acknowledgement;
- version/migration plan.

Use tooling available at implementation time.

---

# 204. Contract Snapshot Tests

High-value schemas stored as snapshots/examples.

Review unexpected diff.

---

# 205. Golden Integration Fixtures

For each provider:

```text
valid webhook
duplicate webhook
invalid signature
new optional field
error response
rate limit
```

Adapter tests use fixtures.

---

# 206. No Live Provider Required for Every Unit Test

Mock at adapter boundary.

Use sandbox integration test separately.

---

# 207. Q Tool Contract Tests

For every tool:

```text
valid input
invalid input
wrong tenant
insufficient permission
approval required
idempotency
provider failure
safe output
```

---

# 208. Event Consumer Tests

For every material consumer:

```text
valid event
duplicate
out-of-order if applicable
unsupported version
missing resource
retryable failure
permanent failure
```

---

# 209. Webhook Tests

Must include:

- signature;
- replay;
- duplicate;
- malformed JSON;
- oversized payload;
- provider status transition.

---

# 210. API Documentation

Generated developer documentation should show:

- auth;
- request;
- response;
- errors;
- examples;
- idempotency;
- concurrency expectations.

Do not make developers inspect implementation code to discover semantics.

---

# 211. Internal API Docs

Even internal endpoints documented if independently deployed.

This reduces agent/team coupling.

---

# 212. Public Partner Docs Future

Partner-facing docs are curated subset.

Never publish internal endpoints accidentally from same OpenAPI file without visibility filtering.

---

# 213. Contract Naming Style

TypeScript:

```text
PascalCase types
camelCase fields
UPPER_SNAKE enum values where domain convention benefits
```

HTTP JSON:

```text
camelCase
```

Database remains snake_case.

Adapters map explicitly.

---

# 214. Do Not Leak DB Naming

API response:

```text
investorOrganisationId
```

not:

```text
investor_org_id
```

unless external API convention deliberately chooses snake_case.

---

# 215. Nullable vs Optional

Meaning must be clear.

```text
optional = field omitted/not requested/not applicable
null = known empty/no value
```

Do not interchange randomly.

---

# 216. Unknown vs Zero

Critical investment data:

```text
revenue: null
```

is not:

```text
revenue: 0
```

Contract preserves missingness.

---

# 217. Boolean Ambiguity

Avoid booleans where domain has more states.

Bad:

```text
verified: true/false
```

when actual:

```text
NOT_STARTED
PENDING
VERIFIED
FAILED
EXPIRED
```

Use state enum.

---

# 218. Relationship Semantics

Do not use:

```text
matched: boolean
```

as sole relationship model.

Current relationship state and history remain richer.

---

# 219. Permission Semantics

Do not use:

```text
canAccess: true
```

without access level when relevant.

Use:

```text
NONE
VIEW
DOWNLOAD
EDIT
ADMIN
```

or capability checks.

---

# 220. Contract Localization

Internal enums remain language-independent.

UI maps:

```text
VIEW_ONLY
```

to human copy.

Do not store translated user-facing string as domain value.

---

# 221. API Time Zones

Scheduling request includes:

```text
startAt UTC
timezone IANA name
```

where human scheduling semantics need original timezone.

Do not store only local text.

---

# 222. API Currency

Always ISO 4217 currency code where standard currency.

Example:

```text
NGN
USD
GBP
```

No `₦` as canonical value.

---

# 223. Geography

Use canonical geography IDs/codes.

Do not make free text the only filter input.

Raw user language can be preserved separately.

---

# 224. Taxonomy

API references stable taxonomy node IDs.

Display labels can change/version.

Do not use label as identity.

---

# 225. Taxonomy Version

Classification response:

```text
taxonomyVersion
```

where reproducibility matters.

---

# 226. Knowledge Contract

Knowledge object response includes:

```text
id
type
subject
truthClass
confidence
validity
source/provenance refs
visibility
current/superseded state
```

Not just string.

---

# 227. Memory Contract

Memory proposal differs from accepted institutional memory.

Use state:

```text
PROPOSED
CONFIRMED
ACTIVE
SUPERSEDED
REVOKED
```

Do not let model response write directly.

---

# 228. Delete / Revoke / Archive

API uses distinct commands where semantics differ.

Avoid one:

```text
DELETE everything
```

when business needs:

- revoke access;
- archive objective;
- forget memory;
- delete owned source.

---

# 229. API Compatibility With Coding Agents

Agents must use existing schemas.

If schema missing:

1. search registry;
2. identify owner;
3. propose contract;
4. add schema/tests/docs;
5. then implement producer/consumer.

No ad hoc inline DTO.

---

# 230. Event Compatibility With Coding Agents

Before emitting:

```text
company.updated
```

agent checks whether it already exists.

Do not invent:

```text
company.changed
company.profile_changed
company_info_updated
```

for same concept.

---

# 231. Integration Compatibility With Agents

Provider adapter must conform to internal interface.

Agent cannot import vendor SDK directly into domain package just because it's quicker.

---

# 232. Contract Preflight

Before implementing an endpoint/event/integration:

1. owning bounded context;
2. actor;
3. tenant;
4. purpose;
5. request schema;
6. response schema;
7. authorization;
8. idempotency;
9. concurrency;
10. error codes;
11. event(s) emitted;
12. jobs triggered;
13. privacy/sensitivity;
14. version;
15. downstream consumers;
16. tests;
17. rollback/evolution.

---

# 233. Contract Postflight

Required:

```text
schema exported
runtime validation
type inference
OpenAPI/codegen updated
examples validate
auth tests
tenant tests
idempotency tests
concurrency tests
problem-details errors
event catalogue updated
consumer tests
no raw provider leakage
no secret leakage
documentation updated
```

---

# 234. API Anti-Patterns Prohibited

## 234.1 Raw DB row as API response

Rejected.

## 234.2 Generic `data: any`

Rejected.

## 234.3 One `/action` endpoint

Rejected.

## 234.4 Client supplies trusted role/tenant

Prohibited.

## 234.5 Floating-point money

Rejected.

## 234.6 Offset pagination for large mutable feed

Rejected.

## 234.7 Unbounded list endpoint

Rejected.

## 234.8 Long model job inside ordinary POST

Rejected.

## 234.9 Different error shape per endpoint

Rejected.

## 234.10 Automatic POST retry without idempotency

Rejected.

## 234.11 Versioning by file-copy (`api-new-final2`)

Rejected.

---

# 235. Event Anti-Patterns Prohibited

## 235.1 Event and job are same concept

Rejected.

## 235.2 `something.updated` with full private aggregate attached

Rejected.

## 235.3 Event has no version

Rejected.

## 235.4 Event producer dual-writes DB and broker separately

Rejected.

## 235.5 Consumer assumes exactly once

Rejected.

## 235.6 Global ordering dependency

Rejected unless explicit infrastructure introduced.

## 235.7 Analytics event drives canonical relationship state

Prohibited.

## 235.8 Replaying event resends external message

Prohibited.

## 235.9 Audit log used as event bus

Rejected.

## 235.10 Every keystroke treated as institutional event

Rejected.

---

# 236. Integration Anti-Patterns Prohibited

## 236.1 Provider SDK imported directly across domain code

Rejected.

## 236.2 OAuth token in browser/local storage

Prohibited.

## 236.3 Raw webhook trusted before signature

Prohibited.

## 236.4 Webhook request performs heavy Q processing synchronously

Rejected.

## 236.5 Duplicate webhook causes duplicate side effect

Prohibited.

## 236.6 Gmail/Google/Cloudflare ID becomes canonical entity ID

Rejected.

## 236.7 Provider failure message exposed raw to user

Rejected.

## 236.8 One integration gets unrestricted tenant access

Rejected.

## 236.9 MCP tool automatically trusted because it is connected

Prohibited.

---

# 237. Architecture Decisions Locked by This Document

## AEC-001

Capital Q contracts are code-first using TypeScript + Zod.

## AEC-002

Generated OpenAPI/AsyncAPI/JSON Schema artifacts derive from runtime contract sources where practical.

## AEC-003

HTTP API major version is represented with `/v1`.

## AEC-004

HTTP resource semantics use domain vocabulary rather than database-table vocabulary.

## AEC-005

Explicit domain command endpoints are allowed/preferred over generic CRUD when business semantics require.

## AEC-006

There is no generic all-purpose action endpoint.

## AEC-007

HTTP errors use RFC 9457 Problem Details-compatible JSON plus stable Capital Q error codes.

## AEC-008

Sensitive implementation detail never appears in public error responses.

## AEC-009

Request ID, correlation ID and causation ID are distinct concepts.

## AEC-010

Actor/tenant authority is derived/verified server-side.

## AEC-011

Exact money is not transported as floating-point business value.

## AEC-012

Large mutable collections use cursor pagination.

## AEC-013

Purpose-built projections prevent one oversized universal Company/Investor DTO.

## AEC-014

Optimistic concurrency/version controls protect concurrently editable consequential resources.

## AEC-015

Consequential POST operations use Capital Q's documented `Idempotency-Key` convention.

## AEC-016

Same idempotency key with a different payload is a conflict.

## AEC-017

Q is exposed through versioned independent API contracts.

## AEC-018

Q V1 uses SSE for server-to-browser run streaming.

## AEC-019

Important Q events are durable; SSE is transport rather than source of truth.

## AEC-020

SSE supports resumable delivery with event IDs/Last-Event-ID semantics.

## AEC-021

Q streaming never exposes hidden chain-of-thought.

## AEC-022

Q actions persist exact proposed payload and payload hash before approval.

## AEC-023

Changed Q action payload invalidates prior approval.

## AEC-024

Q tools are typed/versioned deterministic capability contracts.

## AEC-025

Q has no unrestricted raw SQL/shell/general network tool.

## AEC-026

Voice uses the same Q run/message/action contract model as text.

## AEC-027

Domain events describe facts that already occurred.

## AEC-028

Jobs describe work to perform and remain distinct from events.

## AEC-029

Capital Q uses a canonical versioned CloudEvents-inspired event envelope.

## AEC-030

Event types follow context/entity/past-tense naming.

## AEC-031

Event payloads are minimal and sensitivity-aware.

## AEC-032

Tenant/actor/correlation/causation metadata is explicit where applicable.

## AEC-033

Every event type has explicit event version and owner.

## AEC-034

A repository event catalogue prevents synonymous event proliferation.

## AEC-035

AsyncAPI 3.1 is used to document stable event channels when useful, but is not an MVP blocker.

## AEC-036

Transactional outbox prevents database/event dual-write inconsistency.

## AEC-037

Event delivery is treated as at-least-once and consumers are idempotent.

## AEC-038

Global event ordering is not assumed.

## AEC-039

Per-aggregate sequence/version is used when order matters.

## AEC-040

Replay behavior is explicit and must not repeat external side effects.

## AEC-041

Analytics events, audit records, domain events and jobs are separate concepts.

## AEC-042

Only material business events trigger institutional-intelligence workflows.

## AEC-043

Manual refresh uses the same normal asynchronous synchronization pipeline.

## AEC-044

Job messages are versioned and idempotent.

## AEC-045

Inbound webhooks are verified, deduplicated, durably received and normalized before domain use.

## AEC-046

External webhook shapes do not propagate into domain architecture.

## AEC-047

External providers are isolated behind Capital Q adapter contracts.

## AEC-048

Provider-specific error formats map to stable internal errors.

## AEC-049

Integration credentials remain server-side and are referenced rather than copied through contracts.

## AEC-050

OAuth connections use state/PKCE/server-side token exchange and explicit tenant binding.

## AEC-051

Meeting/calendar provider records remain external references; Capital Q relationship state stays canonical.

## AEC-052

External messaging provider IDs are delivery references, not Capital Q relationship truth.

## AEC-053

Public/shareable Q identity uses a purpose-built safe projection.

## AEC-054

Future partner APIs receive scoped/versioned contracts rather than internal database access.

## AEC-055

Contract evolution follows additive expand/support/deprecate/contract discipline.

## AEC-056

Contract breaking changes are detected/reviewed in CI.

## AEC-057

Frontend uses a typed API client layer rather than scattered raw HTTP calls.

## AEC-058

Retries are method/idempotency aware rather than globally automatic.

## AEC-059

Supabase Realtime may support transient UI updates but is not Capital Q's durable domain-event backbone.

## AEC-060

Cross-domain synchronization occurs through canonical writes/events/workflows rather than modules manually mutating each other's state.

---

# 238. Current Standards Validation — September 2026

These references validate contract mechanics; Capital Q product semantics remain authoritative.

## OpenAPI

The current published OpenAPI specification is:

```text
3.2.0
```

published September 19, 2025.

Reference:

- https://spec.openapis.org/oas/latest.html

Capital Q therefore uses OpenAPI 3.2 as its architecture target while allowing tool-specific generation compatibility.

## AsyncAPI

AsyncAPI 3.1.0 was released January 31, 2026.

AsyncAPI describes message-driven APIs in a machine-readable, protocol-agnostic format and supports defining channels, messages and operations.

References:

- https://www.asyncapi.com/docs/reference/specification/v3.1.0
- https://www.asyncapi.com/blog/release-notes-3.1.0

## RFC 9457

RFC 9457 defines Problem Details for HTTP APIs and obsoletes RFC 7807.

Reference:

- https://www.rfc-editor.org/rfc/rfc9457.html

Capital Q uses it as the baseline HTTP error envelope with application-specific extension members.

## CloudEvents

The latest stable CloudEvents core specification remains v1.0.2.

CloudEvents exists specifically to normalize event context across systems and defines concepts including:

```text
id
source
specversion
type
subject
time
datacontenttype
data
```

Reference:

- https://github.com/cloudevents/spec

Capital Q borrows these semantics while adding tenant, actor, event version and causation metadata.

## Server-Sent Events

The WHATWG HTML standard defines:

```text
text/event-stream
EventSource
event
data
id
retry
Last-Event-ID
```

and browser reconnection semantics.

Reference:

- https://html.spec.whatwg.org/multipage/server-sent-events.html

Capital Q uses these semantics for resumable Q streaming.

## Idempotency-Key

The IETF HTTPAPI working group has developed an `Idempotency-Key` header specification, with draft-07 published in October 2025.

As of September 2026 it remains an expired Internet-Draft rather than a final RFC.

Reference:

- https://datatracker.ietf.org/doc/draft-ietf-httpapi-idempotency-key-header/

Capital Q therefore adopts the header as an explicit internal/public API convention rather than falsely claiming final standards status.

---

# 239. Final Contract Rule

Capital Q is intentionally modular.

Modularity becomes technical debt if modules communicate through undocumented assumptions.

The required model is:

```text
USER ACTION
    ↓
TYPED API COMMAND
    ↓
AUTHORITATIVE DOMAIN TRANSACTION
    ↓
AUDIT + OUTBOX
    ↓
VERSIONED DOMAIN EVENT
    ↓
DURABLE JOBS / CONSUMERS
    ↓
DERIVED INTELLIGENCE / PROJECTIONS
    ↓
TYPED API / Q RESPONSE
```

and for external systems:

```text
EXTERNAL PROVIDER
    ↓
VERIFIED WEBHOOK / ADAPTER
    ↓
NORMALIZED CAPITAL Q CONTRACT
    ↓
DOMAIN STATE
```

and for Q:

```text
Q INTENT
    ↓
TYPED TOOL
    ↓
DETERMINISTIC AUTHORIZATION
    ↓
APPROVAL IF REQUIRED
    ↓
IDEMPOTENT EXECUTION
    ↓
AUDIT + DOMAIN EVENT
```

No component should need to know another component's internal tables, provider SDK quirks or hidden assumptions.

That is the contract architecture that allows Capital Q to move quickly now while still being able to:

- split services;
- replace providers;
- add native/mobile clients;
- add partner APIs;
- add integrations;
- evolve Q;
- replay intelligence;
- change schemas;
- scale workers;

without rebuilding the product from scratch.
