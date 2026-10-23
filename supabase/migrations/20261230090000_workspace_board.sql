-- Work board (owner 2026-10-23, QA F-14/F-26) · workspace.board_items
--
-- "Save this 12-month plan to my board, then work on those items" failed:
-- the Board kept its pins in one browser tab and nothing on the server, or
-- in Q, could read or change it. This is the person's own work board: the
-- items they (or Q, for them) keep -- a document, a company, a task, a note,
-- a piece of Q's work -- each TODO, DOING or DONE, in an order they choose.
--
--   board_items        one item. Its title, notes, due date, column and
--                      place move; what it is and what it points at never do.
--                      Every change bumps its revision by exactly one.
--   board_item_events  what changed, by whom (the person or Q for them),
--                      revision by revision. Append-only: the item's history
--                      is never rewritten.
--
-- personal_private and INTERNAL_SERVER_ONLY: the API reads and writes these
-- for the signed-in person only, after resolving who they are; no browser
-- principal touches the tables, their own rows included. A person's items go
-- with their account (cascade). Removing an item archives it; history stays.
-- An item is the person's arrangement of their own work, never evidence and
-- never a disclosure: pointing at a company grants nothing about it.

create schema if not exists workspace;
comment on schema workspace is
  'The person''s own workspace: their work board. Server-internal; the API is the only path to it.';
revoke all on schema workspace from public;

-- ---------------------------------------------------------------------------
-- Items
-- ---------------------------------------------------------------------------

create table workspace.board_items (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete cascade,
  user_id          uuid not null references identity.user_profiles (id) on delete cascade,
  -- Reference data, not an enum: what the item is.
  kind             text not null
                     check (kind in ('DOCUMENT', 'COMPANY', 'TASK', 'NOTE', 'WORK_JOB')),
  -- What it points at (a document, a company, a Q job). Required for the
  -- kinds that are a pointer; a task or a note may point at a document.
  ref_id           text check (ref_id is null or ref_id ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{0,199}$'),
  title            text not null check (length(btrim(title)) between 1 and 300),
  notes            text check (notes is null or length(notes) <= 8000),
  status           text not null default 'TODO' check (status in ('TODO', 'DOING', 'DONE')),
  -- Order within a column: numeric (never float), so a move between two
  -- items writes one row.
  position         numeric(30, 10) not null,
  due_on           date,
  -- The Q job working on this item, when Q was asked to. It must be the
  -- same person's job (the composite key below).
  work_job_id      uuid,
  created_by       text not null check (created_by in ('PERSON', 'Q')),
  revision         integer not null default 1 check (revision >= 1),
  -- A retried add writes nothing.
  idempotency_key  uuid not null,
  visibility_scope text not null default 'personal_private'
                     check (visibility_scope = 'personal_private'),
  archived_at      timestamptz,
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default clock_timestamp(),
  constraint board_items_pointer_has_ref
    check (kind not in ('DOCUMENT', 'COMPANY', 'WORK_JOB') or ref_id is not null),
  constraint board_items_work_job_owned
    foreign key (work_job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id)
    on delete set null (work_job_id),
  unique (id, tenant_id, user_id)
);

create unique index board_items_idempotency_key
  on workspace.board_items (tenant_id, user_id, idempotency_key);
create index board_items_owner_column_idx
  on workspace.board_items (tenant_id, user_id, status, position)
  where archived_at is null;
create index board_items_work_job_idx
  on workspace.board_items (work_job_id)
  where work_job_id is not null;

-- What an item is, whose it is and what it points at never change; every
-- change is exactly the next revision; an archived item stays archived.
create function workspace.board_items_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id is distinct from old.id
     or new.tenant_id is distinct from old.tenant_id
     or new.user_id is distinct from old.user_id
     or new.kind is distinct from old.kind
     or new.ref_id is distinct from old.ref_id
     or new.created_by is distinct from old.created_by
     or new.idempotency_key is distinct from old.idempotency_key
     or new.visibility_scope is distinct from old.visibility_scope
     or new.created_at is distinct from old.created_at then
    raise exception 'a board item''s identity, owner and pointer never change'
      using errcode = 'check_violation';
  end if;
  -- A job ending clears work_job_id (on delete set null): not a person's
  -- change, so it is not a revision.
  if new.work_job_id is null and old.work_job_id is not null
     and new.revision = old.revision
     and (new.title, new.notes, new.status, new.position, new.due_on, new.archived_at)
         is not distinct from
         (old.title, old.notes, old.status, old.position, old.due_on, old.archived_at) then
    return new;
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'a board item changes one revision at a time'
      using errcode = 'check_violation';
  end if;
  if old.archived_at is not null then
    raise exception 'an archived board item is not changed'
      using errcode = 'check_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function workspace.board_items_guard() from public;

create trigger board_items_guard
  before update on workspace.board_items
  for each row execute function workspace.board_items_guard();

-- ---------------------------------------------------------------------------
-- History
-- ---------------------------------------------------------------------------

create table workspace.board_item_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  user_id          uuid not null,
  item_id          uuid not null,
  -- The item's revision this change produced.
  revision         integer not null check (revision >= 1),
  action           text not null
                     check (action in ('ADDED', 'EDITED', 'MOVED', 'LINKED_JOB', 'ARCHIVED')),
  -- PERSON: from the board or their own words to Q. Q: Q for them, as
  -- asked (an item it added, a job it finished).
  actor            text not null check (actor in ('PERSON', 'Q')),
  from_status      text check (from_status is null or from_status in ('TODO', 'DOING', 'DONE')),
  to_status        text check (to_status is null or to_status in ('TODO', 'DOING', 'DONE')),
  -- The fields that changed, before and after (bounded).
  changes          jsonb not null default '{}'::jsonb
                     check (jsonb_typeof(changes) = 'object' and pg_column_size(changes) <= 16384),
  -- A retried move or edit writes nothing.
  idempotency_key  uuid,
  created_at       timestamptz not null default clock_timestamp(),
  foreign key (item_id, tenant_id, user_id)
    references workspace.board_items (id, tenant_id, user_id) on delete cascade,
  unique (item_id, revision)
);

create unique index board_item_events_idempotency_key
  on workspace.board_item_events (tenant_id, user_id, idempotency_key)
  where idempotency_key is not null;
create index board_item_events_item_idx
  on workspace.board_item_events (item_id, revision);

create function workspace.board_item_events_append_only() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'workspace.board_item_events is append-only'
    using errcode = 'check_violation';
end;
$$;
revoke all on function workspace.board_item_events_append_only() from public;

create trigger board_item_events_append_only
  before update on workspace.board_item_events
  for each row execute function workspace.board_item_events_append_only();

-- ---------------------------------------------------------------------------
-- Exposure: INTERNAL_SERVER_ONLY. RLS on and forced as a second layer; no
-- policy, and the browser roles (anon, authenticated) hold nothing. The server's roles write;
-- no role is granted delete (an account's deletion cascades).
-- ---------------------------------------------------------------------------

alter table workspace.board_items enable row level security;
alter table workspace.board_items force row level security;
alter table workspace.board_item_events enable row level security;
alter table workspace.board_item_events force row level security;

revoke all on workspace.board_items from public, anon, authenticated;
revoke all on workspace.board_item_events from public, anon, authenticated;
grant usage on schema workspace to postgres, service_role;
grant select, insert, update on workspace.board_items to postgres, service_role;
grant select, insert on workspace.board_item_events to postgres, service_role;

comment on table workspace.board_items is
  'The person''s work board items (personal_private, server-only). Identity and pointer immutable; every change is the next revision, recorded in board_item_events.';
comment on table workspace.board_item_events is
  'Append-only history of a board item: each revision, what changed and whether the person or Q for them changed it.';
