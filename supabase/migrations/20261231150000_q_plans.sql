-- Situation-first planning (owner 2026-10-28) · q_runtime.q_plans,
-- q_plan_versions, workforce_thread
--
-- "Make me a plan" returned a readiness checklist or an analysis document.
-- Q now gathers the person's situation (as them, through the typed reads
-- the chat tools make), writes a plan whose every step cites that
-- situation, has it reviewed twice, and offers it with Execute / Put on my
-- board / Change it. This is the record of those plans and of the team
-- thread the work runs on:
--
--   q_plans          one plan for one person: its goal, side, status and the
--                    version it is on. Only the status moves; the version
--                    moves only by a new row in q_plan_versions (trigger).
--   q_plan_versions  every version of a plan, with the situation it was
--                    written from and its reviews. Append-only: a change is
--                    the next version, never an edit (approval binds to
--                    {plan, version, steps}, so an old version stays exactly
--                    what was approved).
--   workforce_thread the team thread of a plan or a job: step notes,
--                    findings, questions for the person, the person's
--                    direction and status lines. A blackboard the
--                    orchestrator routes (specialists never address each
--                    other). Append-only; a retried append writes nothing.
--                    It generalises workforce_handoffs, whose rows stay.
--
-- personal_private: the owner reads their own rows through RLS (q_runtime
-- stays closed to browsers; the Q API reads under the resolved actor). Every
-- write is the server's. A person's rows go with their account (cascade).
-- A plan is the person's own arrangement of their work: never evidence,
-- never a disclosure, never a ranking or matching input. The stored
-- situation is what the person themself was authorised to read when it was
-- assembled; reading it back grants nothing about any record it names.

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create table q_runtime.q_plans (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete cascade,
  user_id           uuid not null references identity.user_profiles (id) on delete cascade,
  side              text not null check (side in ('FOUNDER', 'INVESTOR')),
  goal              text not null check (length(btrim(goal)) between 1 and 500),
  status            text not null default 'DRAFT'
                      check (status in ('DRAFT', 'OFFERED', 'ACCEPTED', 'ON_BOARD',
                                        'EXECUTING', 'DONE', 'SUPERSEDED')),
  -- The newest version. 0 until the first version is written; moved only by
  -- q_plan_versions' insert trigger, one at a time.
  current_version   integer not null default 0 check (current_version between 0 and 1000),
  -- The workforce job that planned it (kind PLAN), when there was one.
  job_id            uuid,
  -- A retried "make me a plan" writes one plan.
  idempotency_key   text not null check (length(idempotency_key) between 8 and 200),
  visibility_scope  text not null default 'personal_private'
                      check (visibility_scope = 'personal_private'),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  constraint q_plans_job_owned
    foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id)
    on delete set null (job_id),
  -- Children name the plan together with its owner, so a row can never be
  -- filed under someone else's plan.
  unique (id, tenant_id, user_id)
);

create unique index q_plans_idempotency_idx
  on q_runtime.q_plans (tenant_id, user_id, idempotency_key);
create index q_plans_owner_idx
  on q_runtime.q_plans (tenant_id, user_id, updated_at desc);
create index q_plans_job_idx
  on q_runtime.q_plans (job_id) where job_id is not null;
-- The plans a re-planning trigger or the daily topic watch looks at.
create index q_plans_live_idx
  on q_runtime.q_plans (tenant_id, user_id)
  where status in ('ACCEPTED', 'ON_BOARD', 'EXECUTING');

create table q_runtime.q_plan_versions (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  version           integer not null check (version between 1 and 1000),
  -- The plan as QPlanSchema (contracts/src/q/plan.ts), validated by the
  -- server before it is written.
  body              jsonb not null
                      check (jsonb_typeof(body) = 'object' and pg_column_size(body) <= 65536),
  body_sha256       text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  -- The situation dossier it was written from (QSituationDossierSchema).
  situation         jsonb not null
                      check (jsonb_typeof(situation) = 'object' and pg_column_size(situation) <= 262144),
  -- The reviews, kept with the bar they were held to: a later change to
  -- the bar never re-reads an old review.
  review_threshold  integer not null check (review_threshold between 0 and 100),
  rubric_version    text not null check (length(rubric_version) between 1 and 64),
  prompt_version    text not null check (length(prompt_version) between 1 and 64),
  score_r1          integer check (score_r1 is null or score_r1 between 0 and 100),
  score_r2          integer check (score_r2 is null or score_r2 between 0 and 100),
  fully_reviewed    boolean not null,
  redrafts          integer not null default 0 check (redrafts between 0 and 5),
  -- What made this version: Q's first draft, the person's change, an
  -- uploaded plan refined, or a re-plan after something changed.
  cause             text not null check (cause in ('DRAFT', 'CHANGE', 'UPLOAD', 'REPLAN')),
  -- CHANGE: the person's direction in the team thread that asked for it.
  direction_id      uuid,
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (plan_id, tenant_id, user_id)
    references q_runtime.q_plans (id, tenant_id, user_id) on delete cascade,
  unique (plan_id, version),
  constraint q_plan_versions_reviewed_check
    check (not fully_reviewed or (score_r1 is not null and score_r2 is not null)),
  -- The first version is Q's draft or a refined upload; later ones are a
  -- change the person asked for or a re-plan.
  -- Named apart from the column check above, which Postgres itself calls
  -- q_plan_versions_cause_check.
  constraint q_plan_versions_first_version_cause_check
    check ((version = 1) = (cause in ('DRAFT', 'UPLOAD'))),
  constraint q_plan_versions_direction_check
    check (direction_id is null or cause = 'CHANGE')
);
create index q_plan_versions_owner_idx
  on q_runtime.q_plan_versions (tenant_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- The team thread
-- ---------------------------------------------------------------------------

create table q_runtime.workforce_thread (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete cascade,
  user_id           uuid not null references identity.user_profiles (id) on delete cascade,
  plan_id           uuid,
  job_id            uuid,
  -- Position in its thread (the plan's when there is one, else the job's),
  -- from 1. The server writes the next; a race fails the unique index.
  seq               integer not null check (seq >= 1),
  kind              text not null check (kind in ('NOTE', 'FINDING', 'QUESTION', 'DIRECTION', 'STATUS')),
  author            text not null check (author in (
                      'PLANNER', 'RESEARCH', 'WRITER', 'REVIEWER', 'LIAISON', 'WORKER', 'PERSON')),
  step_key          text check (step_key is null or step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  fact_ref          text check (fact_ref is null or fact_ref ~ '^F[1-9][0-9]{0,2}$'),
  body              text not null check (length(btrim(body)) between 1 and 1000),
  idempotency_key   text not null check (length(idempotency_key) between 8 and 200),
  created_at        timestamptz not null default clock_timestamp(),
  constraint workforce_thread_plan_owned
    foreign key (plan_id, tenant_id, user_id)
    references q_runtime.q_plans (id, tenant_id, user_id) on delete cascade,
  constraint workforce_thread_job_owned
    foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  constraint workforce_thread_belongs_check
    check (plan_id is not null or job_id is not null),
  -- The person gives direction, and only the person.
  constraint workforce_thread_direction_check
    check ((kind = 'DIRECTION') = (author = 'PERSON')),
  unique (id, plan_id)
);

create unique index workforce_thread_idempotency_idx
  on q_runtime.workforce_thread (tenant_id, user_id, idempotency_key);
create unique index workforce_thread_plan_seq_idx
  on q_runtime.workforce_thread (plan_id, seq) where plan_id is not null;
create unique index workforce_thread_job_seq_idx
  on q_runtime.workforce_thread (job_id, seq) where plan_id is null;
create index workforce_thread_job_idx
  on q_runtime.workforce_thread (job_id, seq) where job_id is not null;

-- A plan version's direction is an entry of the same plan's thread.
alter table q_runtime.q_plan_versions
  add constraint q_plan_versions_direction_fk
  foreign key (direction_id, plan_id) references q_runtime.workforce_thread (id, plan_id)
  on delete set null (direction_id);

-- ---------------------------------------------------------------------------
-- What may change, and how
-- ---------------------------------------------------------------------------

-- A plan's status moves; its version moves only to the next version that
-- has been written (q_plan_versions' insert trigger moves it); nothing else
-- about it does.
create function q_runtime.q_plans_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.user_id, new.side, new.goal, new.idempotency_key,
      new.visibility_scope, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.user_id, old.side, old.goal, old.idempotency_key,
      old.visibility_scope, old.created_at) then
    raise exception 'a plan''s status and version are all that change'
      using errcode = 'check_violation';
  end if;
  -- The planning job is set once; a job ending clears it (on delete set
  -- null). It is never swapped for another.
  if old.job_id is not null and new.job_id is not null
     and new.job_id <> old.job_id then
    raise exception 'a plan''s job is set once'
      using errcode = 'check_violation';
  end if;
  if new.current_version <> old.current_version
     and (new.current_version <> old.current_version + 1
          or not exists (select 1 from q_runtime.q_plan_versions v
                          where v.plan_id = new.id and v.version = new.current_version)) then
    raise exception 'a plan moves to its next version only by writing that version'
      using errcode = 'check_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function q_runtime.q_plans_guard() from public;
create trigger q_plans_guard
  before update on q_runtime.q_plans
  for each row execute function q_runtime.q_plans_guard();

-- Versions are written in order, one after the other (the plan row is
-- locked while the next is checked), and the plan's head follows them.
create function q_runtime.q_plan_versions_in_order() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  head integer;
begin
  select p.current_version into head
    from q_runtime.q_plans p
   where p.id = new.plan_id
     for update;
  if new.version <> coalesce(head, 0) + 1 then
    raise exception 'plan version % is not the next after %', new.version, coalesce(head, 0)
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.q_plan_versions_in_order() from public;
create trigger q_plan_versions_in_order
  before insert on q_runtime.q_plan_versions
  for each row execute function q_runtime.q_plan_versions_in_order();

create function q_runtime.q_plan_versions_move_head() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update q_runtime.q_plans set current_version = new.version where id = new.plan_id;
  return null;
end;
$$;
revoke all on function q_runtime.q_plan_versions_move_head() from public;
create trigger q_plan_versions_move_head
  after insert on q_runtime.q_plan_versions
  for each row execute function q_runtime.q_plan_versions_move_head();

-- History is never rewritten (the function from 20261207090000_q_workforce).
create trigger q_plan_versions_no_update before update on q_runtime.q_plan_versions
  for each row execute function q_runtime.workforce_history_no_update();
create trigger workforce_thread_no_update before update on q_runtime.workforce_thread
  for each row execute function q_runtime.workforce_history_no_update();

-- ---------------------------------------------------------------------------
-- RLS and grants: the owner reads; the server writes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array['q_plans', 'q_plan_versions', 'workforce_thread'] loop
    execute format('alter table q_runtime.%I enable row level security', t);
    execute format('alter table q_runtime.%I force row level security', t);
    execute format(
      'create policy %I on q_runtime.%I for select to authenticated using ('
      || 'user_id = (select private.current_app_user_id()) '
      || 'and (select private.is_tenant_member(tenant_id)))',
      t || '_select_own', t);
    execute format('revoke all on q_runtime.%I from public, anon, authenticated', t);
    execute format('grant select on q_runtime.%I to authenticated', t);
    execute format('grant select, insert on q_runtime.%I to postgres, service_role', t);
  end loop;
end;
$$;

-- Only a plan's status (and, through its versions, its head) is updated.
grant update on q_runtime.q_plans to postgres, service_role;

comment on table q_runtime.q_plans is
  'Situation-first planning: one plan for one person (goal, side, status, current version). personal_private; only status and version move.';
comment on table q_runtime.q_plan_versions is
  'Every version of a plan with the situation it was written from and its two reviews. Append-only; versions are sequential.';
comment on table q_runtime.workforce_thread is
  'The team thread of a plan or job: notes, findings, questions, the person''s direction, status lines. Append-only; orchestrator-routed.';
