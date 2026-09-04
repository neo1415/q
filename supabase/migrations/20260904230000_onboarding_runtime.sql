-- CQ-ONB-001 · Onboarding definition runtime
--
-- Journey state over canonical entities (doc 13 §17). Onboarding owns
-- definitions, sessions, step states, response history and suggestions.
-- It never owns Company, Investor, Capital or Taxonomy truth: confirmed
-- answers reach those domains through registered write-target handlers in
-- the same transaction, and nothing here is a temporary company or investor.
--
--   definition version = immutable once published; sessions pin one
--   session = user-owned; tenant / organisation / subject bind once, one way
--   response = history; content never edited, replacement links forward
--   suggestion = proposal; never truth
--   raw journey tables = INTERNAL_SERVER_ONLY (RLS on, no policies, no grants)

create schema if not exists onboarding;
comment on schema onboarding is
  'Onboarding journey runtime: published definitions, pinned sessions, step states, response history, suggestions. Journey state only; never canonical business truth. Server-internal.';
revoke all on schema onboarding from public;

-- ---------------------------------------------------------------------------
-- onboarding.definitions  (one canonical definition per journey type)
-- ---------------------------------------------------------------------------

create table onboarding.definitions (
  id               uuid primary key default gen_random_uuid(),
  journey_type     text not null unique check (journey_type in ('founder', 'investor', 'external_investor_conversion')),
  name             text not null check (length(btrim(name)) between 1 and 120),
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'RETIRED')),
  -- The published version new sessions receive. Never touches existing sessions.
  current_version  integer check (current_version is null or current_version >= 1),
  created_at       timestamptz not null default now()
);

comment on table onboarding.definitions is
  'One platform-owned journey definition per journey type. current_version = the published version new sessions pin to.';

-- ---------------------------------------------------------------------------
-- onboarding.definition_versions  (immutable once published)
-- ---------------------------------------------------------------------------

create table onboarding.definition_versions (
  id             uuid primary key default gen_random_uuid(),
  definition_id  uuid not null references onboarding.definitions (id) on delete restrict,
  version        integer not null check (version >= 1),
  -- Version-level declarative metadata (schemaVersion, phases, runtime settings). Steps live in onboarding.steps.
  schema         jsonb not null check (jsonb_typeof(schema) = 'object' and (schema ->> 'schemaVersion') = '1'),
  -- SHA-256 of the canonical manifest: republishing the same manifest is idempotent, a different one conflicts.
  manifest_hash  text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  published_at   timestamptz,
  created_at     timestamptz not null default now(),
  unique (definition_id, version)
);

comment on table onboarding.definition_versions is
  'A journey definition version. Once published_at is set the version, its schema and its steps are frozen; change means publishing the next version.';

create or replace function onboarding.protect_published_version() returns trigger
language plpgsql as $$
begin
  if old.published_at is not null then
    if tg_op = 'DELETE' then
      raise exception 'published onboarding definition versions cannot be deleted' using errcode = 'check_violation';
    end if;
    if new.schema is distinct from old.schema
       or new.version is distinct from old.version
       or new.definition_id is distinct from old.definition_id
       or new.manifest_hash is distinct from old.manifest_hash
       or new.published_at is distinct from old.published_at then
      raise exception 'published onboarding definition versions are immutable' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function onboarding.protect_published_version() from public;

create trigger definition_versions_immutable
  before update or delete on onboarding.definition_versions
  for each row execute function onboarding.protect_published_version();

-- ---------------------------------------------------------------------------
-- onboarding.steps  (the executable step graph of a version)
-- ---------------------------------------------------------------------------

create table onboarding.steps (
  id                     uuid primary key default gen_random_uuid(),
  definition_version_id  uuid not null references onboarding.definition_versions (id) on delete restrict,
  step_key               text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  sequence_order         integer not null check (sequence_order >= 0),
  step_type              text not null check (step_type in (
                           'single_select', 'multi_select', 'range', 'short_text', 'long_text',
                           'voice_text', 'document_upload', 'confirmation')),
  required               boolean not null default true,
  -- Interaction semantics validated against the discriminated step schema. No styling.
  configuration          jsonb not null check (jsonb_typeof(configuration) = 'object' and length(configuration::text) <= 16384),
  -- Declarative data DSL over earlier steps (EXISTS / EQUALS / IN / CONTAINS / ALL / ANY / NOT). Never code.
  branching_expression   jsonb check (branching_expression is null or (jsonb_typeof(branching_expression) = 'object' and branching_expression ? 'op')),
  -- Semantic write targets [{"targetKey": "company.stage"}]. Never a table or column.
  writes_to              jsonb not null default '[]'::jsonb check (jsonb_typeof(writes_to) = 'array' and length(writes_to::text) <= 2048),
  unique (definition_version_id, step_key),
  unique (definition_version_id, sequence_order)
);

comment on table onboarding.steps is
  'Executable steps of a definition version. Frozen with their version once published.';

create or replace function onboarding.protect_published_steps() returns trigger
language plpgsql as $$
declare
  v_row onboarding.steps;
  v_published timestamptz;
begin
  if tg_op = 'DELETE' then
    v_row := old;
  else
    v_row := new;
  end if;
  select dv.published_at into v_published
    from onboarding.definition_versions dv
   where dv.id = v_row.definition_version_id;
  if v_published is not null then
    raise exception 'steps of a published onboarding definition version are immutable' using errcode = 'check_violation';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
revoke all on function onboarding.protect_published_steps() from public;

create trigger steps_immutable_when_published
  before insert or update or delete on onboarding.steps
  for each row execute function onboarding.protect_published_steps();

create index steps_version_sequence_idx
  on onboarding.steps (definition_version_id, sequence_order);

-- ---------------------------------------------------------------------------
-- onboarding.sessions  (user-owned journey state; bootstrap allowed)
-- ---------------------------------------------------------------------------

create table onboarding.sessions (
  id                     uuid primary key default gen_random_uuid(),
  -- Null during personal bootstrap; bound once from trusted canonical context.
  tenant_id              uuid references identity.tenants (id) on delete restrict,
  user_id                uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id        uuid references identity.organisations (id) on delete restrict,
  journey_type           text not null check (journey_type in ('founder', 'investor', 'external_investor_conversion')),
  -- Pinned for the life of the session. New versions affect new sessions only.
  definition_version_id  uuid not null references onboarding.definition_versions (id) on delete restrict,
  subject_type           text check (subject_type is null or subject_type in ('COMPANY', 'INVESTOR_ORGANISATION')),
  subject_id             uuid,
  status                 text not null default 'ACTIVE' check (status in ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  -- Navigation state, never canonical progress. Null once the session is no longer active.
  current_step_key       text check (current_step_key is null or current_step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  started_at             timestamptz not null default clock_timestamp(),
  last_activity_at       timestamptz not null default clock_timestamp(),
  completed_at           timestamptz,
  -- Optimistic concurrency token for browser mutations (multi-tab safety).
  version                integer not null default 1 check (version >= 1),

  check ((subject_type is null) = (subject_id is null)),
  check (organisation_id is null or tenant_id is not null),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check (status <> 'ACTIVE' or current_step_key is not null)
);

comment on table onboarding.sessions is
  'A person''s journey through one published definition version. May begin unbound (personal bootstrap); tenant, organisation and subject bind once and never change. Raw journey state is private to the owning user.';

-- One-way binding: NULL -> value, same value idempotent, never a different value.
create or replace function onboarding.enforce_session_binding() returns trigger
language plpgsql as $$
begin
  if old.tenant_id is not null and new.tenant_id is distinct from old.tenant_id then
    raise exception 'an onboarding session cannot change tenant' using errcode = 'check_violation';
  end if;
  if old.organisation_id is not null and new.organisation_id is distinct from old.organisation_id then
    raise exception 'an onboarding session cannot change organisation' using errcode = 'check_violation';
  end if;
  if old.subject_id is not null and (new.subject_id is distinct from old.subject_id or new.subject_type is distinct from old.subject_type) then
    raise exception 'an onboarding session cannot change subject' using errcode = 'check_violation';
  end if;
  if new.user_id is distinct from old.user_id then
    raise exception 'an onboarding session cannot change owner' using errcode = 'check_violation';
  end if;
  if new.definition_version_id is distinct from old.definition_version_id then
    raise exception 'an onboarding session cannot change its pinned definition version' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function onboarding.enforce_session_binding() from public;

create trigger sessions_one_way_binding
  before update on onboarding.sessions
  for each row execute function onboarding.enforce_session_binding();

-- At most one ACTIVE unbound session per user + journey (no duplicate bootstraps) ...
create unique index sessions_active_unbound_uniq
  on onboarding.sessions (user_id, journey_type)
  where status = 'ACTIVE' and subject_id is null;
-- ... and one ACTIVE bound session per user + journey + subject.
create unique index sessions_active_bound_uniq
  on onboarding.sessions (user_id, journey_type, subject_type, subject_id)
  where status = 'ACTIVE' and subject_id is not null;

create index sessions_user_activity_idx
  on onboarding.sessions (user_id, status, last_activity_at desc);
create index sessions_tenant_organisation_idx
  on onboarding.sessions (tenant_id, organisation_id, status)
  where tenant_id is not null;
create index sessions_definition_version_idx
  on onboarding.sessions (definition_version_id);
create index sessions_subject_idx
  on onboarding.sessions (subject_type, subject_id, status)
  where subject_id is not null;

-- ---------------------------------------------------------------------------
-- onboarding.step_states
-- ---------------------------------------------------------------------------

create table onboarding.step_states (
  session_id    uuid not null references onboarding.sessions (id) on delete restrict,
  step_key      text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  status        text not null check (status in ('IN_PROGRESS', 'COMPLETED', 'SKIPPED')),
  entered_at    timestamptz not null default clock_timestamp(),
  completed_at  timestamptz,
  skipped_at    timestamptz,
  primary key (session_id, step_key),
  check ((status = 'COMPLETED') = (completed_at is not null)),
  check ((status = 'SKIPPED') = (skipped_at is not null))
);

comment on table onboarding.step_states is
  'Per-session step state. No row = not yet entered. Skipped is not an answer.';

-- ---------------------------------------------------------------------------
-- onboarding.responses  (history; content immutable; replacement links forward)
-- ---------------------------------------------------------------------------

create table onboarding.responses (
  id                          uuid primary key default gen_random_uuid(),
  session_id                  uuid not null references onboarding.sessions (id) on delete restrict,
  step_key                    text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  response_type               text not null check (response_type in (
                                'SINGLE_SELECT', 'MULTI_SELECT', 'RANGE', 'TEXT', 'RESOURCE_REFERENCE', 'CONFIRMATION')),
  -- Discriminated, bounded value validated against the pinned step. Never arbitrary JSON.
  response_jsonb              jsonb not null check (jsonb_typeof(response_jsonb) = 'object' and length(response_jsonb::text) <= 16384),
  -- What the user actually typed or said (text steps only). Never a deck, a document or a conversation.
  raw_text                    text check (raw_text is null or length(raw_text) between 1 and 4000),
  source_modality             text not null check (source_modality in (
                                'SELECTION', 'TYPED_TEXT', 'VOICE_TRANSCRIPT', 'DOCUMENT_REFERENCE', 'SUGGESTION_ACCEPT', 'SUGGESTION_EDIT')),
  created_at                  timestamptz not null default clock_timestamp(),
  -- Deferred: the old row links forward before the replacement is inserted, so
  -- "one current response per step" holds at every statement boundary.
  superseded_by_response_id   uuid references onboarding.responses (id) on delete restrict deferrable initially deferred,
  check ((response_type = 'TEXT') = (raw_text is not null))
);

comment on table onboarding.responses is
  'Onboarding response history. Current = superseded_by_response_id is null. Content is never edited; a revision inserts a new row and links the old one forward.';

-- Content is immutable; only the forward link may be set, once.
create or replace function onboarding.protect_response_history() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'onboarding responses are history and cannot be deleted' using errcode = 'check_violation';
  end if;
  if new.session_id is distinct from old.session_id
     or new.step_key is distinct from old.step_key
     or new.response_type is distinct from old.response_type
     or new.response_jsonb is distinct from old.response_jsonb
     or new.raw_text is distinct from old.raw_text
     or new.source_modality is distinct from old.source_modality
     or new.created_at is distinct from old.created_at then
    raise exception 'onboarding response content is immutable' using errcode = 'check_violation';
  end if;
  if old.superseded_by_response_id is not null
     and new.superseded_by_response_id is distinct from old.superseded_by_response_id then
    raise exception 'an onboarding response is superseded exactly once' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function onboarding.protect_response_history() from public;

create trigger responses_history_only
  before update or delete on onboarding.responses
  for each row execute function onboarding.protect_response_history();

-- One current response per session + step.
create unique index responses_current_uniq
  on onboarding.responses (session_id, step_key)
  where superseded_by_response_id is null;
create index responses_session_step_idx
  on onboarding.responses (session_id, step_key, created_at desc);
create index responses_superseded_by_idx
  on onboarding.responses (superseded_by_response_id)
  where superseded_by_response_id is not null;

-- ---------------------------------------------------------------------------
-- onboarding.suggestions  (proposals; never truth)
-- ---------------------------------------------------------------------------

create table onboarding.suggestions (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references onboarding.sessions (id) on delete restrict,
  step_key         text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  target_field     text not null check (target_field ~ '^[a-z][a-z0-9_.]{0,79}$'),
  -- Validated against the pinned step's response schema before persistence.
  suggested_value  jsonb not null check (jsonb_typeof(suggested_value) = 'object' and length(suggested_value::text) <= 16384),
  -- Typed bounded references [{sourceType, sourceId}]. No bodies, prompts or URLs.
  source_refs      jsonb not null default '[]'::jsonb check (jsonb_typeof(source_refs) = 'array' and length(source_refs::text) <= 4096),
  confidence       numeric(5, 4) check (confidence is null or (confidence >= 0 and confidence <= 1)),
  status           text not null default 'PENDING' check (status in ('PENDING', 'ACCEPTED', 'EDITED', 'REJECTED', 'EXPIRED')),
  -- Future Q run reference. No FK until the Q runtime tables exist.
  model_run_id     uuid,
  created_at       timestamptz not null default clock_timestamp(),
  resolved_at      timestamptz,
  check ((status = 'PENDING') = (resolved_at is null))
);

comment on table onboarding.suggestions is
  'Proposals for a step (future Q output). Accepting or editing creates a normal validated response; the suggested value itself is never mutated and never becomes truth on its own.';

create index suggestions_session_step_status_idx
  on onboarding.suggestions (session_id, step_key, status);
create index suggestions_session_status_created_idx
  on onboarding.suggestions (session_id, status, created_at);

-- ---------------------------------------------------------------------------
-- Idempotency (hashes only)
-- ---------------------------------------------------------------------------

create table onboarding.session_creation_requests (
  user_id               uuid not null references identity.user_profiles (id) on delete restrict,
  journey_type          text not null,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  session_id            uuid not null references onboarding.sessions (id) on delete restrict,
  created_at            timestamptz not null default now(),
  primary key (user_id, journey_type, idempotency_key_hash)
);

comment on table onboarding.session_creation_requests is
  'Idempotency record for POST /v1/onboarding/sessions: (person, journey, key hash) -> the session created. Hashes only; server-only.';

create table onboarding.session_mutation_requests (
  session_id            uuid not null references onboarding.sessions (id) on delete restrict,
  idempotency_key_hash  text not null check (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  operation             text not null check (operation in ('submit', 'skip', 'resolve_suggestion')),
  request_hash          text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  -- The session version the mutation produced; a replay returns the session as it is now.
  result_version        integer not null check (result_version >= 1),
  created_at            timestamptz not null default now(),
  primary key (session_id, idempotency_key_hash)
);

comment on table onboarding.session_mutation_requests is
  'Idempotency record for session mutations: (session, key hash) -> operation, request hash, resulting version. Hashes only; server-only.';

-- ---------------------------------------------------------------------------
-- Exposure: INTERNAL_SERVER_ONLY for every table. Raw journey state may hold
-- founder-private narrative and investor-private thesis; the API is the boundary.
-- ---------------------------------------------------------------------------

alter table onboarding.definitions enable row level security;
alter table onboarding.definition_versions enable row level security;
alter table onboarding.steps enable row level security;
alter table onboarding.sessions enable row level security;
alter table onboarding.step_states enable row level security;
alter table onboarding.responses enable row level security;
alter table onboarding.suggestions enable row level security;
alter table onboarding.session_creation_requests enable row level security;
alter table onboarding.session_mutation_requests enable row level security;
-- No policies, no anon/authenticated/service_role grants.
