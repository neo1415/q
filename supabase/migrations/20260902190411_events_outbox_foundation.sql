-- CQ-DATA-003 · Transactional outbox and domain-events queue
--
-- One durable path from a material business change to asynchronous work:
--
--   application transaction:  domain mutation + events.outbox insert  → COMMIT
--   outbox publisher:         claim pending row → pgmq.send → published_at
--   future consumers:         pgmq.read → validate → process → archive
--
-- The outbox row is a pending-publication record. The queue message is a
-- delivery copy of the canonical CapitalQEvent. Neither is audit history and
-- neither is a job; those remain separate concepts (AEC-041).

-- Supabase Queues. pgmq owns its own schema and tables; nothing here creates
-- or alters pgmq internals directly.
create extension if not exists pgmq;

create schema if not exists events;
comment on schema events is
  'Event infrastructure: the transactional outbox. Server-only; never exposed through the Data API.';
revoke all on schema events from public;

-- ---------------------------------------------------------------------------
-- events.outbox
-- ---------------------------------------------------------------------------

create table events.outbox (
  id             bigint generated always as identity primary key,
  -- The canonical EventId. Unique so a retried application command cannot
  -- persist the same event twice.
  event_id       uuid not null unique,
  -- Null for platform events; required by tenant-owned event definitions.
  -- Not authority: a consumer still verifies the resource it loads belongs to
  -- this tenant.
  tenant_id      uuid references identity.tenants (id) on delete restrict,
  -- Denormalised from the envelope for querying and operations; always
  -- derived from the validated payload, never supplied separately.
  event_type     text not null,
  event_version  integer not null check (event_version >= 1),
  -- The complete canonical CapitalQEvent, so the publisher validates the
  -- exact envelope that was committed rather than a reconstruction.
  payload        jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at     timestamptz not null default now(),
  available_at   timestamptz not null default now(),
  -- Set when the queue accepted the event. Says nothing about consumers.
  published_at   timestamptz,
  attempt_count  integer not null default 0 check (attempt_count >= 0),
  -- Bounded, sanitised failure code + short reason. Never payload, secrets
  -- or stack traces.
  last_error     text check (last_error is null or length(last_error) <= 500),
  check (available_at >= created_at),
  check (published_at is null or published_at >= created_at)
);

comment on table events.outbox is
  'Pending publication state for canonical domain events. PENDING: published_at is null and attempts remain. PUBLISHED: published_at set. STUCK: published_at null and attempts exhausted. Not an audit log; published rows may be archived after an operational retention period.';

-- The publisher's claim: pending rows in creation order.
create index outbox_pending_idx
  on events.outbox (id)
  where published_at is null;

create index outbox_tenant_idx
  on events.outbox (tenant_id)
  where tenant_id is not null;

-- Internal infrastructure: no client role reads, writes or sees it. RLS is
-- enabled with no policies as a second layer beneath the absent grants.
alter table events.outbox enable row level security;

-- ---------------------------------------------------------------------------
-- domain-events queue
-- ---------------------------------------------------------------------------

-- Durable (logged) queue. Business events are never worth losing for
-- throughput, so create_unlogged is deliberately not used.
select pgmq.create('domain-events');

-- pgmq grants EXECUTE on its functions to PUBLIC by default. The queue is
-- server infrastructure reached through the worker's PostgreSQL connection;
-- no client role may send, read or archive.
revoke all on all functions in schema pgmq from public, anon, authenticated;
revoke all on all tables in schema pgmq from public, anon, authenticated;
