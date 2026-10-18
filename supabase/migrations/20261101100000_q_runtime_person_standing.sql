-- Q's standing with each person (founder direction 2026-09-30).
--
-- Two things Q keeps about a person across visits:
-- 1. Who they want Q to be: a personality, or AUTO (Q reads the person).
-- 2. Its patience: small talk is welcome, but somebody who keeps pulling
--    away from their setup is warned, sent to look around, and at the
--    fifth time has the account paused for a person at Capital Q to look
--    at. The policy is deterministic code (apps/q-api voice/conduct.ts);
--    a model only reads whether a turn was small talk.
--
-- Server-written only. The person reads their own row (their personality
-- choice and whether they are paused); nobody else does.

create table q_runtime.person_standing (
  user_id          uuid primary key references identity.user_profiles (id) on delete restrict,
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  personality      text not null default 'AUTO'
                     check (personality in ('AUTO', 'WARM', 'WITTY', 'SHARP', 'CALM')),
  -- Small-talk turns in a row this round, and whether Q started it.
  streak           integer not null default 0 check (streak between 0 and 20),
  q_started        boolean not null default false,
  -- Full rounds of small talk this visit; a visit ends after 30 idle minutes.
  rounds           integer not null default 0 check (rounds between 0 and 20),
  -- Times they were sent away; kept across visits.
  strikes          integer not null default 0 check (strikes between 0 and 20),
  suspended_at     timestamptz,
  suspended_reason text check (suspended_reason is null or length(suspended_reason) <= 300),
  reinstated_at    timestamptz,
  reinstated_by    uuid references identity.user_profiles (id) on delete restrict,
  updated_at       timestamptz not null default clock_timestamp()
);

comment on table q_runtime.person_standing is
  'Q''s standing with one person: their chosen Q personality and Q''s patience with small talk (strikes, suspension). Not a moderation record of content; a policy counter.';

create index person_standing_suspended_idx
  on q_runtime.person_standing (suspended_at)
  where suspended_at is not null;

alter table q_runtime.person_standing enable row level security;

create policy person_standing_select_own
  on q_runtime.person_standing for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.person_standing to authenticated;

-- Capital Q's operators are told when Q pauses an account.
alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED'));
