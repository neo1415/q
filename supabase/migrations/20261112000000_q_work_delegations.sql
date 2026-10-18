-- AUTO (founder direction 2026-10-01, ADR 0030): "let Q handle it".
--
-- A delegation is the scoped, revocable authority a person approved once:
-- an investor's outreach (source -> shortlist -> interest -> chat ->
-- interview -> report -> times -> booking) or a founder's stand-in while
-- they are away. The row binds to the approved action (q_action_id) and
-- its exact payload (grant); Q never widens it. Its progress lives in
-- LangGraph checkpoints (q_runtime.checkpoint*, thread_id) and in plain
-- words here, for the person.
--
-- Every step re-resolves the person's own actor context and runs the same
-- command their own button runs; nothing here is authority. Server-written
-- only; the person reads their own rows.

-- ---------------------------------------------------------------------------
-- q_runtime.delegations
-- ---------------------------------------------------------------------------

create table q_runtime.delegations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  organisation_id  uuid,
  kind             text not null check (kind in ('INVESTOR_OUTREACH', 'FOUNDER_STAND_IN')),
  -- The approved action; its payload is the grant.
  q_action_id      uuid not null unique,
  grant_plan       jsonb not null check (jsonb_typeof(grant_plan) = 'object'),
  status           text not null default 'ACTIVE'
                     check (status in ('ACTIVE', 'DONE', 'STOPPED', 'FAILED', 'EXPIRED')),
  -- Plain words for the person: where the whole job stands.
  summary          text check (summary is null or length(summary) <= 300),
  -- The engine's thread; a storage key, never accepted from a client.
  thread_id        text not null check (length(thread_id) between 8 and 100),
  graph_version    integer not null default 1 check (graph_version between 1 and 1000),
  expires_at       timestamptz not null,
  created_at       timestamptz not null default clock_timestamp(),
  updated_at       timestamptz not null default clock_timestamp()
);

comment on table q_runtime.delegations is
  'A scoped delegation (ADR 0030): the exact plan and limits a person approved for Q to carry out over days. Not a CRM record; relationships stay the only truth.';

create index delegations_active_idx on q_runtime.delegations (status, updated_at) where status = 'ACTIVE';
create index delegations_user_idx on q_runtime.delegations (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- q_runtime.delegation_lanes: one counterpart inside a delegation
-- ---------------------------------------------------------------------------

create table q_runtime.delegation_lanes (
  id                        uuid primary key default gen_random_uuid(),
  delegation_id             uuid not null references q_runtime.delegations (id) on delete restrict,
  tenant_id                 uuid not null references identity.tenants (id) on delete restrict,
  user_id                   uuid not null references identity.user_profiles (id) on delete restrict,
  company_id                uuid,
  investor_organisation_id  uuid,
  relationship_id           uuid,
  counterpart_name          text not null check (length(counterpart_name) between 1 and 200),
  stage                     text not null check (stage in (
                              'SHORTLISTED', 'WAITING_ACCEPTANCE', 'CHATTING', 'INTERVIEWING',
                              'REPORT_READY', 'NEEDS_TIMES', 'CALL_BOOKED', 'STANDING_IN',
                              'DECLINED', 'DONE', 'STOPPED', 'FAILED')),
  -- Why Q picked them, each reason quoting the material it rests on.
  match_reasons             jsonb not null default '[]'::jsonb check (jsonb_typeof(match_reasons) = 'array'),
  -- What Q learned in the chat, topic -> the founder's own words.
  learned                   jsonb not null default '[]'::jsonb check (jsonb_typeof(learned) = 'array'),
  -- First-stage interview: questions asked and answers, in order.
  interview                 jsonb not null default '[]'::jsonb check (jsonb_typeof(interview) = 'array'),
  -- What the person must decide now (e.g. times offered); null when nothing.
  needs                     jsonb check (needs is null or jsonb_typeof(needs) = 'object'),
  report_artifact_id        uuid,
  meeting_id                uuid references communication.meetings (id) on delete restrict,
  replies_sent              integer not null default 0 check (replies_sent between 0 and 50),
  -- The last observation the engine was resumed with (skip unchanged).
  observed_fingerprint      text check (observed_fingerprint is null or length(observed_fingerprint) <= 200),
  last_step                 text check (last_step is null or length(last_step) <= 300),
  created_at                timestamptz not null default clock_timestamp(),
  updated_at                timestamptz not null default clock_timestamp(),
  check (company_id is not null or investor_organisation_id is not null or relationship_id is not null)
);

comment on table q_runtime.delegation_lanes is
  'One counterpart inside a delegation (ADR 0030): where Q stands with them, in plain words, and what the person must decide.';

create unique index delegation_lanes_one_per_company
  on q_runtime.delegation_lanes (delegation_id, company_id) where company_id is not null;
create unique index delegation_lanes_one_per_relationship
  on q_runtime.delegation_lanes (delegation_id, relationship_id) where relationship_id is not null;
create index delegation_lanes_delegation_idx on q_runtime.delegation_lanes (delegation_id, created_at);
create index delegation_lanes_relationship_idx on q_runtime.delegation_lanes (relationship_id) where relationship_id is not null;

-- ---------------------------------------------------------------------------
-- q_runtime.delegation_steps: the trail, append-only
-- ---------------------------------------------------------------------------

create table q_runtime.delegation_steps (
  id             uuid primary key default gen_random_uuid(),
  delegation_id  uuid not null references q_runtime.delegations (id) on delete restrict,
  lane_id        uuid references q_runtime.delegation_lanes (id) on delete restrict,
  tenant_id      uuid not null references identity.tenants (id) on delete restrict,
  user_id        uuid not null references identity.user_profiles (id) on delete restrict,
  -- Stable per happening; a replayed node writes nothing twice.
  step_key       text not null check (length(step_key) between 3 and 200),
  words          text not null check (length(words) between 1 and 500),
  created_at     timestamptz not null default clock_timestamp(),
  unique (delegation_id, step_key)
);

comment on table q_runtime.delegation_steps is
  'What Q did under a delegation, step by step, in plain words (ADR 0030). Append-only; the underlying commands keep their own audit.';

create index delegation_steps_delegation_idx on q_runtime.delegation_steps (delegation_id, created_at);

create function private.q_runtime_delegation_steps_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'q_runtime.delegation_steps is append-only' using errcode = '42501';
end;
$$;

create trigger delegation_steps_append_only
  before update or delete on q_runtime.delegation_steps
  for each row execute function private.q_runtime_delegation_steps_append_only();

-- ---------------------------------------------------------------------------
-- q_runtime.presence: when a person was last on Capital Q
-- ---------------------------------------------------------------------------

create table q_runtime.presence (
  user_id       uuid primary key references identity.user_profiles (id) on delete restrict,
  tenant_id     uuid not null references identity.tenants (id) on delete restrict,
  last_seen_at  timestamptz not null default clock_timestamp(),
  -- The person said they are away (stand-in answers at once).
  away          boolean not null default false,
  updated_at    timestamptz not null default clock_timestamp()
);

comment on table q_runtime.presence is
  'Last time a person had Capital Q open, and whether they said they are away. Only for the stand-in hand-over; never analytics.';

-- ---------------------------------------------------------------------------
-- RLS: the person reads their own rows; no client writes
-- ---------------------------------------------------------------------------

alter table q_runtime.delegations enable row level security;
alter table q_runtime.delegation_lanes enable row level security;
alter table q_runtime.delegation_steps enable row level security;
alter table q_runtime.presence enable row level security;

create policy delegations_select_own on q_runtime.delegations for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));
create policy delegation_lanes_select_own on q_runtime.delegation_lanes for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));
create policy delegation_steps_select_own on q_runtime.delegation_steps for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));
create policy presence_select_own on q_runtime.presence for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));

grant select on q_runtime.delegations, q_runtime.delegation_lanes,
  q_runtime.delegation_steps, q_runtime.presence to authenticated;

-- ---------------------------------------------------------------------------
-- Chat: Q's messages under a delegation, and the Q-to-Q envelope
-- ---------------------------------------------------------------------------

-- A message Q sent under a delegation or an errand (ADR 0028/0029). The
-- unique q_action_id index allowed only ONE message per approved action,
-- so an errand could never post its second message; this marker has no
-- such limit (idempotency stays per sender + key).
alter table communication.messages
  add column q_delegation_id uuid,
  add column q_envelope jsonb check (
    q_envelope is null
    or (jsonb_typeof(q_envelope) = 'object' and q_envelope ->> 'protocol' = 'cq.q2q/1'
        and length(q_envelope::text) <= 1000)),
  add constraint messages_envelope_needs_q check (q_envelope is null or q_delegation_id is not null);

create index messages_q_delegation_idx
  on communication.messages (q_delegation_id, created_at) where q_delegation_id is not null;

-- ---------------------------------------------------------------------------
-- Notifications: priority, delivery fan-out, push subscriptions, settings
-- ---------------------------------------------------------------------------

alter table communication.notifications
  add column priority text not null default 'UPDATE' check (priority in ('NEEDS_YOU', 'UPDATE')),
  add column pushed_at timestamptz,
  add column emailed_at timestamptz,
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY',
                    'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND', 'MEETING_RECORDING_DECLINED',
                    'COMMITMENT_DETECTED', 'ACCOUNT_PAUSED', 'Q_WORK', 'Q_STAND_IN'));

create index notifications_undelivered_idx
  on communication.notifications (created_at)
  where pushed_at is null and read_at is null;

create table communication.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references identity.tenants (id) on delete restrict,
  user_id          uuid not null references identity.user_profiles (id) on delete restrict,
  -- The push service URL is itself a capability: never returned to a client.
  endpoint         text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh           text not null check (length(p256dh) between 40 and 200),
  auth             text not null check (length(auth) between 16 and 64),
  user_agent       text check (user_agent is null or length(user_agent) <= 300),
  created_at       timestamptz not null default clock_timestamp(),
  last_success_at  timestamptz,
  failures         integer not null default 0 check (failures between 0 and 1000),
  revoked_at       timestamptz
);

comment on table communication.push_subscriptions is
  'Web Push subscriptions (VAPID, RFC 8030/8291/8292) for a person''s devices. Server-written; the endpoint is never sent back to a client.';

create index push_subscriptions_user_idx
  on communication.push_subscriptions (user_id) where revoked_at is null;

create table communication.notification_settings (
  user_id     uuid primary key references identity.user_profiles (id) on delete restrict,
  tenant_id   uuid not null references identity.tenants (id) on delete restrict,
  push        boolean not null default true,
  email       boolean not null default true,
  updated_at  timestamptz not null default clock_timestamp()
);

comment on table communication.notification_settings is
  'How a person wants to be told when Q needs them: push and/or email. In-app notices always show.';

alter table communication.push_subscriptions enable row level security;
alter table communication.notification_settings enable row level security;

create policy notification_settings_select_own on communication.notification_settings for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));
-- Owner reads their device count/agent; the endpoint and keys are not granted.
create policy push_subscriptions_select_own on communication.push_subscriptions for select to authenticated
  using (user_id = (select private.current_app_user_id()) and (select private.is_tenant_member(tenant_id)));

grant select on communication.notification_settings to authenticated;
grant select (id, user_id, tenant_id, user_agent, created_at, revoked_at)
  on communication.push_subscriptions to authenticated;
