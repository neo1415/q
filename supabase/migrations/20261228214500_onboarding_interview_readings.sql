-- Onboarding speed 2026-10-20 (D9) · onboarding.interview_readings
--
-- What the independent reading found each of the person's sentences in the
-- interview stated, by step key: "that sentence gave the stage and the
-- country". The interviewer uses it on later turns to record what was said
-- earlier and not yet saved ("given earlier, record it now"). It lived in
-- one q-api process's memory, so a deploy, a restart or a second instance
-- forgot it and the earlier answers were never prompted for again.
--
-- One row per exchange (the interview thread's turn_ref). It is a reading
-- of words, not journey truth: nothing here is a response, a value or a
-- suggestion, and a write still needs the person's own words as its quote.
-- Written and read by the API for the session's own user only; the browser
-- never touches the table.

create table onboarding.interview_readings (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references onboarding.sessions (id) on delete restrict,
  -- The exchange whose PERSON turn was read (onboarding.interview_turns.turn_ref).
  turn_ref          uuid not null,
  stated_step_keys  text[] not null
    check (cardinality(stated_step_keys) between 1 and 40)
    check (array_position(stated_step_keys, null) is null),
  created_at        timestamptz not null default clock_timestamp()
);

comment on table onboarding.interview_readings is
  'Append-only: which steps the independent reading found each interview sentence stated, by exchange. A reading of words for later turns; never a response or canonical value.';

-- Idempotency: a retried append of the same exchange writes nothing.
create unique index interview_readings_session_ref_key
  on onboarding.interview_readings (session_id, turn_ref);

-- Each key is a stable step key (the same shape interview_turns.step_key takes).
create function onboarding.interview_reading_keys_valid(keys text[])
returns boolean
language sql
immutable
as $$
  select coalesce(bool_and(k ~ '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$'), false)
    from unnest(keys) as k
$$;

revoke all on function onboarding.interview_reading_keys_valid(text[]) from public;

alter table onboarding.interview_readings
  add constraint interview_readings_keys_valid
  check (onboarding.interview_reading_keys_valid(stated_step_keys));

-- ---------------------------------------------------------------------------
-- Immutability: a reading is recorded once and never rewritten.
-- ---------------------------------------------------------------------------

create function onboarding.protect_interview_readings()
returns trigger
language plpgsql
as $$
begin
  raise exception 'onboarding.interview_readings is append-only'
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function onboarding.protect_interview_readings() from public;

create trigger interview_readings_append_only
  before update or delete on onboarding.interview_readings
  for each row execute function onboarding.protect_interview_readings();

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
alter table onboarding.interview_readings enable row level security;
-- No policies, no anon/authenticated/service_role grants.
