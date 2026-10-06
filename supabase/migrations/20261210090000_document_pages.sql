-- Q room W3 (R3): a document's text, page by page.
--
-- One row per page of one structured extraction, so Q can read "page 2",
-- cite the page a summary line came from, read a page aloud and page
-- through a document in the Q room. Written by the extraction pipeline in
-- the same transaction as the extraction row (and by a bounded backfill for
-- extractions made before this table existed).
--
--   extraction ≠ evidence ≠ claim ≠ knowledge: a page is what the file says,
--   never a verified fact.
--
-- Server-only, like document_extractions: no browser principal reads it;
-- the API reads it after the data room has authorised the person, as the
-- person, for that one document. A page inherits the extraction's scope
-- and sensitivity (checked on insert, never widened) and is immutable:
-- re-extraction under a new pipeline version writes new rows.

-- Lets a page name its extraction together with its tenant.
alter table evidence.document_extractions
  add constraint document_extractions_id_tenant_key unique (id, tenant_id);

create table evidence.document_pages (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references identity.tenants (id) on delete restrict,
  owner_organisation_id  uuid not null,
  document_id            uuid not null,
  document_version_id    uuid not null,
  extraction_id          uuid not null,
  -- 1-based, as the parser located it (page for PDFs, slide for decks).
  page_number            integer not null check (page_number between 1 and 10000),
  text                   text not null check (char_length(text) <= 60000),
  -- Where this page sits in the document's text, pages joined in order.
  char_start             integer not null check (char_start >= 0),
  char_end               integer not null,
  visibility_scope       text not null check (visibility_scope in (
                           'personal_private', 'organisation_private', 'founder_private',
                           'investor_private', 'relationship_shared', 'specifically_shared',
                           'network_visible', 'public_external')),
  sensitivity_class      text not null check (sensitivity_class in (
                           'PUBLIC', 'NETWORK_VISIBLE', 'INTERNAL', 'CONFIDENTIAL',
                           'HIGHLY_CONFIDENTIAL', 'RESTRICTED')),
  search                 tsvector generated always as (to_tsvector('simple', text)) stored,
  created_at             timestamptz not null default now(),
  constraint document_pages_offsets_check
    check (char_end = char_start + char_length(text)),
  unique (extraction_id, page_number),
  foreign key (extraction_id, tenant_id)
    references evidence.document_extractions (id, tenant_id) on delete restrict,
  foreign key (document_id, tenant_id)
    references evidence.documents (id, tenant_id) on delete restrict,
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict,
  foreign key (owner_organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete restrict
);

create index document_pages_version_idx
  on evidence.document_pages (tenant_id, document_version_id, page_number);
create index document_pages_document_idx
  on evidence.document_pages (tenant_id, document_id);
create index document_pages_search_idx
  on evidence.document_pages using gin (search);

-- A page belongs to exactly the document, version and owner its extraction
-- does, and carries the extraction's scope and sensitivity: a page is never
-- more visible than the file it came from.
create or replace function evidence.document_pages_match_extraction() returns trigger
language plpgsql
set search_path = pg_catalog, evidence
as $$
declare
  e record;
begin
  select x.document_id, x.document_version_id, x.owner_organisation_id,
         x.visibility_scope, x.sensitivity_class
    into e
    from evidence.document_extractions x
   where x.id = new.extraction_id and x.tenant_id = new.tenant_id;
  if not found then
    raise exception 'a page names an extraction that does not exist'
      using errcode = 'foreign_key_violation';
  end if;
  if e.document_id <> new.document_id
     or e.document_version_id <> new.document_version_id
     or e.owner_organisation_id <> new.owner_organisation_id
     or e.visibility_scope <> new.visibility_scope
     or e.sensitivity_class <> new.sensitivity_class then
    raise exception 'a page must match its extraction''s document, owner, scope and sensitivity'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function evidence.document_pages_match_extraction() from public, anon, authenticated;

create trigger document_pages_match_extraction
  before insert on evidence.document_pages
  for each row execute function evidence.document_pages_match_extraction();

create or replace function evidence.document_pages_are_immutable() returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'document pages are immutable; reprocess under a new pipeline version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function evidence.document_pages_are_immutable() from public, anon, authenticated;

create trigger document_pages_immutable
  before update or delete on evidence.document_pages
  for each row execute function evidence.document_pages_are_immutable();

revoke all on table evidence.document_pages from public, anon, authenticated;
alter table evidence.document_pages enable row level security;
