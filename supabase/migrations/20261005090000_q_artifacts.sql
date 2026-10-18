-- QX-003C · artifacts.artifacts and artifacts.artifact_versions: what Q
-- composes for somebody to read, keep and change.
--
--   generated artifact ≠ canonical truth ≠ verified evidence ≠ disclosure
--
-- A brief saying a company has forty customers does not make that a fact
-- about the company, does not become evidence for it, and does not show it
-- to anybody. Nothing here writes to a company, an investor organisation,
-- Evidence or Knowledge, and nothing here is read by discovery, ranking or
-- qualification. It is derived material with an author, a moment and a
-- provenance trail, and that is all it claims to be.
--
-- Two tables, and the versioning is the point. "Edit with Q" composes a new
-- version; the previous one stays readable, because somebody who sent a
-- brief to an investor last week needs to see what they sent. A version is
-- therefore a row, never a column somebody overwrites -- the same reason
-- gateq.gateway_versions is a row.

create schema if not exists artifacts;

comment on schema artifacts is
  'Material Q composed: briefs, and later decks. Derived, versioned and owner-scoped. Never canonical truth, never evidence, and never a disclosure to anybody.';

-- ---------------------------------------------------------------------------
-- The artifact: identity across its versions.
-- ---------------------------------------------------------------------------

create table artifacts.artifacts (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  -- The owning workspace. Authority is read from here, never from a
  -- request body: an artifact belongs to the organisation, not to whoever
  -- happened to ask for it, who may have left.
  organisation_id           uuid not null,

  -- What kind of thing it is. Reference data as text on purpose (doc 13):
  -- the set grows, and a deployment that has not heard of a type must be
  -- able to store and return one rather than fail. Not a Postgres enum.
  type                      text not null
                              check (type ~ '^[A-Z][A-Z0-9_]{2,47}$'),

  -- What it is about. Exactly one subject, or none: a brief about a
  -- company and an investor organisation at once is two briefs.
  company_id                uuid references core.companies (id) on delete restrict,
  investor_organisation_id  uuid references core.investor_organisations (id) on delete restrict,
  constraint artifacts_one_subject
    check (num_nonnulls(company_id, investor_organisation_id) <= 1),

  -- Preparation is a state of the artifact, not a spinner the browser
  -- invents: somebody who closes the tab while Q composes comes back to an
  -- artifact that says what it is doing. FAILED is a resting state, so an
  -- artifact that could not be composed is not silently absent.
  status                    text not null default 'PREPARING'
                              check (status in ('PREPARING', 'READY', 'FAILED')),

  -- 0 until the first version lands. Maintained beside artifact_versions
  -- rather than derived on every read; the unique constraint there is what
  -- actually stops two versions claiming the same number.
  current_version           integer not null default 0 check (current_version >= 0),

  -- ADR-001's eight-value set, lowercase. An artifact starts visible to
  -- the organisation that owns it and to nobody else; becoming anything
  -- wider is a deliberate act that does not exist yet.
  visibility_scope          text not null default 'organisation_private'
                              check (visibility_scope in (
                                'personal_private', 'organisation_private',
                                'founder_private', 'investor_private',
                                'relationship_shared', 'specifically_shared',
                                'network_visible', 'public_external')),

  -- Provenance only, as everywhere else: who asked, not who may read.
  created_by_user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,

  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete restrict
);

comment on table artifacts.artifacts is
  'Something Q composed, across all its versions. Owner-scoped derived material: never canonical truth, never verified evidence, and never visible to anybody outside the owning organisation by existing.';
comment on column artifacts.artifacts.type is
  'Reference data, not an enum: the set of artifact types grows, and an older deployment must be able to store and return one it has never heard of.';
comment on column artifacts.artifacts.status is
  'PREPARING, READY or FAILED. A real state of the artifact so a reader who comes back mid-composition is told what is happening, and a composition that failed is visible rather than absent.';
comment on column artifacts.artifacts.current_version is
  'The highest version that exists, or 0 before the first one lands. A cache of artifact_versions; that table''s unique (artifact_id, version) is what enforces the sequence.';

create index artifacts_owner_idx
  on artifacts.artifacts (tenant_id, organisation_id, updated_at desc)
  where archived_at is null;
create index artifacts_company_idx
  on artifacts.artifacts (tenant_id, company_id, updated_at desc)
  where company_id is not null and archived_at is null;
create index artifacts_investor_idx
  on artifacts.artifacts (tenant_id, investor_organisation_id, updated_at desc)
  where investor_organisation_id is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- The versions: append-only.
-- ---------------------------------------------------------------------------

create table artifacts.artifact_versions (
  id                  uuid primary key default gen_random_uuid(),
  artifact_id         uuid not null references artifacts.artifacts (id) on delete cascade,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,

  version             integer not null check (version >= 1),

  title               text not null check (length(btrim(title)) between 1 and 160),
  summary             text not null check (length(btrim(summary)) between 1 and 600),

  -- The composed content, written only through the public artifact content
  -- contract. That contract has no member that could carry chain-of-thought,
  -- a tool scratchpad, a retrieval chunk or a provider payload, so what
  -- cannot be expressed there cannot be stored here. The size bound is the
  -- second line of defence, not the first.
  content             jsonb not null
                        check (jsonb_typeof(content) = 'object'),
  constraint artifact_versions_content_bounded
    check (length(content::text) <= 200000),

  -- Why this version exists, in the person's own words. Null on the first,
  -- which nobody revised into being.
  instruction         text check (instruction is null or length(instruction) <= 2000),

  -- The Q run that composed it. Provenance for "where did this sentence
  -- come from", never authorisation to read anything.
  composed_by_run_id  uuid,

  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now(),

  -- What actually stops two versions claiming the same number, including
  -- when two people ask Q to revise the same artifact at the same moment.
  unique (artifact_id, version)
);

comment on table artifacts.artifact_versions is
  'One composed version of an artifact, append-only. A revision writes a new row; the previous version stays readable, because somebody who sent a brief last week needs to see what they sent.';
comment on column artifacts.artifact_versions.content is
  'The version''s sections and gaps, validated through the public Q artifact content contract on write. No internal state, provider payload or private evidence reference can be expressed in that contract, so none can be stored here.';
comment on column artifacts.artifact_versions.composed_by_run_id is
  'The Q run that composed this version. Provenance only: holding a run identifier has never been permission to read the run or anything it saw.';

create index artifact_versions_history_idx
  on artifacts.artifact_versions (artifact_id, version desc);

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
--
-- The same posture as gateq: an artifact is a draft about a company's
-- position, which is exactly what nobody agreed to publish. It is read
-- through one controlled projection in the Q API, under an explicit access
-- context, never from a table by a browser.
-- ---------------------------------------------------------------------------

alter table artifacts.artifacts enable row level security;
alter table artifacts.artifact_versions enable row level security;

-- ---------------------------------------------------------------------------
-- Reference data (production, idempotent; mirrored in the local seed)
-- ---------------------------------------------------------------------------

insert into permissions.capabilities (code, description) values
  ('artifact.view',   'Read the organisation''s Q artifacts and their version history.'),
  ('artifact.create', 'Ask Q to prepare an artifact for the organisation.'),
  ('artifact.revise', 'Ask Q to revise an artifact, creating a new version.')
on conflict (code) do update
  set description = excluded.description;

insert into permissions.role_capabilities (role_id, capability_id, effect)
select r.id, c.id, 'ALLOW'
  from permissions.roles r
  join permissions.capabilities c
    on (r.code, c.code) in (
      ('organisation_admin',  'artifact.view'),
      ('organisation_admin',  'artifact.create'),
      ('organisation_admin',  'artifact.revise'),
      -- An ordinary member may read what the organisation holds and ask Q
      -- to prepare and revise their own drafts: composing a brief about
      -- your own company is ordinary work, not an administrative act.
      ('organisation_member', 'artifact.view'),
      ('organisation_member', 'artifact.create'),
      ('organisation_member', 'artifact.revise')
    )
on conflict (role_id, capability_id) do nothing;
