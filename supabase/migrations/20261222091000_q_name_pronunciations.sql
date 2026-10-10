-- W3 (Qatar / Arabic proper-name intelligence): how a name is SAID or
-- WRITTEN, kept per (name entity, scope).
--
-- Two sources only, never a third: a VERIFIED guide (attributed to a named
-- source, such as the person's own recording; the source reference is
-- required) or the person's own CORRECTION ("it's pronounced KISH-ta",
-- "the name is spelled Qishta"). Q never derives a pronunciation from a
-- spelling and stores it as verified, so there is no column or path for it.
--
-- The name entity is `name_key`: the sound-form key from
-- @capital-q/q-core/names (Qishta, Kishta and Qeshta share one key).
-- Scope is a user (their own) or an organisation (shared by its members,
-- same tenant). Append-only: a correction is a new row, the latest wins,
-- so history is kept. Server-only like every q_runtime table: RLS on with
-- no policies, no client grants; the Q API reads and writes it as the
-- actor and filters by tenant and owner in every statement.

create table q_runtime.name_pronunciations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  scope           text not null check (scope in ('user', 'organisation')),
  user_id         uuid references identity.user_profiles (id) on delete cascade,
  organisation_id uuid,
  name_key        text not null check (length(name_key) between 1 and 200),
  display_name    text not null check (length(display_name) between 1 and 120),
  kind            text not null check (kind in ('pronunciation', 'spelling')),
  value           text not null check (length(value) between 1 and 120),
  source          text not null check (source in ('VERIFIED_GUIDE', 'PERSON_STATED', 'USER_CORRECTION')),
  source_ref      text check (source_ref is null or length(source_ref) between 1 and 200),
  -- Who recorded it (for an organisation-scoped row, a member).
  created_by      uuid not null references identity.user_profiles (id) on delete cascade,
  created_at      timestamptz not null default clock_timestamp(),

  constraint name_pronunciations_scope_owner_check check (
    (scope = 'user' and user_id is not null and organisation_id is null)
    or (scope = 'organisation' and organisation_id is not null and user_id is null)),
  -- Verified means attributed: no source reference, no verified row.
  constraint name_pronunciations_verified_needs_source_check check (
    source <> 'VERIFIED_GUIDE' or source_ref is not null),
  -- A user's own correction can never carry a verification source.
  constraint name_pronunciations_correction_unverified_check check (
    source <> 'USER_CORRECTION' or source_ref is null),
  foreign key (organisation_id, tenant_id)
    references identity.organisations (id, tenant_id) on delete cascade
);

comment on table q_runtime.name_pronunciations is
  'How a name is said or written, per (name_key, scope): VERIFIED_GUIDE (source required), PERSON_STATED, or USER_CORRECTION (never verified). Append-only history; latest row wins. Server-only. Feeds the GPT-Live pronunciation hint list.';

create index name_pronunciations_user_idx
  on q_runtime.name_pronunciations (tenant_id, user_id, name_key, kind, created_at desc)
  where scope = 'user';
create index name_pronunciations_org_idx
  on q_runtime.name_pronunciations (tenant_id, organisation_id, name_key, kind, created_at desc)
  where scope = 'organisation';

alter table q_runtime.name_pronunciations enable row level security;

-- No policies and no client grants (as every q_runtime table). No update:
-- corrections are new rows. Delete lets a person erase what they stored.
revoke all on q_runtime.name_pronunciations from public, anon, authenticated;
grant select, insert, delete on q_runtime.name_pronunciations to postgres, service_role;
