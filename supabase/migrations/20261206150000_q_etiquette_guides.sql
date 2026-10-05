-- How Q conducts business (ADR 0050, founder 2026-10-05): the business
-- etiquette guides Q follows when it writes or speaks for a person.
--
-- Two kinds, two owners, kept apart:
--
--   platform_ops.etiquette_guide_versions  the platform's house guide, set by
--     a platform admin in the operations console. Append-only revisions
--     (who, when, what); which one is in force is a separate pointer, so
--     switching back to an earlier version or to Capital Q's built-in guide
--     rewrites nothing. INTERNAL_SERVER_ONLY like the rest of platform_ops:
--     RLS on, no policy, no client grant. Every change is recorded in
--     platform_ops.admin_actions by the service.
--
--   q_runtime.etiquette_guide_versions  a person's own guide ("How Q speaks
--     for you"), personal_private. Each save is a new version; the newest is
--     in force. Rows are never rewritten. Removing the guide deletes the
--     person's rows: it is their own words about style, not audit history
--     or evidence, and "remove" should mean gone. The owner may read their
--     own rows through RLS; every write goes through the Q API under the
--     person's resolved actor.
--
-- A guide is reference text for wording, never instruction authority: the
-- Context Firewall, grants, approvals and the Write Gate are code and do not
-- read these tables. The text is what was pasted, or what the person's own
-- browser extracted from their file; no file bytes are stored.

-- ---------------------------------------------------------------------------
-- The platform guide
-- ---------------------------------------------------------------------------

create table platform_ops.etiquette_guide_versions (
  id            uuid primary key default gen_random_uuid(),
  version       integer not null unique check (version between 1 and 100000),
  title         text not null check (length(title) between 1 and 120),
  -- PASTE: typed or pasted; FILE: extracted from an uploaded file.
  source_kind   text not null check (source_kind in ('PASTE', 'FILE')),
  file_name     text check (file_name is null or length(file_name) between 1 and 200),
  media_type    text check (media_type is null or media_type in (
                  'application/pdf',
                  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'text/plain',
                  'text/markdown')),
  body          text not null check (length(body) between 1 and 60000),
  body_sha256   text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_by    uuid not null references identity.user_profiles (id) on delete restrict,
  created_at    timestamptz not null default clock_timestamp(),
  constraint etiquette_guide_versions_file_check
    check ((source_kind = 'FILE') = (file_name is not null and media_type is not null))
);

-- Which version is in force: one row at most; none (or a null version)
-- means Capital Q's built-in guide.
create table platform_ops.etiquette_guide_active (
  singleton     boolean primary key default true check (singleton),
  version_id    uuid references platform_ops.etiquette_guide_versions (id) on delete restrict,
  updated_by    uuid not null references identity.user_profiles (id) on delete restrict,
  updated_at    timestamptz not null default clock_timestamp()
);

-- Revisions are history: no update, no delete.
create function platform_ops.etiquette_guide_versions_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'platform_ops.etiquette_guide_versions is append-only'
    using errcode = 'check_violation';
end;
$$;
revoke all on function platform_ops.etiquette_guide_versions_append_only() from public;

create trigger etiquette_guide_versions_append_only
  before update or delete on platform_ops.etiquette_guide_versions
  for each row execute function platform_ops.etiquette_guide_versions_append_only();

alter table platform_ops.etiquette_guide_versions enable row level security;
alter table platform_ops.etiquette_guide_active enable row level security;

revoke all on platform_ops.etiquette_guide_versions from public, anon, authenticated;
revoke all on platform_ops.etiquette_guide_active from public, anon, authenticated;
grant select, insert on platform_ops.etiquette_guide_versions to postgres, service_role;
grant select, insert, update, delete on platform_ops.etiquette_guide_active to postgres, service_role;

comment on table platform_ops.etiquette_guide_versions is
  'ADR 0050: the platform business etiquette guide, append-only revisions. Server-only; changes audited in admin_actions.';
comment on table platform_ops.etiquette_guide_active is
  'ADR 0050: which platform etiquette guide version is in force (none: the built-in guide). Server-only.';

-- ---------------------------------------------------------------------------
-- A person's own guide
-- ---------------------------------------------------------------------------

create table q_runtime.etiquette_guide_versions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete cascade,
  user_id           uuid not null references identity.user_profiles (id) on delete cascade,
  version           integer not null check (version between 1 and 100000),
  source_kind       text not null check (source_kind in ('PASTE', 'FILE')),
  file_name         text check (file_name is null or length(file_name) between 1 and 200),
  media_type        text check (media_type is null or media_type in (
                      'application/pdf',
                      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                      'text/plain',
                      'text/markdown')),
  body              text not null check (length(body) between 1 and 20000),
  body_sha256       text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- ADR-001: only ever the owner's.
  visibility_scope  text not null default 'personal_private'
                      check (visibility_scope = 'personal_private'),
  created_at        timestamptz not null default clock_timestamp(),
  unique (tenant_id, user_id, version),
  constraint etiquette_personal_file_check
    check ((source_kind = 'FILE') = (file_name is not null and media_type is not null))
);

-- The guide in force is the newest version: this index serves that read.
create index etiquette_guide_versions_owner_idx
  on q_runtime.etiquette_guide_versions (tenant_id, user_id, version desc);

-- A version is never rewritten; deleting is allowed (the owner removing it).
create function q_runtime.etiquette_guide_versions_no_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.etiquette_guide_versions are never rewritten; save a new version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.etiquette_guide_versions_no_update() from public;

create trigger etiquette_guide_versions_no_update
  before update on q_runtime.etiquette_guide_versions
  for each row execute function q_runtime.etiquette_guide_versions_no_update();

alter table q_runtime.etiquette_guide_versions enable row level security;
alter table q_runtime.etiquette_guide_versions force row level security;

create policy etiquette_guide_versions_select_own
  on q_runtime.etiquette_guide_versions for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

revoke all on q_runtime.etiquette_guide_versions from public, anon, authenticated;
grant select on q_runtime.etiquette_guide_versions to authenticated;
grant select, insert, delete on q_runtime.etiquette_guide_versions to postgres, service_role;

comment on table q_runtime.etiquette_guide_versions is
  'ADR 0050: a person''s own business etiquette guide (How Q speaks for you), personal_private; newest version in force; never rewritten; deleted on removal.';
