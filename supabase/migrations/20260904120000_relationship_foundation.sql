-- CQ-NET-001 · Relationship schema foundation
--
-- One canonical relationship per Company ↔ Investor Organisation pair (doc
-- 13 network domain, doc 22 ordered relationship events) plus its
-- append-only, sequence-ordered, visibility-scoped event history. Every
-- later network workflow -- Discover, GateQ, Interest, Match, meetings,
-- diligence, commitments -- converges on this row; none creates a parallel
-- pipeline, deal or CRM record.
--
-- Kept apart, permanently:
--
--   Relationship ≠ Recommendation ≠ Feed impression ≠ Save ≠ Interest
--   ≠ Match ≠ Deal ≠ Outcome; current_state ≠ authoritative history
--
-- Tenant anchor (ADR 0003): relationship.tenant_id is the COMPANY's tenant,
-- a V1 storage anchor enforced relationally. It is not the access model: a
-- relationship is cross-party state that may span two tenants, and the
-- investor side is never given a duplicate row in its own tenant. Until
-- CQ-PERM-001 establishes party/disclosure semantics, both tables are
-- server-internal: RLS enabled, no policies, no client grants.

create schema if not exists network;
comment on schema network is
  'Capital relationship graph: canonical Company ↔ Investor Organisation relationships and their history. Server-internal until CQ-PERM-001.';
revoke all on schema network from public;

-- ---------------------------------------------------------------------------
-- network.relationships
-- ---------------------------------------------------------------------------

create table network.relationships (
  id                        uuid primary key default gen_random_uuid(),
  -- The company's tenant (ADR 0003). A storage anchor, never bilateral authorization.
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  company_id                uuid not null,
  investor_organisation_id  uuid not null references core.investor_organisations (id) on delete restrict,

  -- Derived projection of the ordered history, never the history itself.
  -- Only DISCOVERED is written by this foundation; CQ-NET-012 owns the
  -- projector and its vocabulary. Bounded text, no enum.
  current_state             text not null default 'DISCOVERED'
                              check (current_state ~ '^[A-Z][A-Z_]{0,31}$'),
  state_updated_at          timestamptz not null default clock_timestamp(),
  -- Earliest material network origin of the pair. Set once; never moved
  -- forward because the pair later meets through another channel.
  first_discovered_at       timestamptz not null default clock_timestamp(),
  -- Ordering aid for the history (doc 22): the next event sequence is
  -- allocated by incrementing this under the row lock.
  last_event_sequence       bigint not null default 0 check (last_event_sequence >= 0),
  created_at                timestamptz not null default clock_timestamp(),

  -- ONE relationship per canonical pair. No source, no capital objective, no
  -- tenant in the key.
  unique (company_id, investor_organisation_id),
  -- Tenant anchor coherence: the row's tenant is the company's tenant.
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict,
  unique (id, tenant_id)
);

comment on table network.relationships is
  'The one canonical relationship per Company ↔ Investor Organisation pair. current_state is a derived projection; network.relationship_events is the history. tenant_id is the company tenant (ADR 0003), not the access model.';
comment on column network.relationships.current_state is
  'Derived projection. Only DISCOVERED exists in CQ-NET-001; CQ-NET-012 replays the history to compute later states. Never patched directly.';
comment on column network.relationships.first_discovered_at is
  'Earliest material origin of the pair. Immutable after creation.';

create index relationships_company_created_idx
  on network.relationships (company_id, created_at desc);
create index relationships_investor_created_idx
  on network.relationships (investor_organisation_id, created_at desc);
create index relationships_tenant_company_idx
  on network.relationships (tenant_id, company_id);
create index relationships_state_updated_idx
  on network.relationships (current_state, state_updated_at);

alter table network.relationships enable row level security;
-- No policies and no client grants: server-internal until CQ-PERM-001.

-- ---------------------------------------------------------------------------
-- network.relationship_events
-- ---------------------------------------------------------------------------

create table network.relationship_events (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  relationship_id   uuid not null,
  -- Deterministic per-relationship order (doc 22). Timestamps alone are not
  -- enough: events may share an instant or arrive concurrently.
  sequence          bigint not null check (sequence >= 1),
  -- Bounded, versionable name. No enum: later packets add their own types
  -- through the Network event registry.
  event_type        text not null check (event_type ~ '^[a-z][a-z0-9_]*$' and length(event_type) <= 64),
  occurred_at       timestamptz not null default clock_timestamp(),
  -- Canonical actor vocabulary; a HUMAN actor_id is the Person (UserId).
  actor_type        text not null check (actor_type in ('HUMAN', 'Q', 'SYSTEM', 'CONNECTED_SYSTEM')),
  actor_id          uuid not null,
  -- Provenance only. Never part of relationship identity.
  source_type       text not null check (source_type in (
                      'DISCOVER', 'GATEQ', 'SEARCH', 'RECOMMENDATION', 'Q', 'MANUAL', 'SYSTEM')),
  source_id         text check (source_id is null or (length(source_id) between 1 and 256 and source_id !~ '[[:cntrl:]]')),
  -- ADR-001 disclosure vocabulary, stored faithfully so the Context Firewall
  -- can filter before any model sees history. Never defaulted to shared.
  visibility_scope  text not null check (visibility_scope in (
                      'personal_private', 'organisation_private', 'founder_private',
                      'investor_private', 'relationship_shared', 'specifically_shared',
                      'network_visible', 'public_external')),
  -- Small typed reference data validated by the Network registry. Never a
  -- document, transcript, message thread, token or prompt.
  payload           jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(payload) = 'object' and length(payload::text) <= 8192),
  correlation_id    text not null check (correlation_id ~ '^cor_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
  created_at        timestamptz not null default clock_timestamp(),

  unique (relationship_id, sequence),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.relationship_events is
  'Append-only, sequence-ordered history of a relationship. Authoritative source for state projection (CQ-NET-012). Not audit, not the outbox, not analytics, not Q memory.';
comment on column network.relationship_events.visibility_scope is
  'ADR-001 scope chosen by the owning workflow. A relationship existing does not make its events relationship_shared.';

-- (relationship_id, sequence) is served by the unique constraint's index.
create index relationship_events_relationship_time_idx
  on network.relationship_events (relationship_id, occurred_at);
create index relationship_events_tenant_relationship_idx
  on network.relationship_events (tenant_id, relationship_id);
create index relationship_events_type_time_idx
  on network.relationship_events (event_type, occurred_at);
create index relationship_events_correlation_idx
  on network.relationship_events (correlation_id);

alter table network.relationship_events enable row level security;
-- No policies and no client grants: server-internal until CQ-PERM-001.
