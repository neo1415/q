-- GateQ atomic statements, slice 1: foundations only (design
-- docs/ai-handoff/design/2026-11-14-gateq-atomic-statements.md; owner
-- directive 2026-11-14 item 3). Nothing reads or writes these tables yet.
--
--   a statement is what was said, once, with its words and provenance
--   a link says how a newer statement relates to an older one
--   the view is a deterministic projection; no stored concatenated text is truth
--   a turn reading is the authoritative result of reading one PERSON turn
--
-- Additive only. gateq.application_facts keeps working beside these tables.
-- All four are append-only, tenant-bound to their application, closed once the
-- application is SUBMITTED, and server-only (RLS on, no policy, no grant).

-- ---------------------------------------------------------------------------
-- Composite keys the new foreign keys bind to. A statement can only cite a
-- turn of its own application and tenant, so the FK itself carries scope.
-- ---------------------------------------------------------------------------

alter table gateq.application_turns
  add constraint application_turns_scope_key unique (id, application_id, tenant_id);

-- ---------------------------------------------------------------------------
-- Statements
-- ---------------------------------------------------------------------------

create table gateq.application_statements (
  id              uuid primary key default gen_random_uuid(),
  application_id  uuid not null,
  tenant_id       uuid not null references identity.tenants (id) on delete restrict,
  -- Bounded vocabulary, validated again by Zod at the service boundary.
  dimension       text not null check (dimension ~ '^[a-z][a-z0-9_.]{0,63}$'),
  -- A closed metric key (weekly_active_users, mrr, ...) when the statement is
  -- a number about one quantity. Null for prose and codes.
  quantity        text check (quantity is null or quantity ~ '^[a-z][a-z0-9_]{0,63}$'),
  value_kind      text not null check (value_kind in ('TEXT', 'CODE', 'MONEY', 'COUNT', 'PERCENT', 'ZERO', 'UNKNOWN')),
  -- A bounded payload whose shape is fixed by value_kind. Never free JSON.
  value           jsonb not null check (jsonb_typeof(value) = 'object' and pg_column_size(value) <= 4096),
  -- The date the figure describes, when the founder gave or implied one.
  -- Unknown stays null; it is never defaulted to "today".
  as_of           date,
  -- The founder's exact words for this statement.
  words           text not null check (length(words) between 1 and 2000),
  provenance      text not null check (provenance in ('APPLICANT_PROVIDED', 'DOCUMENT_SUPPORTED', 'ESTIMATED', 'UNKNOWN')),
  origin          text not null check (origin in ('TURN', 'FORM', 'DOCUMENT_CONFIRMED', 'BACKFILL')),
  -- The PERSON turn the statement was read from.
  source_turn_id  uuid,
  -- BACKFILL only: the idempotency key of the legacy fact line it came from.
  backfill_key    text unique check (backfill_key is null or backfill_key ~ '^[A-Za-z0-9:._-]{1,200}$'),
  -- When it was said. Defaults to now; a BACKFILL statement carries the
  -- legacy fact's own time so history keeps its order.
  stated_at       timestamptz not null default clock_timestamp(),
  recorded_at     timestamptz not null default clock_timestamp(),

  constraint application_statements_application
    foreign key (application_id, tenant_id) references gateq.applications (id, tenant_id) on delete restrict,
  constraint application_statements_source_turn
    foreign key (source_turn_id, application_id, tenant_id)
    references gateq.application_turns (id, application_id, tenant_id) on delete restrict,
  constraint application_statements_scope_key unique (id, application_id, tenant_id),

  -- Asked and not known is the UNKNOWN kind and nothing else.
  constraint application_statements_unknown_provenance
    check ((value_kind = 'UNKNOWN') = (provenance = 'UNKNOWN')),
  -- A metric quantity is a number (or a stated zero, or not known).
  constraint application_statements_quantity_kind
    check (quantity is null or value_kind in ('MONEY', 'COUNT', 'PERCENT', 'ZERO', 'UNKNOWN')),
  constraint application_statements_turn_origin
    check (origin <> 'TURN' or source_turn_id is not null),
  constraint application_statements_form_origin
    check (origin <> 'FORM' or source_turn_id is null),
  constraint application_statements_backfill_key
    check ((origin = 'BACKFILL') = (backfill_key is not null)),
  constraint application_statements_value_shape check (
    case value_kind
      when 'TEXT' then
        value ? 'text' and value - 'text' = '{}'::jsonb
        and jsonb_typeof(value -> 'text') = 'string'
        and length(value ->> 'text') between 1 and 2000
      when 'CODE' then
        value ? 'code' and value - 'code' = '{}'::jsonb
        and jsonb_typeof(value -> 'code') = 'string'
        and (value ->> 'code') ~ '^[A-Za-z][A-Za-z0-9_-]{0,63}$'
      when 'MONEY' then
        value ?& array['amount', 'currency'] and value - array['amount', 'currency'] = '{}'::jsonb
        and jsonb_typeof(value -> 'amount') = 'string'
        and (value ->> 'amount') ~ '^(0|[1-9][0-9]{0,15})(\.[0-9]{1,2})?$'
        and (value ->> 'amount') !~ '^0(\.0{1,2})?$'
        and (jsonb_typeof(value -> 'currency') = 'null'
             or (jsonb_typeof(value -> 'currency') = 'string' and (value ->> 'currency') ~ '^[A-Z]{3}$'))
      when 'COUNT' then
        value ? 'count' and value - 'count' = '{}'::jsonb
        and jsonb_typeof(value -> 'count') = 'string'
        and (value ->> 'count') ~ '^[1-9][0-9]{0,15}$'
      when 'PERCENT' then
        value ? 'percent' and value - 'percent' = '{}'::jsonb
        and jsonb_typeof(value -> 'percent') = 'string'
        and (value ->> 'percent') ~ '^-?(0|[1-9][0-9]{0,5})(\.[0-9]{1,4})?$'
      when 'ZERO' then
        -- A stated zero is a value. Money may say which currency it was in.
        (value = '{}'::jsonb
         or (value ? 'currency' and value - 'currency' = '{}'::jsonb
             and jsonb_typeof(value -> 'currency') = 'string' and (value ->> 'currency') ~ '^[A-Z]{3}$'))
      when 'UNKNOWN' then
        -- "I'd rather not say" is told apart from "I don't know".
        value = '{}'::jsonb or value = '{"declined": true}'::jsonb
      else false
    end
  )
);

comment on table gateq.application_statements is
  'Append-only atomic statements an applicant made about one dimension, each with its exact words, provenance, origin and source turn. Corrections and disagreements are links between statements; the current view is a deterministic projection and nothing here is ever rewritten.';
comment on column gateq.application_statements.value is
  'Shape fixed by value_kind: TEXT {text}; CODE {code}; MONEY {amount (decimal string, non-zero), currency (ISO 4217 or null)}; COUNT {count (positive integer string)}; PERCENT {percent (decimal string)}; ZERO {} or {currency}; UNKNOWN {} or {declined: true}.';
comment on column gateq.application_statements.stated_at is
  'When it was said; orders statements. A link''s "to" statement is always older than its "from" statement.';

create index application_statements_by_application_idx
  on gateq.application_statements (application_id, dimension, stated_at);
create index application_statements_by_turn_idx
  on gateq.application_statements (source_turn_id) where source_turn_id is not null;

-- ---------------------------------------------------------------------------
-- Links: CORRECTS or DISAGREES, always from a newer statement to an older one
-- ---------------------------------------------------------------------------

create table gateq.application_statement_links (
  id                 uuid primary key default gen_random_uuid(),
  application_id     uuid not null,
  tenant_id          uuid not null references identity.tenants (id) on delete restrict,
  kind               text not null check (kind in ('CORRECTS', 'DISAGREES')),
  from_statement_id  uuid not null,
  to_statement_id    uuid not null,
  origin             text not null check (origin in ('MODEL_READING', 'CODE_DETECTED', 'BACKFILL')),
  source_turn_id     uuid,
  created_at         timestamptz not null default clock_timestamp(),

  constraint application_statement_links_application
    foreign key (application_id, tenant_id) references gateq.applications (id, tenant_id) on delete restrict,
  constraint application_statement_links_from
    foreign key (from_statement_id, application_id, tenant_id)
    references gateq.application_statements (id, application_id, tenant_id) on delete restrict,
  constraint application_statement_links_to
    foreign key (to_statement_id, application_id, tenant_id)
    references gateq.application_statements (id, application_id, tenant_id) on delete restrict,
  constraint application_statement_links_source_turn
    foreign key (source_turn_id, application_id, tenant_id)
    references gateq.application_turns (id, application_id, tenant_id) on delete restrict,
  constraint application_statement_links_scope_key unique (id, application_id, tenant_id),
  constraint application_statement_links_no_self_link check (from_statement_id <> to_statement_id),
  constraint application_statement_links_once unique (kind, from_statement_id, to_statement_id),
  constraint application_statement_links_reading_turn
    check (origin <> 'MODEL_READING' or source_turn_id is not null)
);

comment on table gateq.application_statement_links is
  'Append-only relations between two statements of one application. CORRECTS hides only its target statement; DISAGREES keeps both visible until a disagreement event resolves it. "from" is always the newer statement.';

create index application_statement_links_by_application_idx
  on gateq.application_statement_links (application_id);
create index application_statement_links_to_idx
  on gateq.application_statement_links (to_statement_id);

-- ---------------------------------------------------------------------------
-- Disagreement events: the latest one is the current state; none means OPEN
-- ---------------------------------------------------------------------------

create table gateq.application_disagreement_events (
  id                        uuid primary key default gen_random_uuid(),
  application_id            uuid not null,
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  link_id                   uuid not null,
  state                     text not null check (state in ('LEFT_OPEN', 'REOPENED', 'RESOLVED')),
  resolved_by_statement_id  uuid,
  source_turn_id            uuid,
  recorded_at               timestamptz not null default clock_timestamp(),

  constraint application_disagreement_events_application
    foreign key (application_id, tenant_id) references gateq.applications (id, tenant_id) on delete restrict,
  constraint application_disagreement_events_link
    foreign key (link_id, application_id, tenant_id)
    references gateq.application_statement_links (id, application_id, tenant_id) on delete restrict,
  constraint application_disagreement_events_resolved_by
    foreign key (resolved_by_statement_id, application_id, tenant_id)
    references gateq.application_statements (id, application_id, tenant_id) on delete restrict,
  constraint application_disagreement_events_source_turn
    foreign key (source_turn_id, application_id, tenant_id)
    references gateq.application_turns (id, application_id, tenant_id) on delete restrict,
  -- Only a resolution names the statement that resolved it.
  constraint application_disagreement_events_resolution
    check ((state = 'RESOLVED') = (resolved_by_statement_id is not null))
);

comment on table gateq.application_disagreement_events is
  'Append-only state changes of one DISAGREES link. The latest event is the current state; a link with no event is OPEN. RESOLVED names the statement that resolved it.';

create index application_disagreement_events_by_link_idx
  on gateq.application_disagreement_events (link_id, recorded_at);

-- ---------------------------------------------------------------------------
-- Turn readings: one authoritative execution result per PERSON turn
-- ---------------------------------------------------------------------------

create table gateq.application_turn_readings (
  id                      uuid primary key default gen_random_uuid(),
  application_id          uuid not null,
  tenant_id               uuid not null references identity.tenants (id) on delete restrict,
  turn_id                 uuid not null unique,
  outcome                 text not null check (outcome in ('READ', 'NO_STATEMENTS', 'REJECTED')),
  -- The statements this reading recorded. Q may say "noted" only for these.
  recorded_statement_ids  uuid[] not null default '{}'
                            check (cardinality(recorded_statement_ids) <= 64
                                   and array_position(recorded_statement_ids, null) is null),
  -- What was heard but not recorded, and why, so nothing is dropped silently.
  not_recorded            jsonb not null default '[]'::jsonb
                            check (jsonb_typeof(not_recorded) = 'array'
                                   and jsonb_array_length(not_recorded) <= 32
                                   and pg_column_size(not_recorded) <= 16384),
  reading_version         smallint not null check (reading_version between 1 and 99),
  recorded_at             timestamptz not null default clock_timestamp(),

  constraint application_turn_readings_application
    foreign key (application_id, tenant_id) references gateq.applications (id, tenant_id) on delete restrict,
  constraint application_turn_readings_turn
    foreign key (turn_id, application_id, tenant_id)
    references gateq.application_turns (id, application_id, tenant_id) on delete restrict,
  -- READ recorded at least one statement; the other outcomes recorded none.
  constraint application_turn_readings_outcome_statements
    check ((outcome = 'READ') = (cardinality(recorded_statement_ids) > 0))
);

comment on table gateq.application_turn_readings is
  'Append-only, one per PERSON turn: the authoritative result of reading it into statements (READ, NO_STATEMENTS or REJECTED). A PERSON turn without a reading is unread and is recovered before the next reading.';

-- ---------------------------------------------------------------------------
-- Guards (cloned from gateq.application_turns: tenant, submitted, append-only)
-- ---------------------------------------------------------------------------

-- The row's tenant is its application's tenant, and nothing is added once the
-- application is SUBMITTED. Locks the application row like
-- gateq.guard_open_application_write, so a write cannot slip past a
-- concurrent submission into a frozen dossier.
create function gateq.application_statement_scope_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  application_tenant uuid;
  application_status text;
begin
  select a.tenant_id, a.status into application_tenant, application_status
    from gateq.applications a
   where a.id = new.application_id
     for update;
  if application_tenant is null or application_tenant <> new.tenant_id then
    raise exception 'a % row belongs to its application''s tenant', tg_table_name
      using errcode = 'check_violation';
  end if;
  if application_status = 'SUBMITTED' then
    raise exception 'a submitted application''s statements are closed'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_statement_scope_guard() from public;

create function gateq.protect_application_statement_tables()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'gateq.% is append-only: what was said stays said', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function gateq.protect_application_statement_tables() from public;

-- A cited turn is a PERSON turn of the same application.
create function gateq.application_statement_turn_is_person(turn uuid, application uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from gateq.application_turns t
     where t.id = turn and t.application_id = application and t.role = 'PERSON'
  )
$$;

revoke all on function gateq.application_statement_turn_is_person(uuid, uuid) from public;

create function gateq.application_statement_valid()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.source_turn_id is not null
     and not gateq.application_statement_turn_is_person(new.source_turn_id, new.application_id) then
    raise exception 'a statement is read from a PERSON turn of its application'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_statement_valid() from public;

-- Both ends are statements of the link's application, and "to" is older.
create function gateq.application_statement_link_valid()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  from_at timestamptz;
  to_at timestamptz;
begin
  select s.stated_at into from_at from gateq.application_statements s
   where s.id = new.from_statement_id and s.application_id = new.application_id;
  select s.stated_at into to_at from gateq.application_statements s
   where s.id = new.to_statement_id and s.application_id = new.application_id;
  if from_at is null or to_at is null then
    raise exception 'a link joins two statements of its own application'
      using errcode = 'check_violation';
  end if;
  -- A self-link is refused by application_statement_links_no_self_link.
  if new.from_statement_id = new.to_statement_id then
    return new;
  end if;
  if not (to_at < from_at) then
    raise exception 'a link points from a newer statement to an older one'
      using errcode = 'check_violation';
  end if;
  if new.source_turn_id is not null
     and not gateq.application_statement_turn_is_person(new.source_turn_id, new.application_id) then
    raise exception 'a link is read from a PERSON turn of its application'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_statement_link_valid() from public;

-- An event concerns a DISAGREES link; a resolution is one of the two
-- statements, or a statement made after both.
create function gateq.application_disagreement_event_valid()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  link record;
  newer_at timestamptz;
  resolver_at timestamptz;
begin
  select l.kind, l.from_statement_id, l.to_statement_id into link
    from gateq.application_statement_links l
   where l.id = new.link_id and l.application_id = new.application_id;
  if not found then
    raise exception 'a disagreement event belongs to a link of its application'
      using errcode = 'check_violation';
  end if;
  if link.kind <> 'DISAGREES' then
    raise exception 'only a DISAGREES link has disagreement events'
      using errcode = 'check_violation';
  end if;
  if new.resolved_by_statement_id is not null
     and new.resolved_by_statement_id not in (link.from_statement_id, link.to_statement_id) then
    select s.stated_at into newer_at from gateq.application_statements s where s.id = link.from_statement_id;
    select s.stated_at into resolver_at from gateq.application_statements s
     where s.id = new.resolved_by_statement_id and s.application_id = new.application_id;
    if resolver_at is null or not (resolver_at > newer_at) then
      raise exception 'a disagreement is resolved by one of its statements or a later one'
        using errcode = 'check_violation';
    end if;
  end if;
  if new.source_turn_id is not null
     and not gateq.application_statement_turn_is_person(new.source_turn_id, new.application_id) then
    raise exception 'a disagreement event is read from a PERSON turn of its application'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_disagreement_event_valid() from public;

-- A reading is of a PERSON turn, and every statement it claims to have
-- recorded is a statement of that turn.
create function gateq.application_turn_reading_valid()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if not gateq.application_statement_turn_is_person(new.turn_id, new.application_id) then
    raise exception 'a reading is of a PERSON turn of its application'
      using errcode = 'check_violation';
  end if;
  if exists (
    select 1 from unnest(new.recorded_statement_ids) as r(statement_id)
     where not exists (
       select 1 from gateq.application_statements s
        where s.id = r.statement_id
          and s.application_id = new.application_id
          and s.source_turn_id = new.turn_id
     )
  ) then
    raise exception 'a reading lists only statements read from its turn'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function gateq.application_turn_reading_valid() from public;

-- Trigger names sort so the scope guard runs first (a_), then the row's own
-- validation (b_). Postgres fires same-event triggers in name order.
create trigger a_application_statements_scope before insert on gateq.application_statements
  for each row execute function gateq.application_statement_scope_guard();
create trigger b_application_statements_valid before insert on gateq.application_statements
  for each row execute function gateq.application_statement_valid();
create trigger application_statements_append_only before update or delete on gateq.application_statements
  for each row execute function gateq.protect_application_statement_tables();

create trigger a_application_statement_links_scope before insert on gateq.application_statement_links
  for each row execute function gateq.application_statement_scope_guard();
create trigger b_application_statement_links_valid before insert on gateq.application_statement_links
  for each row execute function gateq.application_statement_link_valid();
create trigger application_statement_links_append_only before update or delete on gateq.application_statement_links
  for each row execute function gateq.protect_application_statement_tables();

create trigger a_application_disagreement_events_scope before insert on gateq.application_disagreement_events
  for each row execute function gateq.application_statement_scope_guard();
create trigger b_application_disagreement_events_valid before insert on gateq.application_disagreement_events
  for each row execute function gateq.application_disagreement_event_valid();
create trigger application_disagreement_events_append_only before update or delete on gateq.application_disagreement_events
  for each row execute function gateq.protect_application_statement_tables();

create trigger a_application_turn_readings_scope before insert on gateq.application_turn_readings
  for each row execute function gateq.application_statement_scope_guard();
create trigger b_application_turn_readings_valid before insert on gateq.application_turn_readings
  for each row execute function gateq.application_turn_reading_valid();
create trigger application_turn_readings_append_only before update or delete on gateq.application_turn_readings
  for each row execute function gateq.protect_application_statement_tables();

-- ---------------------------------------------------------------------------
-- Server-only: RLS on, no policy, no browser grant.
-- ---------------------------------------------------------------------------

alter table gateq.application_statements enable row level security;
alter table gateq.application_statement_links enable row level security;
alter table gateq.application_disagreement_events enable row level security;
alter table gateq.application_turn_readings enable row level security;

revoke all on gateq.application_statements, gateq.application_statement_links,
  gateq.application_disagreement_events, gateq.application_turn_readings
  from anon, authenticated;
