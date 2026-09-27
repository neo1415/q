-- (lead-owned migration, for review)
-- Onboarding setup reminders · onboarding.nudge_states
--
-- Founder directive 2026-09-27: a person who started their setup and has
-- not finished is reminded, but not incessantly. Whether a reminder is due
-- is decided by a deterministic, versioned policy in @capital-q/onboarding
-- (domain/nudge-policy.ts); this table holds only what has been said to the
-- person about it and what they asked for ("remind me later", "stop
-- reminding me"), so the cadence holds across devices and across Home and Q.
--
-- One row per person. A person's reminder state is theirs, not a tenant's:
-- the setup it is about may not have a tenant yet (onboarding.sessions
-- binds one late), so ownership is the person, as for the sessions table.
-- It is not journey truth, not a response, and never read to decide what
-- anybody may see.

create table onboarding.nudge_states (
  user_id               uuid primary key references identity.user_profiles (id) on delete restrict,
  last_shown_at         timestamptz,
  last_surface          text check (last_surface is null or last_surface in ('BRIEFING', 'Q_NOTE')),
  -- Reminders given since the person last worked on their setup.
  shown_count           integer not null default 0 check (shown_count between 0 and 10000),
  -- The Q conversation the last Q mention was in: at most once per conversation.
  last_conversation_id  uuid,
  snoozed_until         timestamptz,
  stopped_at            timestamptz,
  -- The policy version that last wrote the row, for audit of a cadence change.
  policy_version        text not null check (length(policy_version) between 1 and 64),
  updated_at            timestamptz not null default clock_timestamp(),

  check ((last_shown_at is null) = (last_surface is null)),
  check (last_shown_at is not null or shown_count = 0)
);

comment on table onboarding.nudge_states is
  'Per-person setup-reminder state (what was shown, snooze, stop). Decided by the versioned deterministic policy in @capital-q/onboarding; never journey truth.';

-- Exposure: INTERNAL_SERVER_ONLY, like every other journey-state table.
-- The API and Q read and write it for the authenticated person only.
alter table onboarding.nudge_states enable row level security;
-- No policies, no anon/authenticated/service_role grants.
