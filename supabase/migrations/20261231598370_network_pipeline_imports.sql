-- CRM import (owner decision 106, 2026-11-18) · network.pipeline_imports
--
-- An investor or a founder uploads the pipeline they already keep (a CSV or
-- XLSX exported from Affinity, HubSpot, Airtable, a Google Sheet ...). The
-- file arrives through the existing document path (scanned before it is
-- read). Q reads it and proposes how its columns map; each row is matched
-- to a canonical company (investor side) or a canonical investor
-- organisation (founder side) by an authorised search. Nothing is written
-- to the relationship graph until the importer approves the exact prepared
-- proposal (Prepare -> Approve -> Execute):
--
--   pipeline_imports      one prepared import: the file it read, the column
--                         mapping, the proposal's hash the approval binds to,
--                         and, once applied, the idempotency key and result.
--   pipeline_import_rows  one row of the sheet, normalised: the counterpart
--                         it names, how it matched (MATCHED / AMBIGUOUS /
--                         NEW / INVALID) and, once applied, what happened to
--                         it (LINKED to the ONE canonical relationship,
--                         KEPT_PRIVATE as the importer's own prospect, or
--                         SKIPPED).
--
--   an import row ≠ a relationship, a company, a deal or a CRM record
--
-- A matched row becomes (or reuses) the one canonical relationship
-- `UNIQUE (company_id, investor_organisation_id)` and its stage history is
-- appended to network.relationship_events, private to the importing side.
-- An unmatched row never becomes a canonical company or investor: it stays
-- here, private to the importing organisation, as a prospect it keeps.
--
-- organisation_private, INTERNAL_SERVER_ONLY: RLS on, no policies, no
-- client grants; the API reads and writes these for the actor's own
-- organisation only. History: no delete, and once prepared a row's content
-- never changes -- only its outcome is set, once.

create table network.pipeline_imports (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  organisation_id           uuid not null,
  -- Exactly one: the importing side's own canonical party.
  company_id                uuid,
  investor_organisation_id  uuid,
  created_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  -- Provenance: the scanned document version that was read. Read only
  -- through Evidence's authorised, scan-checked path; never by this table.
  document_id               uuid not null,
  document_version_id       uuid not null,
  file_name                 text not null check (length(btrim(file_name)) between 1 and 255),
  source_format             text not null check (source_format in ('CSV', 'XLSX')),
  row_count                 integer not null check (row_count between 0 and 5000),
  -- {targetField: sourceHeader}; bounded reference data, never cell data.
  mapping                   jsonb not null
                              check (jsonb_typeof(mapping) = 'object' and length(mapping::text) <= 16384),
  mapping_source            text not null check (mapping_source in ('Q', 'HEADERS')),
  -- sha256 of the exact prepared proposal; the approval binds to it.
  proposal_hash             text not null check (proposal_hash ~ '^[0-9a-f]{64}$'),
  status                    text not null default 'PREPARED' check (status in ('PREPARED', 'APPLIED')),
  apply_idempotency_key     uuid,
  approved_by_user_id       uuid references identity.user_profiles (id) on delete restrict,
  applied_at                timestamptz,
  -- Counts only (linked, kept private, skipped, events, notes, tasks).
  result                    jsonb check (result is null or (jsonb_typeof(result) = 'object' and length(result::text) <= 2048)),
  visibility_scope          text not null default 'organisation_private'
                              check (visibility_scope = 'organisation_private'),
  created_at                timestamptz not null default clock_timestamp(),
  check ((company_id is null) <> (investor_organisation_id is null)),
  check ((status = 'APPLIED') = (applied_at is not null)),
  check ((status = 'APPLIED') = (apply_idempotency_key is not null)),
  check ((status = 'APPLIED') = (approved_by_user_id is not null)),
  check ((status = 'APPLIED') = (result is not null)),
  unique (id, tenant_id, organisation_id),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  -- The side is the importing organisation's own canonical party.
  foreign key (company_id, organisation_id, tenant_id)
    references core.companies (id, organisation_id, tenant_id) on delete restrict,
  foreign key (investor_organisation_id, organisation_id, tenant_id)
    references core.investor_organisations (id, organisation_id, tenant_id) on delete restrict
);

comment on table network.pipeline_imports is
  'CRM import (decision 106): one prepared import of a pipeline file into the importing organisation''s own side. organisation_private, server-only. Applied once, under one idempotency key, after approval of the exact proposal hash.';

-- An approved apply is replayed by its key, never run twice.
create unique index pipeline_imports_apply_key_idx
  on network.pipeline_imports (organisation_id, apply_idempotency_key)
  where apply_idempotency_key is not null;
create index pipeline_imports_org_created_idx
  on network.pipeline_imports (tenant_id, organisation_id, created_at desc, id);

create table network.pipeline_import_rows (
  import_id         uuid not null,
  row_number        integer not null check (row_number between 1 and 5000),
  tenant_id         uuid not null,
  organisation_id   uuid not null,
  counterpart_name  text check (counterpart_name is null or length(btrim(counterpart_name)) between 1 and 200),
  website_domain    text check (website_domain is null or (length(website_domain) <= 253
                                 and website_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')),
  -- The row's normalised, mapped values (stage, dates, amounts, notes ...).
  fields            jsonb not null default '{}'::jsonb
                      check (jsonb_typeof(fields) = 'object' and length(fields::text) <= 12288),
  match_status      text not null check (match_status in ('MATCHED', 'AMBIGUOUS', 'NEW', 'INVALID')),
  -- The canonical company (investor import) or investor organisation
  -- (founder import) the row matched.
  matched_party_id  uuid,
  candidate_ids     uuid[] not null default '{}' check (cardinality(candidate_ids) <= 5),
  outcome           text check (outcome is null or outcome in ('LINKED', 'KEPT_PRIVATE', 'SKIPPED')),
  relationship_id   uuid references network.relationships (id) on delete restrict,
  primary key (import_id, row_number),
  check ((match_status = 'MATCHED') = (matched_party_id is not null)),
  -- Only a matched row is ever linked to a relationship.
  check (outcome is distinct from 'LINKED' or match_status in ('MATCHED', 'AMBIGUOUS')),
  check ((outcome = 'LINKED') = (relationship_id is not null)),
  foreign key (import_id, tenant_id, organisation_id)
    references network.pipeline_imports (id, tenant_id, organisation_id) on delete restrict
);

comment on table network.pipeline_import_rows is
  'CRM import rows (decision 106): one normalised row of an imported pipeline file and its match. An unmatched row is the importing organisation''s private prospect, never a canonical company or investor. Server-only.';

create index pipeline_import_rows_org_idx
  on network.pipeline_import_rows (tenant_id, organisation_id, import_id);
create index pipeline_import_rows_relationship_idx
  on network.pipeline_import_rows (relationship_id) where relationship_id is not null;

-- Prepared content is history: an import moves PREPARED -> APPLIED once
-- (with its key, approver, time and counts) and a row only gains its
-- outcome once. Nothing is deleted, for any role.
create or replace function network.pipeline_imports_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pipeline imports are history; they are never deleted'
      using errcode = 'check_violation';
  end if;
  if old.status <> 'PREPARED' or new.status <> 'APPLIED'
     or (to_jsonb(new) - array['status', 'apply_idempotency_key', 'approved_by_user_id', 'applied_at', 'result'])
        is distinct from
        (to_jsonb(old) - array['status', 'apply_idempotency_key', 'approved_by_user_id', 'applied_at', 'result']) then
    raise exception 'a prepared import only moves to APPLIED, once'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function network.pipeline_imports_guard() from public;

create trigger pipeline_imports_guard
  before update or delete on network.pipeline_imports
  for each row execute function network.pipeline_imports_guard();

create or replace function network.pipeline_import_rows_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pipeline import rows are history; they are never deleted'
      using errcode = 'check_violation';
  end if;
  if old.outcome is not null
     or (to_jsonb(new) - array['outcome', 'relationship_id'])
        is distinct from (to_jsonb(old) - array['outcome', 'relationship_id']) then
    raise exception 'an import row only gains its outcome, once'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function network.pipeline_import_rows_guard() from public;

create trigger pipeline_import_rows_guard
  before update or delete on network.pipeline_import_rows
  for each row execute function network.pipeline_import_rows_guard();

alter table network.pipeline_imports enable row level security;
alter table network.pipeline_import_rows enable row level security;
revoke all on network.pipeline_imports from public, anon, authenticated;
revoke all on network.pipeline_import_rows from public, anon, authenticated;
