-- A minimal diligence area (post-meeting audit item 5, 2026-10-02; doc 10:
-- a minimal gated document area; Product Specification: a shared Due
-- Diligence Workspace "whenever due diligence formally begins").
--
-- What is shared is NOT stored here: a founder shares one of their own
-- documents with one relationship as a disclosure policy (permissions.
-- disclosure_policies, resource_type 'document', relationship_shared, the
-- relationship as recipient), revocable like any other. No looser rule.
--
-- This migration holds the investor's requests and how each was answered:
--
--   network.diligence_requests      what the investor asked for (append-only)
--   network.diligence_fulfilments   which share answered which request
--                                   (append-only; a request is fulfilled when
--                                   a row exists)
--
-- Server-only, like the rest of network: both sides read them through the
-- server, which decides the party from Network's own per-party view.

create table network.diligence_requests (
  id                     uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (the company's, ADR 0003), like the history.
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  relationship_id        uuid not null,
  requested_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  title                  text not null check (length(title) between 1 and 200 and title !~ '[[:cntrl:]]'),
  note                   text check (note is null or length(note) between 1 and 1000),
  idempotency_key        text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at             timestamptz not null default clock_timestamp(),
  unique (requested_by_user_id, idempotency_key),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table network.diligence_requests is
  'A document an investor asked for in diligence. Append-only; fulfilled when a network.diligence_fulfilments row names it.';

create index diligence_requests_relationship_idx
  on network.diligence_requests (relationship_id, created_at);

create table network.diligence_fulfilments (
  request_id             uuid primary key references network.diligence_requests (id) on delete restrict,
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  -- The share that answered it: a disclosure policy on the document.
  disclosure_policy_id   uuid not null references permissions.disclosure_policies (id) on delete restrict,
  document_id            uuid not null,
  fulfilled_by_user_id   uuid not null references identity.user_profiles (id) on delete restrict,
  created_at             timestamptz not null default clock_timestamp()
);

comment on table network.diligence_fulfilments is
  'Which shared document answered an investor''s diligence request. Append-only; one per request.';

-- History is the rows: nothing is ever updated or deleted.
create function private.network_diligence_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = '55000';
end
$$;

revoke all on function private.network_diligence_append_only() from public, anon, authenticated;

create trigger diligence_requests_append_only
  before update or delete on network.diligence_requests
  for each row execute function private.network_diligence_append_only();

create trigger diligence_fulfilments_append_only
  before update or delete on network.diligence_fulfilments
  for each row execute function private.network_diligence_append_only();

-- Server-only: RLS on as a second layer, no policies, no client grants.
alter table network.diligence_requests enable row level security;
alter table network.diligence_fulfilments enable row level security;

-- The other side hears about a request or a shared document.
alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE'));
