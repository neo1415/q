-- CQ-QX-006 · onboarding.interview_turns
--
-- The on-screen thread of the conversational interview, both sides, both
-- modalities: what the person said (typed or spoken) and what Q said back.
-- A reload used to drop the whole thread because only the person's
-- unplaced sentences were stored (onboarding.utterances, for Q's reading)
-- and never Q's replies, so a person could answer a question they could
-- no longer see.
--
-- This is a display record of the conversation, not journey truth: nothing
-- here is a response, a suggestion or a canonical value, and nothing reads
-- it to decide what was recorded. Written and read by the API for the
-- session's own user; the browser never touches the table.

create table onboarding.interview_turns (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references onboarding.sessions (id) on delete restrict,
  role        text not null check (role in ('PERSON', 'Q')),
  text        text not null check (length(text) between 1 and 4000),
  -- The step Q was on when the turn happened, when there was one.
  step_key    text check (step_key is null or step_key ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'),
  channel     text not null check (channel in ('TEXT', 'VOICE')),
  -- One exchange's idempotency reference: a retried append of the same
  -- exchange writes nothing (one row per role per reference).
  turn_ref    uuid,
  created_at  timestamptz not null default clock_timestamp()
);

comment on table onboarding.interview_turns is
  'Append-only thread of the conversational interview (person and Q, typed and spoken) for redisplay after a reload. Display record only; never a response or canonical value.';

create index interview_turns_session_created_idx
  on onboarding.interview_turns (session_id, created_at);

create unique index interview_turns_session_ref_role_key
  on onboarding.interview_turns (session_id, turn_ref, role)
  where turn_ref is not null;

-- ---------------------------------------------------------------------------
-- Immutability: a turn that was said stays said.
-- ---------------------------------------------------------------------------

create function onboarding.protect_interview_turns()
returns trigger
language plpgsql
as $$
begin
  raise exception 'onboarding.interview_turns is append-only'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function onboarding.protect_interview_turns() from public;

create trigger interview_turns_append_only
  before update or delete on onboarding.interview_turns
  for each row execute function onboarding.protect_interview_turns();

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.interview_turns enable row level security;
-- No policies, no anon/authenticated/service_role grants.
