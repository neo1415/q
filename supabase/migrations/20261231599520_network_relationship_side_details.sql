-- CRM import gaps (decision 106; docs/specs/crm-import/2026-11-18-crm-import-research.md §4)
-- · network.relationship_side_details
--
-- Every investor and founder CRM keeps fields Capital Q lacked: the side's
-- own pipeline stage (gap 3), its deal owner (gap 1), where the deal came
-- from and who introduced it (gap 2), the cheque or ticket it expects
-- (gap 4) and its priority (gap 5). Each belongs to ONE side of ONE
-- canonical relationship: the side's organisation keeps them, the
-- counterpart never reads them, and nothing in ranking, fit or the shared
-- relationship state reads them.
--
--   side details ≠ the relationship's state, a deal, a match or a CRM record
--
-- One row per relationship and side at most, an extension of the canonical
-- relationship `UNIQUE (company_id, investor_organisation_id)`, never a
-- parallel deal record. The shared state stays the projector's fold over
-- network.relationship_events; an imported stage is still appended there as
-- the side's private crm_stage_imported event (history), and the side's
-- current stage is kept here.
--
-- Values are the side's own claims (USER_CLAIM). Money is numeric plus an
-- ISO currency, never float; stage and priority are reference vocabularies
-- checked by shape (the contracts hold the lists), never a Postgres enum.
--
-- Revisioned: each change raises `revision` (the API refuses a save over a
-- newer revision) and is audited by the API. Never deleted while the
-- relationship exists. Server-only: RLS on, no policies, no client grants.

create table network.relationship_side_details (
  relationship_id           uuid not null,
  party                     text not null check (party in ('INVESTOR', 'COMPANY')),
  tenant_id                 uuid not null,
  organisation_id           uuid not null,
  -- Exactly one, matching `party`: the side's own canonical party.
  company_id                uuid,
  investor_organisation_id  uuid,
  stage                     text check (stage is null or stage ~ '^[A-Z][A-Z_]{1,39}$'),
  stage_label               text check (stage_label is null or length(btrim(stage_label)) between 1 and 80),
  -- The deal owner: a member of the side's own organisation.
  owner_membership_id       uuid,
  owner_user_id             uuid,
  source                    text check (source is null or length(btrim(source)) between 1 and 200),
  introducer_name           text check (introducer_name is null or length(btrim(introducer_name)) between 1 and 200),
  introducer_email          text check (introducer_email is null or (length(introducer_email) <= 254
                                        and introducer_email ~ '^[^@[:space:]]+@[^@[:space:]]+$')),
  expected_amount           numeric(17, 2) check (expected_amount is null or expected_amount > 0),
  expected_currency         text check (expected_currency is null or expected_currency ~ '^[A-Z]{3}$'),
  priority                  text check (priority is null or priority ~ '^[A-Z][A-Z_]{1,19}$'),
  revision                  integer not null default 1 check (revision >= 1),
  updated_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  visibility_scope          text not null default 'organisation_private'
                              check (visibility_scope = 'organisation_private'),

  primary key (relationship_id, party),
  check ((party = 'COMPANY') = (company_id is not null)),
  check ((party = 'INVESTOR') = (investor_organisation_id is not null)),
  check ((company_id is null) <> (investor_organisation_id is null)),
  check ((owner_membership_id is null) = (owner_user_id is null)),
  -- An amount is never without its currency, nor a currency without one.
  check ((expected_amount is null) = (expected_currency is null)),

  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  -- The side is the organisation's own canonical party ...
  foreign key (company_id, organisation_id, tenant_id)
    references core.companies (id, organisation_id, tenant_id) on delete restrict,
  foreign key (investor_organisation_id, organisation_id, tenant_id)
    references core.investor_organisations (id, organisation_id, tenant_id) on delete restrict,
  -- ... and a party of this relationship (relationship_notes' keys).
  foreign key (relationship_id, company_id)
    references network.relationships (id, company_id) on delete restrict,
  foreign key (relationship_id, investor_organisation_id)
    references network.relationships (id, investor_organisation_id) on delete restrict,
  -- The owner holds this very membership in this organisation and tenant.
  -- Memberships are history (left / revoked rows stay), so restrict; the
  -- API offers and accepts only active members.
  foreign key (owner_membership_id, owner_user_id, organisation_id, tenant_id)
    references identity.organisation_memberships (id, user_id, organisation_id, tenant_id)
    on delete restrict
);

comment on table network.relationship_side_details is
  'CRM import gaps (decision 106): one side''s own pipeline fields on one canonical relationship (its stage, deal owner, source and introducer, expected cheque, priority). organisation_private; never the counterpart''s, never Q ranking or the shared state. Revisioned; server-only.';

-- The pipeline read: one side's rows for a page of its relationships.
create index relationship_side_details_side_idx
  on network.relationship_side_details (tenant_id, organisation_id, party, relationship_id);
create index relationship_side_details_owner_idx
  on network.relationship_side_details (owner_membership_id)
  where owner_membership_id is not null;

-- A row's side never moves, its revision only rises by one, and it is
-- never deleted while its relationship exists.
create or replace function network.relationship_side_details_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a side''s pipeline fields are kept with their relationship'
      using errcode = 'check_violation';
  end if;
  if new.relationship_id <> old.relationship_id
     or new.party <> old.party
     or new.tenant_id <> old.tenant_id
     or new.organisation_id <> old.organisation_id
     or new.company_id is distinct from old.company_id
     or new.investor_organisation_id is distinct from old.investor_organisation_id
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1 then
    raise exception 'side details change only their values, one revision at a time'
      using errcode = 'check_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function network.relationship_side_details_guard() from public;

create trigger relationship_side_details_guard
  before update or delete on network.relationship_side_details
  for each row execute function network.relationship_side_details_guard();

alter table network.relationship_side_details enable row level security;
revoke all on network.relationship_side_details from public, anon, authenticated;

-- The import screen: the person may correct Q's column mapping and read the
-- file again with theirs (mapping source PERSON).
alter table network.pipeline_imports
  drop constraint pipeline_imports_mapping_source_check;
alter table network.pipeline_imports
  add constraint pipeline_imports_mapping_source_check
  check (mapping_source in ('Q', 'HEADERS', 'PERSON'));
