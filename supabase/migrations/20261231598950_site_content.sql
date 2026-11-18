-- Decision 107 (owner, 2026-11-18): the content editor (CMS) in the admin
-- console. It edits the landing sections, the pricing page, the FAQ and the
-- legal pages, with versions, preview and publish.
--
-- Shape:
--   pages               one row per page or landing section (slug, kind, title, status)
--   page_versions       immutable snapshots of a page's blocks (typed JSON,
--                       validated by the server's Zod schema before insert)
--   page_drafts         the one working copy per page that autosave writes
--   published_pointers  which version, if any, the public reads
--   publish_events      append-only history of publish / unpublish / restore
--   settings            the singleton that resolves {{PLACEHOLDERS}}
--
-- Everything is server-only: RLS on, no client grants, no policies. The
-- public reads published content through the API, never from the table;
-- writes come only from the admin console (identity.platform_admins role,
-- live step-up, audited in platform_ops.admin_actions).

create schema if not exists site_content;
revoke all on schema site_content from public, anon, authenticated;

create table site_content.pages (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique
                   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 64),
  kind           text not null
                   check (kind in ('landing-section', 'pricing', 'faq', 'legal')),
  title          text not null check (length(btrim(title)) between 1 and 200),
  summary        text not null default '' check (length(summary) <= 600),
  -- DRAFT: never published. DRAFT_PENDING_LEGAL_REVIEW: a legal page that
  -- waits for a lawyer; only an admin's explicit publish changes it.
  -- PUBLISHED: a version is live. UNPUBLISHED: was live, taken down.
  status         text not null default 'DRAFT'
                   check (status in ('DRAFT', 'DRAFT_PENDING_LEGAL_REVIEW', 'PUBLISHED', 'UNPUBLISHED')),
  sort_order     integer check (sort_order between 0 and 1000),
  anchor         text check (anchor ~ '^[a-z][a-z0-9-]{0,40}$'),
  effective_date date,
  created_at     timestamptz not null default clock_timestamp(),
  updated_at     timestamptz not null default clock_timestamp(),
  -- Legal pages never skip review silently: a legal page starts pending.
  constraint pages_legal_starts_reviewed check (
    kind <> 'legal' or status <> 'DRAFT'
  )
);

comment on table site_content.pages is
  'Decision 107: one page or landing section of the public site. Server-only; written by the admin console.';

create table site_content.page_versions (
  id                    uuid primary key default gen_random_uuid(),
  page_id               uuid not null references site_content.pages (id) on delete restrict,
  version_number        integer not null check (version_number >= 1),
  title                 text not null check (length(btrim(title)) between 1 and 200),
  summary               text not null default '' check (length(summary) <= 600),
  -- Blocks as typed JSON. The API validates them with the contract's Zod
  -- schema (and sanitises rich text) before insert; the database keeps the
  -- outer shape honest as a second layer.
  blocks                jsonb not null
                          check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 400),
  -- Images this version shows, pinned to the exact scanned document
  -- version, so the public image route can answer without reading blocks.
  image_assets          jsonb not null default '[]'::jsonb
                          check (jsonb_typeof(image_assets) = 'array'),
  source                text not null check (source in ('SEED', 'EDITOR', 'RESTORE')),
  restored_from_version integer,
  author_user_id        uuid references identity.user_profiles (id) on delete restrict,
  created_at            timestamptz not null default clock_timestamp(),
  unique (page_id, version_number),
  unique (page_id, id),
  -- Only the seed has no person behind it.
  constraint page_versions_authored check (author_user_id is not null or source = 'SEED'),
  constraint page_versions_restore_names_source check (
    (source = 'RESTORE') = (restored_from_version is not null)
  )
);

comment on table site_content.page_versions is
  'Decision 107: immutable snapshots of a page. Never updated or deleted; a correction is a new version.';

create table site_content.page_drafts (
  page_id        uuid primary key references site_content.pages (id) on delete restrict,
  title          text not null check (length(btrim(title)) between 1 and 200),
  summary        text not null default '' check (length(summary) <= 600),
  blocks         jsonb not null
                   check (jsonb_typeof(blocks) = 'array' and jsonb_array_length(blocks) <= 400),
  -- Optimistic concurrency for autosave: a stale tab cannot overwrite.
  revision       integer not null default 1 check (revision >= 1),
  -- The version this draft was last made from or published as.
  base_version   integer,
  updated_by     uuid references identity.user_profiles (id) on delete restrict,
  updated_at     timestamptz not null default clock_timestamp()
);

comment on table site_content.page_drafts is
  'Decision 107: the working copy autosave writes. Never read by the public.';

create table site_content.published_pointers (
  page_id       uuid primary key,
  version_id    uuid not null,
  published_by  uuid references identity.user_profiles (id) on delete restrict,
  published_at  timestamptz not null default clock_timestamp(),
  -- The pointer can only name a version of the same page.
  foreign key (page_id, version_id)
    references site_content.page_versions (page_id, id) on delete restrict
);

comment on table site_content.published_pointers is
  'Decision 107: the version of each page the public reads. No row: nothing is public.';

create table site_content.publish_events (
  id             bigint generated by default as identity primary key,
  page_id        uuid not null references site_content.pages (id) on delete restrict,
  version_id     uuid references site_content.page_versions (id) on delete restrict,
  version_number integer,
  action         text not null check (action in ('PUBLISH', 'UNPUBLISH', 'RESTORE_TO_DRAFT')),
  actor_user_id  uuid references identity.user_profiles (id) on delete restrict,
  reason         text check (reason is null or length(btrim(reason)) between 3 and 500),
  occurred_at    timestamptz not null default clock_timestamp(),
  constraint publish_events_seed_only_anonymous check (
    actor_user_id is not null or (action = 'PUBLISH' and reason is null)
  )
);

create index publish_events_page_idx on site_content.publish_events (page_id, occurred_at desc);

comment on table site_content.publish_events is
  'Decision 107: append-only history of what went live, when and by whom. A null actor is the seed.';

create table site_content.settings (
  singleton           boolean primary key default true check (singleton),
  company_name        text not null default 'Capital Q' check (length(btrim(company_name)) between 1 and 120),
  legal_entity        text check (legal_entity is null or length(legal_entity) <= 200),
  registered_address  text check (registered_address is null or length(registered_address) <= 400),
  contact_email       text check (contact_email is null or contact_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  governing_law_city  text check (governing_law_city is null or length(governing_law_city) <= 120),
  revision            integer not null default 1 check (revision >= 1),
  updated_by          uuid references identity.user_profiles (id) on delete restrict,
  updated_at          timestamptz not null default clock_timestamp()
);

insert into site_content.settings (singleton) values (true);

comment on table site_content.settings is
  'Decision 107: the one record that resolves {{COMPANY_NAME}} and the other placeholders at render time.';

-- Immutability: versions and the publish history are never rewritten.
create function site_content.refuse_rewrite()
  returns trigger
  language plpgsql
  set search_path = pg_catalog
as $$
begin
  raise exception 'site_content.%: rows are immutable; write a new one', tg_table_name
    using errcode = 'P0001';
end
$$;
revoke all on function site_content.refuse_rewrite() from public, anon, authenticated;

create trigger page_versions_immutable
  before update or delete on site_content.page_versions
  for each row execute function site_content.refuse_rewrite();
create trigger publish_events_append_only
  before update or delete on site_content.publish_events
  for each row execute function site_content.refuse_rewrite();
create trigger settings_undeletable
  before delete on site_content.settings
  for each row execute function site_content.refuse_rewrite();

alter table site_content.pages enable row level security;
alter table site_content.page_versions enable row level security;
alter table site_content.page_drafts enable row level security;
alter table site_content.published_pointers enable row level security;
alter table site_content.publish_events enable row level security;
alter table site_content.settings enable row level security;

revoke all on all tables in schema site_content from public, anon, authenticated;
revoke all on all sequences in schema site_content from public, anon, authenticated;

-- The server's own roles only, and only the verbs the store uses.
grant usage on schema site_content to service_role;
grant select, insert, update on site_content.pages, site_content.page_drafts, site_content.settings to service_role;
grant select, insert on site_content.page_versions, site_content.publish_events to service_role;
grant select, insert, update, delete on site_content.published_pointers to service_role;
grant usage on all sequences in schema site_content to service_role;
