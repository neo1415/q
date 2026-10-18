-- R34 safety · Block and report on relationship chat (doc 10: messaging
-- without block/report is unsafe; ADR 0019).
--
-- communication.report_reasons   reference data: why a person reports
-- communication.blocks           one side of a relationship stops messages
--                                in both directions until it lifts the block
-- communication.reports          a person flags a message or a thread for
--                                Capital Q's integrity review
--
-- Who reads what: only active members of the blocking (or reporting)
-- organisation read their own rows. The blocked side never reads a block
-- row: the server tells it only "You can't message this relationship right
-- now", never who blocked. No client role writes anything here; the server
-- writes after authorising the person as a party.
--
-- Defence in depth: while a block is active, no new message or edit can be
-- inserted on that relationship's thread, even by the server role. Unsending
-- one's own message (a tombstone) stays possible.
--
-- Additive only.

-- ---------------------------------------------------------------------------
-- communication.report_reasons (reference data, never a Postgres enum)
-- ---------------------------------------------------------------------------

create table communication.report_reasons (
  code        text primary key check (code ~ '^[A-Z][A-Z_]{1,39}$'),
  label       text not null check (length(label) between 1 and 80),
  sort_order  integer not null,
  active      boolean not null default true
);

comment on table communication.report_reasons is
  'Reference data: the reasons a person can give when reporting a chat message or thread.';

alter table communication.report_reasons enable row level security;

create policy report_reasons_select_active
  on communication.report_reasons for select to authenticated
  using (active);

grant select on communication.report_reasons to authenticated;

insert into communication.report_reasons (code, label, sort_order) values
  ('SPAM',          'Spam or unwanted messages',       10),
  ('HARASSMENT',    'Harassment or abuse',             20),
  ('INAPPROPRIATE', 'Inappropriate content',           30),
  ('MISLEADING',    'Misleading or false information', 40),
  ('SCAM',          'Scam or fraud',                   50),
  ('PRIVACY',       'Shares private information',      60),
  ('OTHER',         'Something else',                  70);

-- ---------------------------------------------------------------------------
-- communication.blocks
-- ---------------------------------------------------------------------------

create table communication.blocks (
  id                        uuid primary key default gen_random_uuid(),
  -- The relationship's tenant (ADR 0003), never an input.
  tenant_id                 uuid not null,
  relationship_id           uuid not null,
  -- The side that blocked, and the person who pressed Block for it.
  blocker_organisation_id   uuid not null references identity.organisations (id) on delete restrict,
  blocker_user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  blocker_side              text not null check (blocker_side in ('COMPANY', 'INVESTOR')),
  -- The other party organisation on the relationship.
  blocked_organisation_id   uuid not null references identity.organisations (id) on delete restrict,
  idempotency_key           text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at                timestamptz not null default clock_timestamp(),
  lifted_at                 timestamptz,
  lifted_by_user_id         uuid references identity.user_profiles (id) on delete restrict,
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict,
  check (blocker_organisation_id <> blocked_organisation_id),
  check ((lifted_at is null) = (lifted_by_user_id is null)),
  check (lifted_at is null or lifted_at >= created_at)
);

comment on table communication.blocks is
  'A party side stopped messaging on a relationship (both directions) until it lifts the block. History is kept: a lift sets lifted_at, the row stays.';

-- At most one active block per side per relationship.
create unique index blocks_one_active_per_side
  on communication.blocks (relationship_id, blocker_organisation_id)
  where lifted_at is null;
create unique index blocks_blocker_idempotency
  on communication.blocks (blocker_user_id, idempotency_key);
create index blocks_relationship_active_idx
  on communication.blocks (relationship_id) where lifted_at is null;
create index blocks_blocker_organisation_idx
  on communication.blocks (blocker_organisation_id, created_at desc);

-- A block is never rewritten: the only change is lifting it, once.
create function private.communication_blocks_lift_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'communication.blocks keeps its history'
      using errcode = '55000';
  end if;
  if old.lifted_at is not null
     or new.lifted_at is null
     or (new.id, new.tenant_id, new.relationship_id, new.blocker_organisation_id,
         new.blocker_user_id, new.blocker_side, new.blocked_organisation_id,
         new.idempotency_key, new.created_at)
        is distinct from
        (old.id, old.tenant_id, old.relationship_id, old.blocker_organisation_id,
         old.blocker_user_id, old.blocker_side, old.blocked_organisation_id,
         old.idempotency_key, old.created_at) then
    raise exception 'a block can only be lifted, once'
      using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function private.communication_blocks_lift_only() from public, anon, authenticated;

create trigger blocks_lift_only
  before update or delete on communication.blocks
  for each row execute function private.communication_blocks_lift_only();

alter table communication.blocks enable row level security;

-- The blocking organisation's own members only. The blocked side reads
-- nothing here (it is never told who blocked).
create policy blocks_select_own_organisation
  on communication.blocks for select to authenticated
  using ((select private.is_organisation_member(blocker_organisation_id)));

grant select on communication.blocks to authenticated;

-- ---------------------------------------------------------------------------
-- No new message while a block is active (second wall behind the server).
-- ---------------------------------------------------------------------------

create function private.communication_messages_block_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.kind = 'TOMBSTONE' then
    return new;
  end if;
  if exists (
    select 1
      from communication.conversations c
      join communication.blocks b
        on b.relationship_id = c.relationship_id and b.lifted_at is null
     where c.id = new.conversation_id
  ) then
    raise exception 'messaging is blocked on this relationship'
      using errcode = '55000';
  end if;
  return new;
end
$$;

revoke all on function private.communication_messages_block_guard() from public, anon, authenticated;

create trigger messages_block_guard
  before insert on communication.messages
  for each row execute function private.communication_messages_block_guard();

-- ---------------------------------------------------------------------------
-- communication.reports
-- ---------------------------------------------------------------------------

create table communication.reports (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null,
  relationship_id            uuid not null,
  -- A single message on the thread, or null for the thread as a whole.
  message_id                 uuid references communication.messages (id) on delete restrict,
  reporter_organisation_id   uuid not null references identity.organisations (id) on delete restrict,
  reporter_user_id           uuid not null references identity.user_profiles (id) on delete restrict,
  reason_code                text not null references communication.report_reasons (code) on delete restrict,
  note                       text check (note is null or length(note) between 1 and 500),
  -- Integrity review lifecycle. A report is opened here; review lands later.
  status                     text not null default 'OPEN' check (status in ('OPEN', 'IN_REVIEW', 'CLOSED')),
  idempotency_key            text not null check (length(idempotency_key) between 8 and 200 and idempotency_key !~ '[[:cntrl:]]'),
  created_at                 timestamptz not null default clock_timestamp(),
  foreign key (relationship_id, tenant_id)
    references network.relationships (id, tenant_id) on delete restrict
);

comment on table communication.reports is
  'A person flagged a chat message or thread for Capital Q integrity review (R34 safety). Visible only to the reporting organisation.';

create unique index reports_reporter_idempotency
  on communication.reports (reporter_user_id, idempotency_key);
create index reports_open_idx
  on communication.reports (created_at) where status = 'OPEN';
create index reports_reporter_organisation_idx
  on communication.reports (reporter_organisation_id, created_at desc);
create index reports_message_idx
  on communication.reports (message_id) where message_id is not null;

alter table communication.reports enable row level security;

create policy reports_select_own_organisation
  on communication.reports for select to authenticated
  using ((select private.is_organisation_member(reporter_organisation_id)));

grant select on communication.reports to authenticated;
