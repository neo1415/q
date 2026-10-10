-- W2 (2026-10-10): public people search. A person a member asked Q to find
-- ("find Shadi Qishta, Doha, Qatar") who is NOT a Capital Q user.
--
-- What is kept is bounded: the public profile link, name variants, an
-- identity read (role, organisation, location, categorical confidence),
-- references to the public sources it came from (URL, domain, title,
-- dates -- never page bodies), and versioned, evidence-classed derived
-- summaries (the brief). It is the asking member's research aid, scoped to
-- the tenant AND the user who asked, with a freshness date; a later
-- question reuses it, and "refresh" writes a new brief version. It is not
-- a profile of record, never shown to the person it is about, never
-- shared, never canonical business truth, never a ranking feature.
--
-- Server-only like every q_runtime table: RLS on, no policies, no client
-- grants; the Q API passes every read and write through the actor.

create table q_runtime.external_persons (
  id                  uuid primary key,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  user_id             uuid not null references identity.user_profiles (id) on delete cascade,
  -- Normalised public profile (linkedin.com/in/<slug>) or, without one,
  -- a hash of name+organisation; one row per person per asker.
  profile_key         text not null check (length(profile_key) between 1 and 300),
  display_name        text not null check (length(display_name) between 1 and 200),
  name_variants       jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(name_variants) = 'array'
                           and jsonb_array_length(name_variants) <= 12),
  profile_url         text check (profile_url is null or length(profile_url) <= 2048),
  role                text check (role is null or length(role) <= 200),
  organization        text check (organization is null or length(organization) <= 200),
  location            text check (location is null or length(location) <= 200),
  confidence          text not null check (confidence in ('STRONG', 'PLAUSIBLE', 'WEAK')),
  -- Public source references behind the identity (no page bodies).
  sources             jsonb not null default '[]'::jsonb
                        check (jsonb_typeof(sources) = 'array'
                           and jsonb_array_length(sources) <= 16),
  evidence_bundle_id  uuid not null default gen_random_uuid(),
  -- Latest brief version; 0 until one is built.
  brief_version       integer not null default 0 check (brief_version >= 0),
  last_searched_at    timestamptz not null default clock_timestamp(),
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),

  unique (id, tenant_id),
  unique (tenant_id, user_id, profile_key)
);

comment on table q_runtime.external_persons is
  'A third party found through public sources for one member: link, identity read, source references. Tenant+user scoped, server-only, never canonical truth, never a profile of record.';

create index external_persons_asker_idx
  on q_runtime.external_persons (tenant_id, user_id, last_searched_at desc);

create table q_runtime.external_person_briefs (
  external_person_id  uuid not null,
  tenant_id           uuid not null,
  user_id             uuid not null,
  version             integer not null check (version >= 1),
  built_at            timestamptz not null,
  -- After this a question about the person refreshes the brief.
  fresh_until         timestamptz not null,
  sources             jsonb not null check (jsonb_typeof(sources) = 'array'
                                        and jsonb_array_length(sources) <= 16),
  -- [{topic, text, assertionClass, sourceRefs, asOf}] validated by the
  -- application contract (PersonBriefSchema) before it is written.
  assertions          jsonb not null check (jsonb_typeof(assertions) = 'array'
                                        and jsonb_array_length(assertions) <= 60),
  created_at          timestamptz not null default clock_timestamp(),

  -- Append-only history: a refresh is a new version, never an overwrite.
  primary key (external_person_id, version),
  foreign key (external_person_id, tenant_id)
    references q_runtime.external_persons (id, tenant_id) on delete cascade
);

comment on table q_runtime.external_person_briefs is
  'Versioned, evidence-classed derived summaries about an external person. Append-only; refresh adds a version. Server-only.';

create index external_person_briefs_latest_idx
  on q_runtime.external_person_briefs (external_person_id, version desc);

alter table q_runtime.external_persons enable row level security;
alter table q_runtime.external_person_briefs enable row level security;

revoke all on q_runtime.external_persons from public, anon, authenticated;
revoke all on q_runtime.external_person_briefs from public, anon, authenticated;
grant select, insert, update, delete on q_runtime.external_persons to postgres, service_role;
-- Briefs are append-only: no update. Delete is for the person's removal
-- (cascade from external_persons) and the asker's own "forget this person".
grant select, insert, delete on q_runtime.external_person_briefs to postgres, service_role;
