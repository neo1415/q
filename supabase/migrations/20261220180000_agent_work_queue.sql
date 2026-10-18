-- RECOVERY-2026-10 · workstream D (D3, audit D-08) · durable agent work.
--
-- q_runtime.agent_work_queue: one row per approved workforce job, claimed
-- by a worker under a lease. An approved job used to run as an unawaited
-- promise inside the approval: a restart, or a throw, left the job and its
-- runs RUNNING forever. Now the approval only enqueues; a worker claims
-- the row with FOR UPDATE SKIP LOCKED, holds it with a lease it renews
-- (heartbeat), and a row whose lease lapsed is reclaimed and resumed by
-- the next worker -- finished steps' results are kept here, so a resumed
-- job never redoes one. Every row ends in a terminal work state.
--
-- state is the lead contract's QWorkState (packages/contracts/src/q/
-- agent-capability.ts), as text checked here: QUEUED, RUNNING and
-- RECOVERING are live; COMPLETED, FAILED, CANCELLED, NEEDS_DECISION and
-- BLOCKED are where a run ended (the last two wait on the person, but no
-- worker holds them). PLANNED and AWAITING_AUTHORIZATION happen before a
-- row exists (the plan is a card until approved).
--
-- Named outside q_runtime.workforce_* deliberately: those tables are the
-- workforce's history and their suite (790) counts them.
--
-- personal_private: the owner (an active member of the row's tenant)
-- reads their own rows; nobody in a browser writes; the server claims,
-- renews and finishes. EXPECTED DB BEHAVIOUR: the privileged server role
-- reads every row. APPLICATION SESSION AUTHORISATION IS STILL REQUIRED:
-- DB BYPASS ≠ BUSINESS AUTHORISATION.

create table q_runtime.agent_work_queue (
  job_id        uuid primary key,
  tenant_id     uuid not null,
  user_id       uuid not null,
  state         text not null default 'QUEUED'
                  check (state in ('QUEUED', 'RUNNING', 'RECOVERING', 'BLOCKED',
                                   'NEEDS_DECISION', 'FAILED', 'CANCELLED', 'COMPLETED')),
  -- The approved plan, exactly as approved (the card's payload). Code's.
  plan          jsonb not null
                  check (jsonb_typeof(plan) = 'object' and pg_column_size(plan) <= 65536),
  -- Ids only (QTraceContext): the conversation, run and turn it came from.
  trace         jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(trace) = 'object' and pg_column_size(trace) <= 2048),
  -- Each finished step's result by step key: status, summary, outputs.
  results       jsonb not null default '{}'::jsonb
                  check (jsonb_typeof(results) = 'object' and pg_column_size(results) <= 131072),
  attempts      integer not null default 0 check (attempts between 0 and 20),
  max_attempts  integer not null default 3 check (max_attempts between 1 and 10),
  locked_by     text check (locked_by is null or length(locked_by) between 1 and 120),
  locked_until  timestamptz,
  heartbeat_at  timestamptz,
  -- Why it stopped, in plain words the Work page shows. Never a stack.
  reason        text check (reason is null or length(reason) between 1 and 500),
  created_at    timestamptz not null default clock_timestamp(),
  updated_at    timestamptz not null default clock_timestamp(),
  finished_at   timestamptz,
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  -- Live rows have no end; ended rows have one and no lease.
  constraint agent_work_queue_finished_check
    check ((state in ('QUEUED', 'RUNNING', 'RECOVERING')) = (finished_at is null)),
  constraint agent_work_queue_lease_check
    check (finished_at is null or (locked_by is null and locked_until is null)),
  constraint agent_work_queue_running_lease_check
    check (state <> 'RUNNING' or (locked_by is not null and locked_until is not null))
);

-- The claim's scan: live rows by age.
create index agent_work_queue_live_idx
  on q_runtime.agent_work_queue (created_at)
  where state in ('QUEUED', 'RUNNING', 'RECOVERING');
create index agent_work_queue_owner_idx
  on q_runtime.agent_work_queue (tenant_id, user_id, created_at desc);

-- Who, what and when it was approved never change; an ended row never
-- changes at all (history is not rewritten).
create function q_runtime.agent_work_queue_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.job_id, new.tenant_id, new.user_id, new.plan, new.trace, new.created_at)
     is distinct from
     (old.job_id, old.tenant_id, old.user_id, old.plan, old.trace, old.created_at) then
    raise exception 'an agent work row''s job, owner and plan never change'
      using errcode = 'check_violation';
  end if;
  if old.finished_at is not null then
    raise exception 'an ended agent work row never changes'
      using errcode = 'check_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function q_runtime.agent_work_queue_guard() from public;
create trigger agent_work_queue_guard
  before update on q_runtime.agent_work_queue
  for each row execute function q_runtime.agent_work_queue_guard();

alter table q_runtime.agent_work_queue enable row level security;
alter table q_runtime.agent_work_queue force row level security;
create policy agent_work_queue_select_own on q_runtime.agent_work_queue
  for select to authenticated
  using (user_id = (select private.current_app_user_id())
         and (select private.is_tenant_member(tenant_id)));
revoke all on q_runtime.agent_work_queue from public, anon, authenticated;
grant select on q_runtime.agent_work_queue to authenticated;
grant select, insert, update on q_runtime.agent_work_queue to postgres, service_role;

comment on table q_runtime.agent_work_queue is
  'Recovery D3: approved workforce jobs as durable, leased work (FOR UPDATE SKIP LOCKED, locked_until, heartbeat, reclaim). personal_private; the server claims and finishes; an ended row never changes.';
