-- Owner decision 107 (2026-11-18): GDPR and Nigeria NDPA data rights.
-- Every person can download their data and delete their account. Records
-- the law or other people need (audit, a counterparty's relationship
-- history, invoices) are kept with the person's identity removed.
-- Inventory: docs/specs/data-rights/2026-11-18-data-rights-inventory.md.
--
-- 1. The person's profile becomes the anonymised tombstone. Every kept row
--    references identity.user_profiles by its opaque id (206 RESTRICT
--    foreign keys), so closing the profile and removing its identifying
--    fields anonymises them all at once, without rewriting append-only
--    history. The auth account can then be deleted: the foreign key sets
--    null, and only a CLOSED profile may lose it (the check), so an auth
--    account still cannot disappear from under a live person.
-- 2. Two server-only request ledgers: the export ("download my data") and
--    the deletion (with its grace period). Both are written and read by the
--    API and workers only; no browser role holds any privilege.
-- 3. A private export bucket. Objects are reached only through a short-
--    lived signed link the API mints for the owner.
-- 4. A narrow erasure mode for a few append-only tables whose rows carry a
--    person's name or words in text (meeting transcript names, private
--    observations, inbound email). Only a transaction that sets
--    cq.data_rights_erasure = 'on' with SET LOCAL may change them; that is
--    the deletion job, which records its own audit row. Everything else
--    about those guards is unchanged.
--
-- Contains DROP CONSTRAINT (the auth foreign key and the notification kind
-- check are re-added wider). Review before applying with the migrator.

-- 1. Tombstone ------------------------------------------------------------------

alter table identity.user_profiles
  add column closed_at timestamptz;

alter table identity.user_profiles
  alter column auth_user_id drop not null;

alter table identity.user_profiles
  drop constraint user_profiles_auth_user_id_fkey,
  add constraint user_profiles_auth_user_id_fkey
    foreign key (auth_user_id) references auth.users (id) on delete set null;

alter table identity.user_profiles
  add constraint user_profiles_closed_shape
    check ((status = 'closed') = (closed_at is not null)
           and (auth_user_id is not null or status = 'closed'));

comment on column identity.user_profiles.closed_at is
  'When the account was deleted (decision 107). A closed profile is the anonymised tombstone kept rows still reference: no name, photo or auth account.';

-- 2. Export requests ------------------------------------------------------------

create table identity.data_export_requests (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  idempotency_key  text not null check (length(idempotency_key) between 8 and 200),
  status           text not null default 'REQUESTED'
                     check (status in ('REQUESTED', 'BUILDING', 'READY', 'FAILED', 'EXPIRED')),
  requested_at     timestamptz not null default clock_timestamp(),
  started_at       timestamptz,
  completed_at     timestamptz,
  expires_at       timestamptz,
  attempts         integer not null default 0 check (attempts between 0 and 100),
  lease_until      timestamptz,
  storage_bucket   text check (storage_bucket is null or storage_bucket ~ '^[a-z][a-z0-9-]{1,62}$'),
  storage_key      text check (storage_key is null
                               or (storage_key ~ '^[a-z0-9][a-z0-9/_.-]{0,254}$' and position('..' in storage_key) = 0)),
  byte_size        bigint check (byte_size is null or byte_size >= 0),
  manifest         jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(manifest) = 'object' and octet_length(manifest::text) <= 65536),
  failure_code     text check (failure_code is null or failure_code ~ '^[A-Z][A-Z_]{2,63}$'),
  notified_at      timestamptz,
  unique (user_id, idempotency_key),
  check (status <> 'READY' or (storage_key is not null and completed_at is not null and expires_at is not null)),
  check (expires_at is null or completed_at is null or expires_at > completed_at)
);

comment on table identity.data_export_requests is
  'Decision 107: one "download my data" request. Server-only. The ZIP lives in the private export bucket until expires_at; the row is the person''s own and goes with their account.';

-- One build in flight per person; the rate limit counts recent rows.
create unique index data_export_requests_one_open_idx
  on identity.data_export_requests (user_id)
  where status in ('REQUESTED', 'BUILDING');
create index data_export_requests_queue_idx
  on identity.data_export_requests (requested_at)
  where status in ('REQUESTED', 'BUILDING');
create index data_export_requests_expiry_idx
  on identity.data_export_requests (expires_at)
  where status = 'READY';
create index data_export_requests_user_idx
  on identity.data_export_requests (user_id, requested_at desc);

alter table identity.data_export_requests enable row level security;
revoke all on identity.data_export_requests from public, anon, authenticated;

-- 3. Deletion requests ----------------------------------------------------------

create table identity.account_deletion_requests (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references identity.user_profiles (id) on delete restrict,
  status                  text not null default 'SCHEDULED'
                            check (status in ('SCHEDULED', 'CANCELLED', 'PROCESSING', 'BLOCKED', 'COMPLETED')),
  requested_at            timestamptz not null default clock_timestamp(),
  scheduled_for           timestamptz not null,
  cancelled_at            timestamptz,
  started_at              timestamptz,
  completed_at            timestamptz,
  -- How the person re-confirmed it was them (never the credential itself).
  step_up_method          text not null check (step_up_method in ('password', 'otp', 'totp')),
  step_up_at              timestamptz not null,
  -- Organisations the person is the only member of, which they agreed
  -- close with the account (bound to the confirmation they saw).
  organisations_to_close  uuid[] not null default '{}',
  attempts                integer not null default 0 check (attempts between 0 and 100),
  lease_until             timestamptz,
  failure_code            text check (failure_code is null or failure_code ~ '^[A-Z][A-Z_]{2,63}$'),
  -- Counts per class and table once done: the anonymised record of the
  -- deletion itself. Never a name, email or content.
  report                  jsonb not null default '{}'::jsonb
                            check (jsonb_typeof(report) = 'object' and octet_length(report::text) <= 65536),
  check (scheduled_for >= requested_at),
  check ((status = 'CANCELLED') = (cancelled_at is not null)),
  check ((status = 'COMPLETED') = (completed_at is not null))
);

comment on table identity.account_deletion_requests is
  'Decision 107: an account deletion, with its grace period. Server-only. Once COMPLETED the row is the anonymised tombstone of the deletion (the closed profile id and counts only); it is kept as the record that the request was honoured.';

create unique index account_deletion_requests_one_open_idx
  on identity.account_deletion_requests (user_id)
  where status in ('SCHEDULED', 'PROCESSING', 'BLOCKED');
create index account_deletion_requests_due_idx
  on identity.account_deletion_requests (scheduled_for)
  where status in ('SCHEDULED', 'PROCESSING', 'BLOCKED');

alter table identity.account_deletion_requests enable row level security;
revoke all on identity.account_deletion_requests from public, anon, authenticated;

-- 4. Export bucket --------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cq-data-exports-private', 'cq-data-exports-private', false, 1073741824, array['application/zip'])
on conflict (id) do nothing;

-- 5. The export-ready notice ----------------------------------------------------

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN',
                    'INTEREST_RECEIVED', 'CONNECTION_REQUESTED', 'Q_MESSAGE', 'TIME_PROPOSED',
                    'HUMAN_REVIEW', 'VERIFICATION_DECIDED', 'VERIFICATION_REQUESTED',
                    'RELATIONSHIP_OUTCOME', 'DILIGENCE', 'EMAIL_RECEIVED', 'CHAT_MESSAGE',
                    'COMMITMENT', 'STARTUP_ALERT', 'COMPANY_SAVED', 'VIEWING_DIGEST',
                    'INTEREST_ACCEPTED', 'DATA_EXPORT_READY'));

-- 6. Erasure mode ---------------------------------------------------------------

create function private.data_rights_erasure_active()
returns boolean
language sql
stable
set search_path = ''
as $$
  -- Defence in depth: a custom setting can be set by any session, so the
  -- erasure branch also requires a server role. A browser request (anon or
  -- authenticated, switched to by the REST gateway's authenticator) never
  -- qualifies, even if it could set the flag.
  select coalesce(current_setting('cq.data_rights_erasure', true), '') = 'on'
     and current_user not in ('anon', 'authenticated', 'authenticator')
$$;

revoke all on function private.data_rights_erasure_active() from public, anon, authenticated;

comment on function private.data_rights_erasure_active() is
  'Decision 107: true only inside the account-deletion job''s transaction (SET LOCAL cq.data_rights_erasure = on). Lets that job remove a deleted person''s name or private words from the few append-only tables that hold them in text.';

-- Each guard below is the previous body with one erasure branch first.

create or replace function private.meeting_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Erasure may only rename the speaker or owner; the words stay in the
  -- other side's meeting record, attributed to a former user.
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.meeting_id = old.meeting_id and new.seq = old.seq
     and new.body is not distinct from old.body then
    return new;
  end if;
  raise exception 'communication.meeting_events is append-only; record a correction instead'
    using errcode = '55000';
end
$$;

create or replace function private.communication_meeting_roster_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.meeting_id = old.meeting_id then
    return new;
  end if;
  raise exception 'communication.meeting_roster_entries is append-only'
    using errcode = '55000';
end
$$;

create or replace function private.communication_meeting_host_notes_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.meeting_id = old.meeting_id
     and new.body is not distinct from old.body then
    return new;
  end if;
  raise exception 'communication.meeting_host_notes is append-only'
    using errcode = '55000';
end
$$;

-- The owner's private observations are theirs alone: erasure deletes them.
create or replace function private.communication_meeting_private_observations_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and private.data_rights_erasure_active() then
    return old;
  end if;
  raise exception 'communication.meeting_private_observations is append-only'
    using errcode = '55000';
end
$$;

-- Mail that reached the person's own Q address is theirs: erasure deletes it.
create or replace function private.integrations_inbound_emails_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and private.data_rights_erasure_active() then
    return old;
  end if;
  raise exception 'integrations.inbound_emails is append-only' using errcode = '42501';
end;
$$;

-- Claim and knowledge revisions ABOUT the person: erasure may replace the
-- statement with the erased marker (the revision row, its number and its
-- provenance stay; nothing is deleted).
create or replace function evidence.revisions_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.claim_id = old.claim_id
     and new.revision_number = old.revision_number
     and new.statement = '[Removed at the person''s request]' then
    return new;
  end if;
  raise exception 'claim revisions are append-only history' using errcode = 'check_violation';
end;
$$;

create or replace function q_knowledge.revisions_are_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and private.data_rights_erasure_active()
     and new.id = old.id and new.knowledge_object_id = old.knowledge_object_id
     and new.revision_number = old.revision_number
     and new.statement = '[Removed at the person''s request]' then
    return new;
  end if;
  raise exception 'knowledge revisions are append-only; add a revision instead'
    using errcode = 'check_violation';
end;
$$;
