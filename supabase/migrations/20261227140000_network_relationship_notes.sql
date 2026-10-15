-- CRM private notes on a relationship record (CRM S3, lane C; research
-- docs/design/crm-research-2026-10-15.md §2).
--
--   a note ≠ evidence, a claim, Q memory, an audit entry or a message
--
-- A note belongs to ONE side of ONE canonical relationship: the author's
-- company (founder side) or the author's investor organisation (investor
-- side), inside the author's own organisation and tenant. The other party
-- never reads it; nothing in ranking, fit or Q context reads it (Context
-- Firewall). Visibility: organisation_private.
--
-- Append-only history: no update, no delete, for any role. A correction is
-- a new note naming the one it supersedes (once, on the same relationship
-- and side), and the superseded note stays.
--
-- Server-only: RLS on as a second layer, no policies, no client grants.
-- The API decides who reads and writes (network relationship-notes).

-- A note's side must be a party of its relationship. These are supersets of
-- the primary key, so they change no existing row's meaning.
alter table network.relationships
  add constraint relationships_id_company_key unique (id, company_id),
  add constraint relationships_id_investor_organisation_key unique (id, investor_organisation_id);

create table network.relationship_notes (
  id                        uuid primary key,
  tenant_id                 uuid not null,
  organisation_id           uuid not null,
  relationship_id           uuid not null,
  -- Exactly one: the author's side of the relationship.
  company_id                uuid,
  investor_organisation_id  uuid,
  author_user_id            uuid not null,
  author_membership_id      uuid not null,
  body                      text not null check (length(btrim(body)) between 1 and 4000),
  supersedes_note_id        uuid,
  created_at                timestamptz not null default clock_timestamp(),

  check ((company_id is null) <> (investor_organisation_id is null)),
  check (supersedes_note_id is null or supersedes_note_id <> id),
  -- Lets a correction name a note of the same relationship and organisation.
  unique (id, relationship_id, organisation_id),

  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict,
  -- The author holds this very membership in this organisation and tenant.
  -- Memberships are history (left / revoked rows stay), so restrict.
  foreign key (author_membership_id, author_user_id, organisation_id, tenant_id)
    references identity.organisation_memberships (id, user_id, organisation_id, tenant_id)
    on delete restrict,
  -- The side is the author organisation's own canonical party ...
  foreign key (company_id, organisation_id, tenant_id)
    references core.companies (id, organisation_id, tenant_id) on delete restrict,
  foreign key (investor_organisation_id, organisation_id, tenant_id)
    references core.investor_organisations (id, organisation_id, tenant_id) on delete restrict,
  -- ... and a party of this relationship.
  foreign key (relationship_id, company_id)
    references network.relationships (id, company_id) on delete restrict,
  foreign key (relationship_id, investor_organisation_id)
    references network.relationships (id, investor_organisation_id) on delete restrict,
  foreign key (supersedes_note_id, relationship_id, organisation_id)
    references network.relationship_notes (id, relationship_id, organisation_id) on delete restrict
);

comment on table network.relationship_notes is
  'CRM private notes (2026-10-15 S3): one side''s own notes on one canonical relationship, organisation_private. Never the counterpart''s, never evidence, never Q context. Append-only; corrections supersede. Server-only.';

-- A note is corrected at most once: one current successor.
create unique index relationship_notes_supersedes_once_idx
  on network.relationship_notes (supersedes_note_id)
  where supersedes_note_id is not null;

-- The read: one side's notes on one relationship, newest first.
create index relationship_notes_side_idx
  on network.relationship_notes (tenant_id, organisation_id, relationship_id, created_at desc, id);

create index relationship_notes_author_membership_idx
  on network.relationship_notes (author_membership_id);

create or replace function network.relationship_notes_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'relationship notes are append-only history; supersede with a new note'
    using errcode = 'check_violation';
end;
$$;
revoke all on function network.relationship_notes_append_only() from public;

create trigger relationship_notes_append_only
  before update or delete on network.relationship_notes
  for each row execute function network.relationship_notes_append_only();

alter table network.relationship_notes enable row level security;
revoke all on network.relationship_notes from public, anon, authenticated;
