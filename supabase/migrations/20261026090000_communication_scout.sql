-- Q's scout (founder direction 2026-09-29): on a schedule, Q looks on the
-- public web for what is new about a founder's own company and tells them
-- when they come back. What it found is kept per person so the same page
-- is never announced twice; the page itself is public, and only its
-- address, title and date are kept.

create table communication.scout_findings (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references identity.tenants (id) on delete restrict,
  user_id       uuid not null references identity.user_profiles (id) on delete restrict,
  company_id    uuid not null,
  url           text not null check (url ~ '^https://' and length(url) <= 2048),
  title         text check (title is null or length(title) <= 300),
  published_at  timestamptz,
  created_at    timestamptz not null default clock_timestamp(),
  unique (user_id, url)
);

comment on table communication.scout_findings is
  'Public pages Q''s scheduled scout found about a founder''s own company: address, title and date only, owner-visible, never evidence until the person or Q files it.';

create index scout_findings_user_idx on communication.scout_findings (user_id, created_at desc);

alter table communication.scout_findings enable row level security;

create policy scout_findings_select_own
  on communication.scout_findings for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on communication.scout_findings to authenticated;

-- When the scout last looked for each person, so each is read at most once a day.
create table communication.scout_cursor (
  user_id       uuid primary key references identity.user_profiles (id) on delete restrict,
  last_run_at   timestamptz not null
);

alter table communication.scout_cursor enable row level security;

alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY', 'MEETING_NOTES_READY', 'Q_SCOUT'));
