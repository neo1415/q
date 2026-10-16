-- Lane ob1 (2026-10-16) · onboarding.pending_writes
--
-- A confirmed onboarding change the person gave (in conversation or by a
-- grouped confirmation) that could not be saved because a dependency was
-- temporarily down (the onboarding API timed out, returned 5xx, or was
-- unreachable). It is held here durably and replayed until it lands, so a
-- transient failure loses nothing and Q never claims it was saved early.
--
-- This is NOT journey truth and NOT canonical data: nothing reads it to
-- decide what is on the record. The response it carries is applied through
-- the ordinary onboarding submit (validated again by the pinned definition
-- and the owning canonical service, under the person's own credentials).
-- Replays are duplicate-safe: the replayer first compares the session's
-- current answer with the held one, and a submit carries an idempotency key
-- derived from this row and the session version it targets.
--
-- One PENDING row per (session, step): a later confirmed change to the same
-- field supersedes the earlier held one (correction semantics).

create table onboarding.pending_writes (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references onboarding.sessions (id) on delete restrict,
  user_id         uuid not null references identity.user_profiles (id) on delete restrict,
  step_key        text not null check (step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  -- The validated response input ({ value, note? }); bounded.
  response        jsonb not null check (jsonb_typeof(response) = 'object' and pg_column_size(response) <= 16384),
  -- Where the confirmation came from.
  origin          text not null check (origin in ('CONVERSATION', 'FORM', 'CONFIRMATION_GROUP')),
  idempotency_key uuid not null,
  status          text not null default 'PENDING'
                  check (status in ('PENDING', 'APPLIED', 'REFUSED', 'DISCARDED')),
  attempts        integer not null default 0 check (attempts between 0 and 1000),
  -- A stable reason code, never a provider message or a stack trace.
  last_error      text check (last_error is null or last_error ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  created_at      timestamptz not null default clock_timestamp(),
  updated_at      timestamptz not null default clock_timestamp(),
  settled_at      timestamptz,
  check ((status = 'PENDING') = (settled_at is null))
);

comment on table onboarding.pending_writes is
  'Confirmed onboarding changes held for retry while a dependency is down. Never journey truth; applied through the ordinary validated submit. INTERNAL_SERVER_ONLY.';

create unique index pending_writes_session_key
  on onboarding.pending_writes (session_id, idempotency_key);

create unique index pending_writes_one_pending_per_step
  on onboarding.pending_writes (session_id, step_key)
  where status = 'PENDING';

create index pending_writes_pending_idx
  on onboarding.pending_writes (session_id, created_at)
  where status = 'PENDING';

-- What was confirmed stays what was confirmed: only the lifecycle moves,
-- and a settled row never moves again. Rows are never deleted.
create function onboarding.protect_pending_writes()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'onboarding.pending_writes rows are never deleted'
      using errcode = 'restrict_violation';
  end if;
  if new.session_id is distinct from old.session_id
     or new.user_id is distinct from old.user_id
     or new.step_key is distinct from old.step_key
     or new.response is distinct from old.response
     or new.origin is distinct from old.origin
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception 'a held onboarding change cannot be rewritten'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'PENDING' then
    raise exception 'a settled onboarding change cannot move again'
      using errcode = 'restrict_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function onboarding.protect_pending_writes() from public;

create trigger pending_writes_protect
  before update or delete on onboarding.pending_writes
  for each row execute function onboarding.protect_pending_writes();

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.pending_writes enable row level security;
revoke all on onboarding.pending_writes from anon, authenticated;
-- No policies.
