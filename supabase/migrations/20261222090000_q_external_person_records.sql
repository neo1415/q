-- W2 (2026-10-10): public research entities. A person, organisation or
-- government agency a member asked Q to find ("find Shadi Qishta, Doha,
-- Qatar") that is NOT a Capital Q user, plus PREPARED public seeds that are
-- loaded in advance (the Qatar demo pack) so a known entity resolves with
-- no web call.
--
-- What is kept is bounded: the public profile link, name variants, an
-- identity read (role, organisation, location, categorical confidence),
-- references to the public sources it came from (URL, description, dates,
-- how it stands as evidence -- never page bodies), concise facts, short
-- source-attributed quotes, and versioned, evidence-classed derived
-- summaries (the brief). A researched record is the asking member's aid,
-- scoped to the tenant AND the user who asked, with a freshness date; a
-- later question reuses it and "refresh" writes a new brief version. A
-- PREPARED_PUBLIC_SEED record is platform reference data built only from
-- public sources (tenant_id null); it is never a profile of record, never
-- shown to the person it is about, never canonical business truth, and
-- never a ranking feature.
--
-- Server-only like every q_runtime table: RLS on, no policies, no client
-- grants; the Q API passes every read and write through the actor.

create table q_runtime.external_persons (
  id                  uuid primary key,
  -- Null only for a PREPARED_PUBLIC_SEED (platform reference data).
  tenant_id           uuid references identity.tenants (id) on delete restrict,
  user_id             uuid references identity.user_profiles (id) on delete cascade,
  entity_kind         text not null default 'PERSON'
                        check (entity_kind in ('PERSON', 'ORGANIZATION', 'GOVERNMENT_AGENCY')),
  research_status     text not null default 'RESEARCHED'
                        check (research_status in ('PREPARED_PUBLIC_SEED', 'RESEARCHED', 'REFRESHING')),
  requires_refresh    boolean not null default false,
  -- Normalised public profile (linkedin.com/in/<slug>), a seed's demo id,
  -- or a hash of name+organisation; one row per entity per asker.
  profile_key         text not null check (length(profile_key) between 1 and 300),
  display_name        text not null check (length(display_name) between 1 and 200),
  name_variants       jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(name_variants) = 'array'
                           and jsonb_array_length(name_variants) <= 24),
  profile_url         text check (profile_url is null or length(profile_url) <= 2048),
  -- A personal role belongs to a person only.
  role                text check (role is null or length(role) <= 200),
  organization        text check (organization is null or length(organization) <= 200),
  location            text check (location is null or length(location) <= 200),
  confidence          text not null check (confidence in ('STRONG', 'PLAUSIBLE', 'WEAK')),
  -- Our own stored asset only, with attribution and licence; never a
  -- hotlinked third-party image. {status, assetUrl, attribution, licenseNote}
  image               jsonb not null default
                        '{"status":"NOT_ATTACHED","assetUrl":null,"attribution":null,"licenseNote":null}'::jsonb,
  -- [{text, sourceId, speaker, date, use:'SOURCE_QUOTE_ONLY'}]
  quotes              jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(quotes) = 'array' and jsonb_array_length(quotes) <= 8),
  -- Bounded free-form extras for a seed (rehearsal topics and questions).
  profile             jsonb not null default '{}'::jsonb
                        check (jsonb_typeof(profile) = 'object' and length(profile::text) <= 16000),
  -- Public source references behind a live identity read (no page bodies).
  sources             jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(sources) = 'array'
                           and jsonb_array_length(sources) <= 16),
  evidence_bundle_id  uuid not null default gen_random_uuid(),
  -- Latest brief version; 0 until one is built.
  brief_version       integer not null default 0 check (brief_version >= 0),
  last_researched_at  timestamptz not null default clock_timestamp(),
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),

  -- A seed is platform data (no owner); every other record has an owner.
  check ((research_status = 'PREPARED_PUBLIC_SEED' and tenant_id is null and user_id is null)
      or (research_status <> 'PREPARED_PUBLIC_SEED' and tenant_id is not null and user_id is not null)),
  check (entity_kind = 'PERSON' or role is null),
  unique (id, tenant_id)
);

comment on table q_runtime.external_persons is
  'A public research entity (person, organisation or agency): link, identity read, quotes. PREPARED_PUBLIC_SEED rows are platform reference data; all others are tenant+user scoped. Server-only, never canonical truth, never a profile of record.';

create unique index external_persons_owner_key_idx
  on q_runtime.external_persons (tenant_id, user_id, profile_key)
  where tenant_id is not null;
create unique index external_persons_seed_key_idx
  on q_runtime.external_persons (profile_key)
  where tenant_id is null;
create index external_persons_asker_idx
  on q_runtime.external_persons (tenant_id, user_id, last_researched_at desc)
  where tenant_id is not null;

-- Every name an entity answers to, normalised for an O(1) known-entity
-- lookup (alias_key is the multilingual name key from the names module).
create table q_runtime.external_entity_aliases (
  external_person_id  uuid not null references q_runtime.external_persons (id) on delete cascade,
  alias_key           text not null check (length(alias_key) between 1 and 200),
  alias               text not null check (length(alias) between 1 and 200),
  primary key (external_person_id, alias_key)
);
create index external_entity_aliases_key_idx
  on q_runtime.external_entity_aliases (alias_key);

-- Public sources: id is the entity's own reference (S01 ...).
create table q_runtime.external_entity_sources (
  external_person_id  uuid not null references q_runtime.external_persons (id) on delete cascade,
  source_id           text not null check (source_id ~ '^[A-Za-z0-9._:-]{1,64}$'),
  url                 text not null check (length(url) between 1 and 2048),
  description         text check (description is null or length(description) <= 300),
  published_at        timestamptz,
  -- How the source stands as evidence, in words ("publicly documented").
  evidence_class      text check (evidence_class is null or length(evidence_class) <= 120),
  retrieved_at        timestamptz not null default clock_timestamp(),
  primary key (external_person_id, source_id)
);

-- Concise facts, each tied to the sources that support it.
create table q_runtime.external_entity_facts (
  external_person_id  uuid not null references q_runtime.external_persons (id) on delete cascade,
  ordinal             integer not null check (ordinal >= 0),
  claim               text not null check (length(claim) between 1 and 600),
  source_ids          text[] not null default '{}' check (cardinality(source_ids) <= 8),
  evidence_class      text check (evidence_class is null or length(evidence_class) <= 120),
  primary key (external_person_id, ordinal)
);

create table q_runtime.external_person_briefs (
  external_person_id  uuid not null references q_runtime.external_persons (id) on delete cascade,
  -- Same scope as the entity (null for a seed).
  tenant_id           uuid,
  user_id             uuid,
  version             integer not null check (version >= 1),
  built_at            timestamptz not null,
  -- After this a question about the entity refreshes the brief.
  fresh_until         timestamptz not null,
  sources             jsonb not null check (jsonb_typeof(sources) = 'array'
                                        and jsonb_array_length(sources) <= 16),
  -- [{topic, text, assertionClass, sourceRefs, asOf}] validated by the
  -- application contract (PersonBriefSchema) before it is written.
  assertions          jsonb not null check (jsonb_typeof(assertions) = 'array'
                                        and jsonb_array_length(assertions) <= 60),
  created_at          timestamptz not null default clock_timestamp(),

  -- Append-only history: a refresh is a new version, never an overwrite.
  primary key (external_person_id, version)
);

comment on table q_runtime.external_person_briefs is
  'Versioned, evidence-classed derived summaries about a research entity. Append-only; refresh adds a version. Server-only.';

alter table q_runtime.external_persons enable row level security;
alter table q_runtime.external_entity_aliases enable row level security;
alter table q_runtime.external_entity_sources enable row level security;
alter table q_runtime.external_entity_facts enable row level security;
alter table q_runtime.external_person_briefs enable row level security;

revoke all on q_runtime.external_persons from public, anon, authenticated;
revoke all on q_runtime.external_entity_aliases from public, anon, authenticated;
revoke all on q_runtime.external_entity_sources from public, anon, authenticated;
revoke all on q_runtime.external_entity_facts from public, anon, authenticated;
revoke all on q_runtime.external_person_briefs from public, anon, authenticated;
grant select, insert, update, delete on q_runtime.external_persons to postgres, service_role;
grant select, insert, update, delete on q_runtime.external_entity_aliases to postgres, service_role;
grant select, insert, update, delete on q_runtime.external_entity_sources to postgres, service_role;
grant select, insert, update, delete on q_runtime.external_entity_facts to postgres, service_role;
-- Briefs are append-only: no update. Delete is the asker's own "forget"
-- (and cascade from the entity).
grant select, insert, delete on q_runtime.external_person_briefs to postgres, service_role;
