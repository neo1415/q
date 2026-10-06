-- Q reads a pitch deck into twelve standard sections (overnight plan A5,
-- 2026-10-06; research docs/research/2026-10-06/pitch-deck.md §3).
--
--   evidence.deck_extractions               what Q read from ONE deck version,
--                                           through the document pipeline and
--                                           the Model Gateway, with the pinned
--                                           prompt version; append-only, one
--                                           per version and prompt version
--   evidence.deck_extraction_confirmations  the founder confirmed it (the
--                                           Write Gate): only a confirmed
--                                           extraction reaches an investor;
--                                           append-only
--
-- Coaching (the 0-5 rubric, A6) is computed from a stored extraction by
-- deterministic code and is never stored or read by ranking, matching or
-- any investor projection: deck quality ≠ business quality ≠ fit.
--
-- Server-only like the rest of evidence: RLS on, no policies, no grants.

create table evidence.deck_extractions (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  company_id            uuid not null,
  document_id           uuid not null,
  document_version_id   uuid not null,
  prompt_version        integer not null check (prompt_version > 0),
  schema_version        integer not null check (schema_version > 0),
  page_count            integer check (page_count is null or page_count between 1 and 10000),
  -- The twelve sections, in order, as contracts' DeckSectionsSchema.
  sections              jsonb not null check (jsonb_typeof(sections) = 'array' and jsonb_array_length(sections) = 12),
  created_at            timestamptz not null default clock_timestamp(),
  unique (document_version_id, prompt_version),
  unique (id, tenant_id),
  foreign key (document_version_id, tenant_id)
    references evidence.document_versions (id, tenant_id) on delete restrict,
  foreign key (document_version_id, document_id)
    references evidence.document_versions (id, document_id) on delete restrict,
  foreign key (company_id, tenant_id)
    references core.companies (id, tenant_id) on delete restrict
);

comment on table evidence.deck_extractions is
  'Q''s reading of one pitch-deck version into twelve standard sections, from that version''s own text only. A proposal (USER_CLAIM / Q_INFERENCE per fact) until confirmed. Append-only.';

create index deck_extractions_document_idx
  on evidence.deck_extractions (document_id, created_at desc);

create table evidence.deck_extraction_confirmations (
  extraction_id           uuid primary key,
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  confirmed_by_user_id    uuid not null references identity.user_profiles (id) on delete restrict,
  created_at              timestamptz not null default clock_timestamp(),
  foreign key (extraction_id, tenant_id)
    references evidence.deck_extractions (id, tenant_id) on delete restrict
);

comment on table evidence.deck_extraction_confirmations is
  'The founder confirmed what Q read from their deck (the Write Gate). Append-only. Only a confirmed extraction is shown to an investor, and only where they may see the deck.';

create trigger deck_extractions_append_only
  before update or delete on evidence.deck_extractions
  for each row execute function private.evidence_data_room_append_only();
create trigger deck_extraction_confirmations_append_only
  before update or delete on evidence.deck_extraction_confirmations
  for each row execute function private.evidence_data_room_append_only();

alter table evidence.deck_extractions enable row level security;
alter table evidence.deck_extraction_confirmations enable row level security;
revoke all on evidence.deck_extractions, evidence.deck_extraction_confirmations
  from anon, authenticated;

-- A founder as a person (A7): what they chose to show investors who can
-- find their company. Person-owned, founder_private by default.
create table core.founder_person_facts (
  user_id               uuid primary key references identity.user_profiles (id) on delete restrict,
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  birth_year            integer check (birth_year is null or birth_year between 1900 and 2015),
  -- Age is shown only when this is network_visible; never a matching input.
  age_visibility_scope  text not null default 'founder_private'
                          check (age_visibility_scope in ('founder_private', 'network_visible')),
  building_since        integer check (building_since is null or building_since between 1950 and 2100),
  companies_founded     integer check (companies_founded is null or companies_founded between 0 and 50),
  exits                 text check (exits is null or length(exits) between 1 and 80),
  looking_for           text check (looking_for is null or length(looking_for) between 1 and 300),
  location              text check (location is null or length(location) between 1 and 200),
  updated_at            timestamptz not null default clock_timestamp(),
  version               integer not null default 1 check (version >= 1)
);

comment on table core.founder_person_facts is
  'A founder''s own facts about themselves (A7). Age shown only where age_visibility_scope = network_visible; never used in matching, ranking or scoring.';

create table core.founder_background_entries (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references identity.tenants (id) on delete restrict,
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  from_year             integer check (from_year is null or from_year between 1950 and 2100),
  to_year               integer check (to_year is null or to_year between 1950 and 2100),
  title                 text not null check (length(title) between 1 and 160),
  detail                text check (detail is null or length(detail) between 1 and 300),
  -- A document of the founder's company that supports the line; the line
  -- reads "matches a shared document" only for a reader who may open it.
  supporting_document_id uuid,
  visibility_scope      text not null default 'founder_private'
                          check (visibility_scope in ('founder_private', 'network_visible')),
  sort_order            integer not null default 0,
  created_at            timestamptz not null default clock_timestamp(),
  check (to_year is null or from_year is null or to_year >= from_year)
);

comment on table core.founder_background_entries is
  'A founder''s background line (A7): their own claim (USER_CLAIM, SELF_REPORTED) unless a document the reader may open supports it. Shown only where network_visible.';

create index founder_background_entries_user_idx
  on core.founder_background_entries (user_id, sort_order);

alter table core.founder_person_facts enable row level security;
alter table core.founder_background_entries enable row level security;
-- A person reads their own; everyone else through the server's projection.
create policy founder_person_facts_own_select on core.founder_person_facts
  for select to authenticated using (user_id = private.current_app_user_id());
create policy founder_background_entries_own_select on core.founder_background_entries
  for select to authenticated using (user_id = private.current_app_user_id());
revoke all on core.founder_person_facts, core.founder_background_entries from anon, authenticated;
grant select on core.founder_person_facts, core.founder_background_entries to authenticated;
