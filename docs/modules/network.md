# Network module (`@capital-q/network`)

**Purpose.** The capital-relationship spine: exactly one canonical
relationship per Company ↔ Investor Organisation pair, with an append-only,
sequence-ordered, visibility-scoped history. Discover, GateQ, search,
recommendations, Q, Interest, Match, meetings, diligence and investment
activity all converge on the same `RelationshipId`; nothing creates a
parallel pipeline, deal or CRM record.

**Invariant.** Relationship ≠ Recommendation ≠ Feed impression ≠ Save ≠
Interest ≠ Match ≠ Deal ≠ Outcome. `current_state` ≠ history. Relationship
existence ≠ disclosure permission. History ≠ audit ≠ outbox ≠ Q memory.
`RelationshipId` and `RelationshipEventId` are their own branded ids.

## Canonical pair

`UNIQUE (company_id, investor_organisation_id)` on `network.relationships`.
No source, capital objective or tenant is in the key: Company A + Apex via
Discover, via GateQ, via Q, during a seed raise or a later Series A, with
Sarah or with David as representative, is one row. `first_discovered_at` is
set once and never moves forward. `ensureRelationship` returns the existing
row untouched; concurrent first creators are serialised by a pair advisory
lock and the unique constraint, and exactly one origin event, audit record
and domain event result.

## Tenant anchor (ADR 0003)

`relationships.tenant_id` is the **company's** tenant, enforced by
`FOREIGN KEY (company_id, tenant_id)`; the investor organisation may live in
another tenant. This is a V1 storage anchor, not the access model: it does
not make the relationship company-only, and the investor side never gets a
duplicate row. Party and disclosure access semantics arrive with
CQ-PERM-001; until then both tables are server-internal (RLS enabled, no
policies, no `anon`/`authenticated` grants, no HTTP API). A single-tenant
browser policy would block the investor side forever and is rejected.

## Schema

`network.relationships`: `id`, `tenant_id`, `company_id`,
`investor_organisation_id`, `current_state` (bounded text, `DISCOVERED`
only for now), `state_updated_at`, `first_discovered_at`,
`last_event_sequence`, `created_at`; UNIQUE pair; UNIQUE `(id, tenant_id)`;
indexes `(company_id, created_at desc)`, `(investor_organisation_id,
created_at desc)`, `(tenant_id, company_id)`, `(current_state,
state_updated_at)`.

`network.relationship_events`: `id`, `tenant_id`, `relationship_id`,
`sequence` (bigint ≥ 1), `event_type` (bounded lower_snake), `occurred_at`,
`actor_type` (HUMAN | Q | SYSTEM | CONNECTED_SYSTEM), `actor_id` (a HUMAN's
UserId), `source_type` (DISCOVER | GATEQ | SEARCH | RECOMMENDATION | Q |
MANUAL | SYSTEM), `source_id` (opaque ≤ 256), `visibility_scope` (ADR-001
eight values), `payload` (typed object ≤ 8 KiB), `correlation_id`,
`created_at`; UNIQUE `(relationship_id, sequence)`; FK `(relationship_id,
tenant_id)`; indexes `(relationship_id, occurred_at)`, `(tenant_id,
relationship_id)`, `(event_type, occurred_at)`, `(correlation_id)`. No
`updated_at`, no `deleted_at`: corrections are later events.

## Ordering

Sequences are allocated by `UPDATE relationships SET last_event_sequence =
last_event_sequence + 1 … RETURNING`, which takes the row lock, so concurrent
appenders serialise and every committed sequence is unique; a rolled-back
transaction releases its number, so committed sequences are also gapless.
Timestamps are never the ordering key.

## Event registry, visibility, payloads

`createRelationshipEventRegistry` validates type, allowed visibility scopes
and payload schema before append. The foundation registers `discovered`
only (payload `{ sourceReference? }`, allowed scopes personal_private,
organisation_private, founder_private, investor_private). There is no
default scope: the owning workflow states it, and discovery can never be
`relationship_shared`, so an investor's private browsing never becomes
"Apex viewed your company". Later packets register their own types; no
type ever escalates its scope by rule. Payloads are small typed references,
never documents, transcripts, messages, tokens or prompts.

## Current state

`current_state` is a derived projection. This packet writes `DISCOVERED`
at creation and nothing else; no state setter exists in the repositories or
the package exports. CQ-NET-012 will replay the ordered history to compute
later states without touching it.

## Application surface

`ensureRelationship` (internal, transactional: resolve both parties through
the public query ports, return or atomically create the pair with sequence-1
`discovered`, audit `relationship.created`, outbox
`network.relationship.created@1` INTERNAL), the `RelationshipEventAppender`
(validated append inside the caller's transaction) and the permission-neutral
`RelationshipQueryPort` (`getById`, `findByParties`, `listEvents`). No HTTP
route exists; CQ-NET-010/011 call these after their own authorisation and
CQ-PERM-001 decides what each party may see.

## Deferred

`network.interests` (CQ-NET-010), `network.matches` (CQ-NET-011), the state
projector (CQ-NET-012), disclosure (CQ-PERM-001), GateQ, meetings
(CQ-MTG-001), messaging (CQ-COMM-001), diligence, commitments, investment
outcomes, Data Room, relationship UI and Q.
