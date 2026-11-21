-- Owner decision 112 (approved 21 Nov 2026) · q_runtime.organisation_etiquette_versions
--
-- "How Q speaks for us": an organisation's own business etiquette guide
-- (ADR 0050), between Capital Q's house guide and a person's own. Q
-- applies the newest version when it writes or speaks for a member of the
-- organisation: house < organisation < person, the later winning on style.
--
-- Mirrors q_runtime.etiquette_guide_versions (the personal guide), with
-- two differences:
--   * organisation_private: every active member of the organisation reads
--     it (the page shows members what Q follows); nobody in a browser
--     writes. The API writes, after asking organisation.admin (owners and
--     admins); a member's write is refused there.
--   * append-only history: a version is never rewritten and never deleted
--     (who changed how Q speaks for the organisation, and when, is kept).
--     The organisation's deletion cascades.
--
-- A guide is reference text for wording, never instruction authority: the
-- Context Firewall, grants, approvals and the Write Gate do not read it.

create table q_runtime.organisation_etiquette_versions (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null,
  organisation_id     uuid not null,
  version             integer not null check (version between 1 and 100000),
  source_kind         text not null check (source_kind in ('PASTE', 'FILE')),
  file_name           text check (file_name is null or length(file_name) between 1 and 200),
  media_type          text check (media_type is null or media_type in (
                        'application/pdf',
                        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        'text/plain',
                        'text/markdown')),
  body                text not null check (length(body) between 1 and 20000),
  body_sha256         text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- Who saved this version (an owner or admin, decided by the API).
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  -- ADR-001: the organisation's own.
  visibility_scope    text not null default 'organisation_private'
                        check (visibility_scope = 'organisation_private'),
  created_at          timestamptz not null default clock_timestamp(),
  -- The organisation must belong to the tenant (relational coherence).
  foreign key (organisation_id, tenant_id)
    references identity.tenant_organisations (organisation_id, tenant_id) on delete cascade,
  unique (tenant_id, organisation_id, version),
  constraint organisation_etiquette_file_check
    check ((source_kind = 'FILE') = (file_name is not null and media_type is not null))
);

-- The guide in force is the newest version: this index serves that read.
create index organisation_etiquette_versions_owner_idx
  on q_runtime.organisation_etiquette_versions (tenant_id, organisation_id, version desc);

-- Append-only: never rewritten, never deleted by anyone (the organisation's
-- own deletion removes it by cascade, which this trigger allows).
create function q_runtime.organisation_etiquette_versions_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    -- A cascade from the organisation's own deletion.
    return old;
  end if;
  raise exception 'q_runtime.organisation_etiquette_versions is append-only; save a new version'
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.organisation_etiquette_versions_append_only() from public;

create trigger organisation_etiquette_versions_append_only
  before update or delete on q_runtime.organisation_etiquette_versions
  for each row execute function q_runtime.organisation_etiquette_versions_append_only();

alter table q_runtime.organisation_etiquette_versions enable row level security;
alter table q_runtime.organisation_etiquette_versions force row level security;

-- Every active member of the organisation reads its guide; nobody else.
create policy organisation_etiquette_versions_select_member
  on q_runtime.organisation_etiquette_versions for select to authenticated
  using ((select private.is_organisation_member(organisation_id)));

revoke all on q_runtime.organisation_etiquette_versions from public, anon, authenticated;
grant select on q_runtime.organisation_etiquette_versions to authenticated;
grant select, insert on q_runtime.organisation_etiquette_versions to postgres, service_role;

comment on table q_runtime.organisation_etiquette_versions is
  'Decision 112: an organisation''s own business etiquette guide (How Q speaks for us), organisation_private; newest version in force; append-only history; written by the API for owners and admins.';
