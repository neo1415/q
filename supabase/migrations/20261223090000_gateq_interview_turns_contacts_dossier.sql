-- GateQ slice 1 (2026-10-13 directive) · the adaptive interview's durable
-- transcript, the applicant's confirmed contact, and the dossier frozen with
-- the submission.
--
--   transcript ≠ facts;  a turn is what was said, a fact is what was recorded
--   contact ≠ membership;  a confirmed email is reachability, not an account
--   dossier ≠ decision;  a deterministic brief, never a verdict
--
-- Additive only. The guest session's single last-turn slot
-- (20261003090000) keeps working beside the new table; nothing is dropped,
-- and the submission's immutability trigger is untouched because the two new
-- submission columns are written at INSERT and never again.

-- ---------------------------------------------------------------------------
-- The interview transcript: append-only, ordered, idempotent per exchange.
-- ---------------------------------------------------------------------------

create table gateq.application_turns (
  id                uuid primary key default gen_random_uuid(),
  -- Restrict, not cascade: a transcript that was submitted is part of what
  -- the organisation received, and the append-only trigger would refuse a
  -- cascaded delete anyway.
  application_id    uuid not null references gateq.applications (id) on delete restrict,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  -- Order within the application, assigned by the server under a row lock
  -- on the application. Never a client value.
  seq               integer not null check (seq >= 1),
  role              text not null check (role in ('PERSON', 'Q')),
  text              text not null check (length(text) between 1 and 4000),
  -- The applicant's own idempotency key for the exchange (or 'opening' for
  -- Q's first line). An identifier, never authority.
  client_turn_id    text not null check (length(client_turn_id) between 1 and 128),
  -- Q turns only: which bounded application dimension Q asked about, and the
  -- model's reading of the person's turn. Both validated in the service
  -- against closed vocabularies before they are written.
  asking_dimension  text check (asking_dimension is null or asking_dimension ~ '^[a-z][a-z0-9_.]{0,63}$'),
  intent            text check (intent is null or intent ~ '^[A-Z][A-Z_]{0,39}$'),
  created_at        timestamptz not null default clock_timestamp(),

  unique (application_id, seq),
  -- One row per role per exchange: a retried turn writes nothing new.
  unique (application_id, client_turn_id, role),
  check (role = 'Q' or (asking_dimension is null and intent is null))
);

comment on table gateq.application_turns is
  'Append-only transcript of a GateQ applicant''s interview with Q, both sides, in order. A display and audit record of what was said; facts are recorded separately with their provenance and nothing here is a fact.';

create index application_turns_by_application_idx
  on gateq.application_turns (application_id, seq desc);

-- The turn's tenant is its application's tenant, always.
create or replace function gateq.application_turn_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.applications a
     where a.id = new.application_id and a.tenant_id = new.tenant_id
  ) then
    raise exception 'a turn belongs to its application''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_turn_tenant_matches() from public;

create trigger application_turns_tenant
  before insert on gateq.application_turns
  for each row execute function gateq.application_turn_tenant_matches();

create or replace function gateq.protect_application_turns()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'gateq.application_turns is append-only: what was said stays said'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_application_turns() from public;

create trigger application_turns_append_only
  before update or delete on gateq.application_turns
  for each row execute function gateq.protect_application_turns();

-- ---------------------------------------------------------------------------
-- The applicant's contact: one per application, confirmed before submission.
-- ---------------------------------------------------------------------------

create table gateq.application_contacts (
  application_id      uuid primary key references gateq.applications (id) on delete restrict,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  name                text not null check (length(btrim(name)) between 1 and 200),
  email               text not null check (length(email) between 3 and 254 and email ~ '^[^@\s]+@[^@\s]+$'),
  role                text not null check (length(btrim(role)) between 1 and 120),
  company_name        text not null check (length(btrim(company_name)) between 1 and 200),
  phone               text check (phone is null or phone ~ '^\+?[0-9 ().-]{6,32}$'),
  preferred_channel   text check (preferred_channel is null or preferred_channel in ('EMAIL', 'PHONE')),
  -- The one-time code's verifier only (sha256 hex). The code itself exists
  -- in one email and nowhere else.
  code_hash           text check (code_hash is null or code_hash ~ '^[0-9a-f]{64}$'),
  code_expires_at     timestamptz,
  code_attempts       smallint not null default 0 check (code_attempts between 0 and 10),
  email_confirmed_at  timestamptz,
  -- How it was confirmed: a code from the inbox, or a signed-in account
  -- whose own email is this address. Never a membership.
  confirmed_via       text check (confirmed_via is null or confirmed_via in ('EMAIL_CODE', 'ACCOUNT')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  check ((code_hash is null) = (code_expires_at is null)),
  check ((email_confirmed_at is null) = (confirmed_via is null))
);

comment on table gateq.application_contacts is
  'Who the receiving organisation may contact about one application, and whether the email was confirmed (by a one-time code or a matching signed-in account). Reachability, not an account: confirming creates no membership.';
comment on column gateq.application_contacts.code_hash is
  'sha256 of the one-time code. The raw code is never stored.';

create or replace function gateq.application_contact_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.applications a
     where a.id = new.application_id and a.tenant_id = new.tenant_id
  ) then
    raise exception 'a contact belongs to its application''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_contact_tenant_matches() from public;

create trigger application_contacts_tenant
  before insert or update of tenant_id, application_id on gateq.application_contacts
  for each row execute function gateq.application_contact_tenant_matches();

-- ---------------------------------------------------------------------------
-- The submission's dossier and snapshot version, set at INSERT only.
-- ---------------------------------------------------------------------------

alter table gateq.application_submissions
  add column dossier jsonb
    check (dossier is null or (jsonb_typeof(dossier) = 'object' and pg_column_size(dossier) <= 262144)),
  add column snapshot_version smallint not null default 1
    check (snapshot_version between 1 and 99);

comment on column gateq.application_submissions.dossier is
  'The deterministic investor brief built in the submission transaction (GateqDossierV1). Null for submissions made before it existed. Immutable with the row.';
comment on column gateq.application_submissions.snapshot_version is
  '1: view + document ids. 2: adds the confirmed contact, the full transcript and the coverage report.';

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
-- ---------------------------------------------------------------------------

alter table gateq.application_turns enable row level security;
alter table gateq.application_contacts enable row level security;

revoke all on gateq.application_turns, gateq.application_contacts
  from anon, authenticated;
