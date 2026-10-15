-- Shared video allowance and usage ledger (owner decision 2026-10-15).
--
-- One Tavus Builder account pays for both native video experiences, the
-- GateQ video interview (gateq.application_video_sessions) and video
-- Rehearsals (q_runtime.rehearsal_video_sessions). This adds, beside the
-- stricter per-application and per-rehearsal rules that stay as they are:
--
--   * a weekly per-person allowance (default 5 sessions, each at most
--     180 s) shared by both products;
--   * a global monthly safeguard on the account (default 600 s, i.e. the
--     10 minutes the owner funded), counted conservatively in whole billed
--     minutes, test sessions included;
--   * an append-only ledger of every reservation, settlement and release,
--     with an estimated cost, for the owner and for reconciliation against
--     the provider's dashboard (Tavus exposes no billing API).
--
-- Enforcement is in the database, in the same statement that creates a
-- session row (AFTER INSERT triggers), so no route, refresh, second tab or
-- overlapping start can create a room without a reservation. An insert
-- that loses ON CONFLICT DO NOTHING (the rehearsal's recovery path) fires
-- no AFTER trigger and reserves nothing. A global advisory lock serialises
-- reservations: video starts are rare, correctness beats throughput here.
--
-- Who a person is: a signed-in user (user:<user_profiles.id>). A GateQ
-- applicant who confirmed their contact through their own Capital Q
-- account is that user, so their GateQ and Rehearsal sessions share one
-- allowance; any other applicant is their confirmed email, hashed
-- (email:<sha256>), never stored in clear here.
--
-- Testers: subjects listed in billing.video_allowance_testers (server-only,
-- maintained by operators) do not consume the weekly allowance, but their
-- sessions are ledgered and count against the monthly safeguard.
--
-- A reservation is released (not counted) only when no provider room can
-- exist: GateQ ended PROVIDER_FAILED with no conversation id, or a
-- rehearsal that never reached the provider. Anything else counts; a GateQ
-- room the provider made but that failed to go live counts the full 180 s.
--
-- Server-only like the rest of billing: RLS on, no policy, no browser
-- grant. Functions are SECURITY INVOKER with an empty search_path; the
-- server role that writes the session rows runs them.

create table billing.video_allowance_config (
  id                   boolean primary key default true check (id),
  weekly_sessions      integer not null default 5 check (weekly_sessions between 0 and 100),
  max_session_seconds  integer not null default 180 check (max_session_seconds between 1 and 180),
  monthly_cap_seconds  integer not null default 600 check (monthly_cap_seconds between 0 and 6000000),
  usd_per_minute       numeric(8, 4) not null default 0.40 check (usd_per_minute >= 0),
  updated_at           timestamptz not null default now()
);
insert into billing.video_allowance_config (id) values (true);

create table billing.video_allowance_testers (
  subject_key  text primary key
                 check (subject_key ~ '^(user:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|email:[0-9a-f]{64})$'),
  note         text not null check (length(note) between 1 and 200),
  created_at   timestamptz not null default now()
);

create table billing.video_session_reservations (
  session_id        uuid primary key,
  product           text not null check (product in ('GATEQ', 'REHEARSAL')),
  tenant_id         uuid not null,
  subject_key       text not null
                      check (subject_key ~ '^(user:[0-9a-f-]{36}|email:[0-9a-f]{64}|application:[0-9a-f-]{36})$'),
  is_test           boolean not null,
  reserved_seconds  integer not null check (reserved_seconds between 1 and 180),
  status            text not null default 'RESERVED' check (status in ('RESERVED', 'SETTLED', 'RELEASED')),
  settled_seconds   integer check (settled_seconds between 0 and 180),
  created_at        timestamptz not null default clock_timestamp(),
  settled_at        timestamptz,
  check ((status = 'RESERVED') = (settled_at is null)),
  check ((status = 'SETTLED') = (settled_seconds is not null))
);
create index video_session_reservations_subject_idx
  on billing.video_session_reservations (subject_key, created_at desc);
create index video_session_reservations_created_idx
  on billing.video_session_reservations (created_at desc);

create table billing.video_usage_ledger (
  id              bigint generated always as identity primary key,
  session_id      uuid not null references billing.video_session_reservations (session_id) on delete restrict,
  product         text not null check (product in ('GATEQ', 'REHEARSAL')),
  subject_key     text not null,
  is_test         boolean not null,
  event           text not null check (event in ('RESERVED', 'SETTLED', 'RELEASED')),
  seconds         integer not null check (seconds between 0 and 180),
  billed_minutes  integer not null check (billed_minutes between 0 and 3),
  -- An estimate from billing.video_allowance_config, never the provider's bill.
  est_cost_usd    numeric(10, 4) not null check (est_cost_usd >= 0),
  recorded_at     timestamptz not null default clock_timestamp(),
  unique (session_id, event)
);

-- The ledger is append-only; a reservation only moves forward once.
create function billing.video_ledger_append_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'billing.video_usage_ledger is append-only'
    using errcode = 'check_violation';
end;
$$;
create trigger video_usage_ledger_append_only
  before update or delete on billing.video_usage_ledger
  for each row execute function billing.video_ledger_append_only();

create function billing.video_reservation_forward_only()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a video reservation is never deleted' using errcode = 'check_violation';
  end if;
  if old.status <> 'RESERVED'
    or new.session_id is distinct from old.session_id
    or new.product is distinct from old.product
    or new.tenant_id is distinct from old.tenant_id
    or new.subject_key is distinct from old.subject_key
    or new.is_test is distinct from old.is_test
    or new.reserved_seconds is distinct from old.reserved_seconds
    or new.created_at is distinct from old.created_at then
    raise exception 'a video reservation only settles or releases, once'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger video_session_reservations_forward_only
  before update or delete on billing.video_session_reservations
  for each row execute function billing.video_reservation_forward_only();

-- The week (ISO, Monday 00:00 UTC) a moment falls in.
create function billing.video_week_start(at timestamptz)
returns timestamptz language sql immutable security invoker set search_path = '' as $$
  select date_trunc('week', at at time zone 'UTC') at time zone 'UTC';
$$;

-- Seconds counted against the monthly safeguard: whole billed minutes.
create function billing.video_counted_seconds(seconds integer)
returns integer language sql immutable security invoker set search_path = '' as $$
  select (ceil(greatest(seconds, 0) / 60.0) * 60)::integer;
$$;

create function billing.video_allowance_status(p_subject text)
returns table (weekly_sessions integer, used integer, remaining integer, resets_at timestamptz, is_test boolean)
language sql stable security invoker set search_path = '' as $$
  with cfg as (select c.weekly_sessions from billing.video_allowance_config c where c.id),
       t as (select exists (select 1 from billing.video_allowance_testers x where x.subject_key = p_subject) as is_test),
       u as (
         select count(*)::integer as used
           from billing.video_session_reservations r
          where r.subject_key = p_subject and r.status <> 'RELEASED' and not r.is_test
            and r.created_at >= billing.video_week_start(now()))
  select cfg.weekly_sessions, u.used,
         case when t.is_test then cfg.weekly_sessions else greatest(cfg.weekly_sessions - u.used, 0) end,
         billing.video_week_start(now()) + interval '7 days',
         t.is_test
    from cfg, t, u;
$$;

create function billing.reserve_video_session(
  p_session uuid, p_product text, p_tenant uuid, p_subject text, p_seconds integer)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  cfg billing.video_allowance_config;
  tester boolean;
  used_week integer;
  used_month integer;
  counted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('cq-video-allowance', 0));
  if exists (select 1 from billing.video_session_reservations where session_id = p_session) then
    return;
  end if;
  select * into strict cfg from billing.video_allowance_config where id;
  if p_seconds > cfg.max_session_seconds then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_SESSION_TOO_LONG';
  end if;
  tester := exists (select 1 from billing.video_allowance_testers where subject_key = p_subject);
  if not tester then
    select count(*) into used_week from billing.video_session_reservations
     where subject_key = p_subject and status <> 'RELEASED' and not is_test
       and created_at >= billing.video_week_start(now());
    if used_week >= cfg.weekly_sessions then
      raise exception using errcode = 'P0001', message = 'CQ_VIDEO_WEEKLY_ALLOWANCE_EXHAUSTED';
    end if;
  end if;
  select coalesce(sum(billing.video_counted_seconds(
           case when status = 'SETTLED' then settled_seconds else reserved_seconds end)), 0)
    into used_month
    from billing.video_session_reservations
   where status <> 'RELEASED'
     and created_at >= date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  counted := billing.video_counted_seconds(p_seconds);
  if used_month + counted > cfg.monthly_cap_seconds then
    raise exception using errcode = 'P0001', message = 'CQ_VIDEO_GLOBAL_CAP';
  end if;
  insert into billing.video_session_reservations
    (session_id, product, tenant_id, subject_key, is_test, reserved_seconds)
  values (p_session, p_product, p_tenant, p_subject, tester, p_seconds);
  insert into billing.video_usage_ledger
    (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
  values (p_session, p_product, p_subject, tester, 'RESERVED', p_seconds,
          counted / 60, (counted / 60) * cfg.usd_per_minute);
end;
$$;

create function billing.settle_video_session(p_session uuid, p_seconds integer, p_release boolean)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  r billing.video_session_reservations;
  rate numeric;
  secs integer := least(greatest(coalesce(p_seconds, 0), 0), 180);
begin
  select * into r from billing.video_session_reservations where session_id = p_session for update;
  -- Sessions from before this ledger, or already settled: nothing to do.
  if not found or r.status <> 'RESERVED' then
    return;
  end if;
  select usd_per_minute into rate from billing.video_allowance_config where id;
  if p_release then
    update billing.video_session_reservations
       set status = 'RELEASED', settled_at = clock_timestamp()
     where session_id = p_session;
    insert into billing.video_usage_ledger
      (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
    values (p_session, r.product, r.subject_key, r.is_test, 'RELEASED', 0, 0, 0);
  else
    update billing.video_session_reservations
       set status = 'SETTLED', settled_seconds = secs, settled_at = clock_timestamp()
     where session_id = p_session;
    insert into billing.video_usage_ledger
      (session_id, product, subject_key, is_test, event, seconds, billed_minutes, est_cost_usd)
    values (p_session, r.product, r.subject_key, r.is_test, 'SETTLED', secs,
            billing.video_counted_seconds(secs) / 60,
            (billing.video_counted_seconds(secs) / 60) * rate);
  end if;
end;
$$;

-- The person behind a GateQ application (see the header).
create function billing.video_subject_for_application(p_application uuid, p_tenant uuid)
returns text language sql stable security invoker set search_path = '' as $$
  select coalesce(
    (select 'user:' || p.id::text
       from gateq.application_contacts c
       join auth.users u on lower(u.email) = lower(c.email)
       join identity.user_profiles p on p.auth_user_id = u.id
      where c.application_id = p_application and c.tenant_id = p_tenant
        and c.confirmed_via = 'ACCOUNT' and c.email_confirmed_at is not null
      limit 1),
    (select 'email:' || encode(sha256(convert_to(lower(trim(c.email)), 'UTF8')), 'hex')
       from gateq.application_contacts c
      where c.application_id = p_application and c.tenant_id = p_tenant
        and c.email_confirmed_at is not null
      limit 1),
    'application:' || p_application::text);
$$;

-- GateQ: reserve with the row, settle when it ends.
create function gateq.video_session_reserve()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform billing.reserve_video_session(
    new.id, 'GATEQ', new.tenant_id,
    billing.video_subject_for_application(new.application_id, new.tenant_id),
    least(new.max_seconds, 180));
  return null;
end;
$$;
create trigger application_video_session_reserve
  after insert on gateq.application_video_sessions
  for each row execute function gateq.video_session_reserve();

create function gateq.video_session_settle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  -- A failed start with a provider room (made, then not saved as live)
  -- may run until the provider's own cap: count it in full, never less.
  perform billing.settle_video_session(
    new.id,
    case when new.ended_reason = 'PROVIDER_FAILED' then least(new.max_seconds, 180)
         else least(new.max_seconds, ceil(extract(epoch from (new.ended_at - new.created_at)))::integer) end,
    new.ended_reason = 'PROVIDER_FAILED' and new.provider_conversation_id is null);
  return null;
end;
$$;
create trigger application_video_session_settle
  after update of status on gateq.application_video_sessions
  for each row when (new.status = 'ENDED' and old.status is distinct from 'ENDED')
  execute function gateq.video_session_settle();

-- Rehearsals: the same, keyed by the signed-in user.
create function q_runtime.rehearsal_video_session_reserve()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform billing.reserve_video_session(
    new.id, 'REHEARSAL', new.tenant_id, 'user:' || new.user_id::text,
    least(180, ceil(extract(epoch from (new.ends_at - new.created_at)))::integer));
  return null;
end;
$$;
create trigger rehearsal_video_session_reserve
  after insert on q_runtime.rehearsal_video_sessions
  for each row execute function q_runtime.rehearsal_video_session_reserve();

create function q_runtime.rehearsal_video_session_settle()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  perform billing.settle_video_session(
    new.id,
    coalesce(new.seconds, ceil(extract(epoch from (new.ended_at - new.created_at)))::integer),
    new.provider_request_started_at is null and new.provider_conversation_id is null);
  return null;
end;
$$;
create trigger rehearsal_video_session_settle
  after update of status on q_runtime.rehearsal_video_sessions
  for each row when (new.status in ('ENDED', 'FAILED') and old.status not in ('ENDED', 'FAILED'))
  execute function q_runtime.rehearsal_video_session_settle();

alter table billing.video_allowance_config enable row level security;
alter table billing.video_allowance_testers enable row level security;
alter table billing.video_session_reservations enable row level security;
alter table billing.video_usage_ledger enable row level security;
revoke all on billing.video_allowance_config, billing.video_allowance_testers,
  billing.video_session_reservations, billing.video_usage_ledger
  from public, anon, authenticated;
revoke all on function
  billing.video_ledger_append_only(), billing.video_reservation_forward_only(),
  billing.video_week_start(timestamptz), billing.video_counted_seconds(integer),
  billing.video_allowance_status(text),
  billing.reserve_video_session(uuid, text, uuid, text, integer),
  billing.settle_video_session(uuid, integer, boolean),
  billing.video_subject_for_application(uuid, uuid),
  gateq.video_session_reserve(), gateq.video_session_settle(),
  q_runtime.rehearsal_video_session_reserve(), q_runtime.rehearsal_video_session_settle()
  from public, anon, authenticated;
