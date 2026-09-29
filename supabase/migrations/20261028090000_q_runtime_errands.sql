-- Q errands (founder direction 2026-09-29, the "wow"): one approval covers
-- an exact multi-step plan Q then carries out as things happen -- express
-- interest; when they accept, open the chat; answer their questions from
-- what the person approved Q may say; book a call; tell the person.
--
-- Authority (PADL: Prepare -> Recommend -> Human Approval -> Execute, or
-- explicit scoped delegation): the row IS the scoped delegation. It binds
-- to the approved action (q_action_id) and its exact payload; Q never
-- widens it. Every step re-resolves the approver's own context and runs
-- the same service command, capability check and idempotency record the
-- person's own button would, so a revoked membership, a block or a
-- declined interest stops the errand. The person may stop it at any time.
--
-- Server-written only; the person reads their own errands.

create table q_runtime.errands (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references identity.tenants (id) on delete restrict,
  user_id             uuid not null references identity.user_profiles (id) on delete restrict,
  -- The organisation context the person approved from; re-resolved per step.
  organisation_id     uuid,
  -- The approved action this errand executes; its payload is the plan.
  q_action_id         uuid not null,
  company_id          uuid,
  relationship_id     uuid,
  counterpart_name    text not null check (length(counterpart_name) between 1 and 200),
  plan                jsonb not null check (jsonb_typeof(plan) = 'object'),
  status              text not null default 'ACTIVE'
                        check (status in ('ACTIVE', 'DONE', 'STOPPED', 'FAILED', 'EXPIRED')),
  stage               text not null default 'WAITING_CONNECTION'
                        check (stage in ('WAITING_CONNECTION', 'CONVERSING', 'CALL_BOOKED', 'FINISHED')),
  -- Plain words for the person: what Q did last.
  last_step           text check (last_step is null or length(last_step) <= 300),
  failure             text check (failure is null or length(failure) <= 200),
  -- The newest counterpart message Q has read (by its sent time).
  seen_until          timestamptz,
  replies_sent        integer not null default 0 check (replies_sent between 0 and 20),
  meeting_id          uuid references communication.meetings (id) on delete restrict,
  expires_at          timestamptz not null,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  unique (q_action_id),
  check (company_id is not null or relationship_id is not null)
);

comment on table q_runtime.errands is
  'A scoped delegation: the exact multi-step plan a person approved for Q to carry out on one relationship as events arrive. Not a CRM record; the relationship row stays the only truth.';

create index errands_active_idx
  on q_runtime.errands (status, updated_at)
  where status = 'ACTIVE';

create index errands_user_idx
  on q_runtime.errands (user_id, created_at desc);

alter table q_runtime.errands enable row level security;

create policy errands_select_own
  on q_runtime.errands for select to authenticated
  using (
    user_id = (select private.current_app_user_id())
    and (select private.is_tenant_member(tenant_id))
  );

grant select on q_runtime.errands to authenticated;

-- The person is told what Q did on their behalf.
alter table communication.notifications
  drop constraint notifications_kind_check,
  add constraint notifications_kind_check
    check (kind in ('REMINDER', 'MEETING_SCHEDULED', 'MEETING_CANCELLED', 'MEETING_PREP_READY', 'MEETING_NOTES_READY', 'Q_SCOUT', 'Q_ERRAND'));
