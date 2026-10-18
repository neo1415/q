-- F4 · The investor's GateQ inbox (2026-10-06).
--
--   a submitted application ≠ a CRM record;  the submission stays immutable
--   triage state (folder, star, label, assignee) ≠ the application
--   team notes are organisation_private: never the founder's, never Q's for another firm
--   a pass or a reply is what a person approved, word for word
--
-- Every submitted application at an organisation's gateway lands here. The
-- frozen submission (gateq.application_submissions) is what the founder
-- sent and is never touched; these tables only hold what the organisation
-- does with it. Server-only like every gateq table: RLS on, no policy, no
-- browser grant. The API authorises every read and write through GateQ's
-- own gateway authority (investor.gateway.view / .edit) first; the tenant
-- of every row is asserted by the database to be the application's.

-- ---------------------------------------------------------------------------
-- The promise to founders: "we reply within N working days"
-- ---------------------------------------------------------------------------

create table gateq.inbox_settings (
  gateway_id          uuid primary key references gateq.gateways (id) on delete restrict,
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  -- Null: no promise made, and none is implied.
  reply_within_days   smallint check (reply_within_days between 1 and 60),
  updated_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  updated_at          timestamptz not null default now()
);

comment on table gateq.inbox_settings is
  'F4: a gateway''s published reply promise. Shown to founders before they apply; drives the inbox''s reply-by dates. Never a ranking signal.';

-- ---------------------------------------------------------------------------
-- Per application: where it is and who has it
-- ---------------------------------------------------------------------------

create table gateq.inbox_items (
  application_id    uuid primary key references gateq.applications (id) on delete restrict,
  tenant_id         uuid not null references identity.tenants (id) on delete restrict,
  gateway_id        uuid not null references gateq.gateways (id) on delete restrict,
  folder            text not null default 'INBOX' check (folder in ('INBOX', 'ARCHIVED', 'PASSED')),
  assignee_user_id  uuid references identity.user_profiles (id) on delete restrict,
  updated_at        timestamptz not null default now()
);

create index inbox_items_by_gateway_idx on gateq.inbox_items (tenant_id, gateway_id, folder);

-- Per person: a star is personal, so is having read it.
create table gateq.inbox_user_state (
  application_id  uuid not null references gateq.applications (id) on delete restrict,
  user_id         uuid not null references identity.user_profiles (id) on delete restrict,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  starred         boolean not null default false,
  read_at         timestamptz,
  primary key (application_id, user_id)
);

-- Labels are the organisation's own words, shared by its members.
create table gateq.inbox_labels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  gateway_id          uuid not null references gateq.gateways (id) on delete restrict,
  name                text not null check (length(btrim(name)) between 1 and 40),
  created_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  created_at          timestamptz not null default now()
);

create unique index inbox_labels_one_name_idx on gateq.inbox_labels (gateway_id, lower(btrim(name)));

create table gateq.inbox_item_labels (
  application_id  uuid not null references gateq.applications (id) on delete restrict,
  label_id        uuid not null references gateq.inbox_labels (id) on delete cascade,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  added_at        timestamptz not null default now(),
  primary key (application_id, label_id)
);

-- ---------------------------------------------------------------------------
-- Team notes: organisation_private, append-only
-- ---------------------------------------------------------------------------

create table gateq.inbox_notes (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null references gateq.applications (id) on delete restrict,
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  author_user_id     uuid not null references identity.user_profiles (id) on delete restrict,
  body               text not null check (length(btrim(body)) between 1 and 2000),
  client_request_id  text not null check (client_request_id ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at         timestamptz not null default now(),
  unique (application_id, client_request_id)
);

comment on table gateq.inbox_notes is
  'F4: an organisation''s internal notes on an application. organisation_private: never shown to the founder, never in a download pack, never read by Q for anyone outside this organisation. Append-only.';

-- ---------------------------------------------------------------------------
-- What the organisation said to the founder: approved word for word
-- ---------------------------------------------------------------------------

-- Reference data, not an enum: the words founders get as a reason.
create table gateq.pass_reasons (
  code      text primary key check (code ~ '^[A-Z][A-Z_]{1,39}$'),
  label     text not null check (length(label) between 1 and 80),
  position  smallint not null
);

insert into gateq.pass_reasons (code, label, position) values
  ('OUTSIDE_STAGE', 'Outside our stage', 1),
  ('OUTSIDE_SECTOR', 'Outside our sector', 2),
  ('CHEQUE_DOES_NOT_FIT', 'Cheque doesn''t fit', 3),
  ('TIMING', 'Timing', 4),
  ('OTHER', 'Other', 5);

create table gateq.inbox_messages (
  id                   uuid primary key default gen_random_uuid(),
  application_id       uuid not null references gateq.applications (id) on delete restrict,
  tenant_id            uuid not null references identity.tenants (id) on delete restrict,
  kind                 text not null check (kind in ('PASS', 'REPLY')),
  -- A pass always carries a reason: founders get a useful no.
  reason_code          text references gateq.pass_reasons (code) on delete restrict,
  body                 text not null check (length(btrim(body)) between 1 and 2000),
  -- The exact words approved; a changed word is a different approval.
  body_sha256          text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by_user_id  uuid not null references identity.user_profiles (id) on delete restrict,
  client_request_id    text not null check (client_request_id ~ '^[A-Za-z0-9:_-]{8,128}$'),
  created_at           timestamptz not null default now(),
  check ((kind = 'PASS') = (reason_code is not null)),
  unique (application_id, client_request_id)
);

-- One pass per application: a second would contradict the first.
create unique index inbox_messages_one_pass_idx on gateq.inbox_messages (application_id) where kind = 'PASS';

comment on table gateq.inbox_messages is
  'F4: a pass or a reply to a founder, exactly as a member of the organisation approved it (Prepare -> Recommend -> Approve -> Execute). Append-only; delivery to the founder is a separate, idempotent side effect.';

-- ---------------------------------------------------------------------------
-- What happened: who did what, for the timeline and as the download audit
-- ---------------------------------------------------------------------------

create table gateq.inbox_activity (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null references gateq.applications (id) on delete restrict,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  actor_user_id   uuid references identity.user_profiles (id) on delete restrict,
  kind            text not null check (kind in (
                    'ASSIGNED', 'UNASSIGNED', 'LABELLED', 'UNLABELLED', 'ARCHIVED',
                    'RESTORED', 'PASSED', 'REPLIED', 'NOTED', 'PACK_DOWNLOADED')),
  -- Bounded, typed by kind in the application layer; never free text from a model.
  detail          jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2048),
  created_at      timestamptz not null default now()
);

create index inbox_activity_by_application_idx on gateq.inbox_activity (application_id, created_at);

-- ---------------------------------------------------------------------------
-- Integrity: every row belongs to its application's tenant and gateway,
-- and only a submitted application has an inbox life at all.
-- ---------------------------------------------------------------------------

create or replace function gateq.inbox_row_matches_application()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from gateq.applications a
      join gateq.application_submissions s on s.application_id = a.id
     where a.id = new.application_id
       and a.tenant_id = new.tenant_id
  ) then
    raise exception 'an inbox row belongs to a submitted application in its own tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.inbox_row_matches_application() from public;

create or replace function gateq.inbox_item_matches_gateway()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.applications a
     where a.id = new.application_id and a.gateway_id = new.gateway_id
  ) then
    raise exception 'an inbox item belongs to its application''s gateway'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.inbox_item_matches_gateway() from public;

create or replace function gateq.inbox_gateway_tenant_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1 from gateq.gateways g
     where g.id = new.gateway_id and g.tenant_id = new.tenant_id
  ) then
    raise exception 'a gateway''s inbox row belongs to the gateway''s tenant'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.inbox_gateway_tenant_matches() from public;

-- A label on an application must be one of that application's gateway's labels.
create or replace function gateq.inbox_label_matches_gateway()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not exists (
    select 1
      from gateq.inbox_labels l
      join gateq.applications a on a.gateway_id = l.gateway_id
     where l.id = new.label_id and a.id = new.application_id
  ) then
    raise exception 'a label belongs to the application''s own gateway'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.inbox_label_matches_gateway() from public;

create or replace function gateq.protect_inbox_history()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'inbox notes, messages and activity are history and are never rewritten'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_inbox_history() from public;

create trigger inbox_items_application before insert or update on gateq.inbox_items
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_items_gateway before insert or update on gateq.inbox_items
  for each row execute function gateq.inbox_item_matches_gateway();
create trigger inbox_user_state_application before insert or update on gateq.inbox_user_state
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_item_labels_application before insert on gateq.inbox_item_labels
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_item_labels_gateway before insert on gateq.inbox_item_labels
  for each row execute function gateq.inbox_label_matches_gateway();
create trigger inbox_notes_application before insert on gateq.inbox_notes
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_messages_application before insert on gateq.inbox_messages
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_activity_application before insert on gateq.inbox_activity
  for each row execute function gateq.inbox_row_matches_application();
create trigger inbox_labels_tenant before insert on gateq.inbox_labels
  for each row execute function gateq.inbox_gateway_tenant_matches();
create trigger inbox_settings_tenant before insert or update on gateq.inbox_settings
  for each row execute function gateq.inbox_gateway_tenant_matches();

create trigger inbox_notes_immutable before update or delete on gateq.inbox_notes
  for each row execute function gateq.protect_inbox_history();
create trigger inbox_messages_immutable before update or delete on gateq.inbox_messages
  for each row execute function gateq.protect_inbox_history();
create trigger inbox_activity_immutable before update or delete on gateq.inbox_activity
  for each row execute function gateq.protect_inbox_history();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
-- ---------------------------------------------------------------------------

alter table gateq.inbox_settings enable row level security;
alter table gateq.inbox_items enable row level security;
alter table gateq.inbox_user_state enable row level security;
alter table gateq.inbox_labels enable row level security;
alter table gateq.inbox_item_labels enable row level security;
alter table gateq.inbox_notes enable row level security;
alter table gateq.pass_reasons enable row level security;
alter table gateq.inbox_messages enable row level security;
alter table gateq.inbox_activity enable row level security;

revoke all on gateq.inbox_settings, gateq.inbox_items, gateq.inbox_user_state,
  gateq.inbox_labels, gateq.inbox_item_labels, gateq.inbox_notes, gateq.pass_reasons,
  gateq.inbox_messages, gateq.inbox_activity
  from anon, authenticated;
