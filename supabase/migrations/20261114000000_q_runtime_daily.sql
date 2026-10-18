-- The Q Daily (DAILY, docs/specs/2026-10/daily.md).
--
-- A personal newspaper of the news that concerns each person, gathered
-- from public sources, every claim cited. Three tables:
--
-- 1. daily_preferences: how often (weekly by default, daily on request,
--    off), whether it is emailed, which sections, and when the next one is
--    due. One row per person, written by the server only.
-- 2. daily_cluster_issues: one gathering of PUBLIC news per set of PUBLIC
--    topic words per day, shared by everyone who follows the same topics.
--    It holds public-web stories and topic labels only: no person, no
--    tenant, no relationship, no figure of anyone's. Server-only.
-- 3. daily_editions: one person's edition, their own read; history, never
--    deleted; only the delivery columns change after it is written.

create table q_runtime.daily_preferences (
  user_id       uuid primary key references identity.user_profiles (id) on delete restrict,
  tenant_id     uuid not null references identity.tenants (id) on delete restrict,
  frequency     text not null default 'WEEKLY' check (frequency in ('WEEKLY', 'DAILY', 'OFF')),
  email         boolean not null default true,
  sections      text[] not null default array['YOUR_SECTOR', 'YOUR_MARKET', 'DEALS', 'PEOPLE', 'Q_TAKE']
                  check (sections <@ array['YOUR_SECTOR', 'YOUR_MARKET', 'DEALS', 'PEOPLE', 'Q_TAKE']
                         and cardinality(sections) <= 5),
  -- Null while off. The worker claims rows whose time has come.
  next_due_at   timestamptz,
  -- The person asked for an edition now (the reader's button); rate-limited in code.
  requested_at  timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  updated_at    timestamptz not null default clock_timestamp()
);

comment on table q_runtime.daily_preferences is
  'The Q Daily: one person''s delivery preferences and next due time. Server-written; the person reads their own row.';

create index daily_preferences_due_idx
  on q_runtime.daily_preferences (next_due_at)
  where next_due_at is not null;

alter table q_runtime.daily_preferences enable row level security;

create policy daily_preferences_select_own
  on q_runtime.daily_preferences for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.daily_preferences to authenticated;

create table q_runtime.daily_cluster_issues (
  id                uuid primary key default gen_random_uuid(),
  -- A hash of the sorted public topic labels; never a person's identifier.
  cluster_key       text not null check (cluster_key ~ '^[0-9a-f]{64}$'),
  issue_date        date not null,
  topics            jsonb not null check (jsonb_typeof(topics) = 'array' and length(topics::text) <= 4096),
  stories           jsonb not null check (jsonb_typeof(stories) = 'array' and length(stories::text) <= 400000),
  searches_used     integer not null default 0 check (searches_used between 0 and 50),
  model_calls_used  integer not null default 0 check (model_calls_used between 0 and 50),
  created_at        timestamptz not null default clock_timestamp(),
  unique (cluster_key, issue_date)
);

comment on table q_runtime.daily_cluster_issues is
  'The Q Daily: public news gathered once per set of public topic words per day, reused by every edition that follows those topics. Public-web content only; server-internal.';

alter table q_runtime.daily_cluster_issues enable row level security;
-- No policy and no grant: no browser principal reads a shared gathering.

create table q_runtime.daily_editions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  edition_date      date not null,
  number            integer not null check (number >= 1),
  frequency         text not null check (frequency in ('WEEKLY', 'DAILY')),
  cluster_issue_id  uuid references q_runtime.daily_cluster_issues (id) on delete restrict,
  content           jsonb not null check (jsonb_typeof(content) = 'object' and length(content::text) <= 600000),
  searches_used     integer not null default 0 check (searches_used between 0 and 50),
  model_calls_used  integer not null default 0 check (model_calls_used between 0 and 50),
  emailed_at        timestamptz,
  email_error       text check (email_error is null or length(email_error) <= 300),
  created_at        timestamptz not null default clock_timestamp(),
  unique (user_id, edition_date),
  unique (user_id, number)
);

comment on table q_runtime.daily_editions is
  'The Q Daily: one person''s edition (content is the QDailyEdition contract). History: never deleted; only the delivery columns change.';

create index daily_editions_user_date_idx
  on q_runtime.daily_editions (user_id, edition_date desc);

create function q_runtime.daily_editions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'an edition of The Q Daily is history' using errcode = '23514';
  end if;
  if new.id is distinct from old.id
     or new.user_id is distinct from old.user_id
     or new.tenant_id is distinct from old.tenant_id
     or new.edition_date is distinct from old.edition_date
     or new.number is distinct from old.number
     or new.frequency is distinct from old.frequency
     or new.cluster_issue_id is distinct from old.cluster_issue_id
     or new.content is distinct from old.content
     or new.created_at is distinct from old.created_at then
    raise exception 'an edition of The Q Daily is history' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger daily_editions_guard
  before update or delete on q_runtime.daily_editions
  for each row execute function q_runtime.daily_editions_guard();

alter table q_runtime.daily_editions enable row level security;

create policy daily_editions_select_own
  on q_runtime.daily_editions for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.daily_editions to authenticated;
