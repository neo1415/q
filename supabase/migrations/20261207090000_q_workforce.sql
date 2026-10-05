-- Q's workforce of agents (founder brief J1-J9, 2026-10-06).
--
-- The person meets one Q. Behind it, the lead Q plans a job and hands its
-- steps to specialist agents (outreach, mandate watcher, conversation,
-- writer, reviewer, scheduler, documents, research, or an agent it spawns
-- for one step). Every outward draft is graded by the reviewer before it
-- can be sent; below the bar it goes back to the writer with feedback.
--
-- This is the record of that work, for the person's workforce page and for
-- learning:
--
--   workforce_jobs           one job: its goal, its budget, the review bar
--                            (score threshold, most redrafts, rubric). Only
--                            its status moves.
--   workforce_agent_runs     one agent's run in a job: role, tools, budget,
--                            who spawned it. Only its ending is written, once.
--   workforce_handoffs       who handed what to whom. Append-only.
--   workforce_drafts         every outward draft and redraft. Append-only.
--   workforce_grades         the reviewer's grade of a draft, with the bar it
--                            was held to. Append-only.
--   workforce_draft_outcomes sent, offered for approval, or held. Append-only.
--   workforce_feedback       the person's approval, edit or rejection, and
--                            outcomes (they replied). Append-only.
--
-- personal_private: the owner reads their own rows through RLS (q_runtime
-- stays closed to browsers; the Q API reads under the resolved actor).
-- Every write is the server's. History is never rewritten; a person's rows
-- go with their account (cascade). Agent cost is not stored here: it is
-- the model usage ledger (ai_ops.model_usage), whose correlation ids carry
-- the job and the agent run, and the billing meter (q.agent_jobs).
--
-- Drafts are what Q wrote to the other side on the person's behalf, never
-- facts: learning from them goes through the memory Write Gate as the
-- person's preferences, never into these tables' consumers as evidence.

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------

create table q_runtime.workforce_jobs (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references identity.tenants (id) on delete cascade,
  user_id           uuid not null references identity.user_profiles (id) on delete cascade,
  -- Where the work came from. JOB: a job the lead Q planned itself.
  source_kind       text not null check (source_kind in (
                      'JOB', 'INSTRUCTION', 'DELEGATED_WORK', 'ERRAND',
                      'MEETING_FOLLOW_UP', 'EMAIL_DRAFT')),
  source_id         text check (source_id is null or length(source_id) between 1 and 120),
  goal              text not null check (length(btrim(goal)) between 1 and 2000),
  status            text not null default 'RUNNING'
                      check (status in ('PLANNING', 'RUNNING', 'DONE', 'HELD', 'STOPPED', 'FAILED')),
  -- Money is numeric, never float.
  budget_usd        numeric(12, 6) not null default 0.5 check (budget_usd >= 0 and budget_usd <= 100),
  -- The review bar this job's drafts are held to.
  review_threshold  integer not null default 75 check (review_threshold between 0 and 100),
  max_redrafts      integer not null default 2 check (max_redrafts between 0 and 5),
  rubric_version    text not null check (length(rubric_version) between 1 and 64),
  visibility_scope  text not null default 'personal_private'
                      check (visibility_scope = 'personal_private'),
  created_at        timestamptz not null default clock_timestamp(),
  updated_at        timestamptz not null default clock_timestamp(),
  -- Children name the job together with its owner, so a row can never be
  -- filed under someone else's job.
  unique (id, tenant_id, user_id)
);

-- One job per source (an instruction, a delegation, an errand ...).
create unique index workforce_jobs_source_idx
  on q_runtime.workforce_jobs (tenant_id, user_id, source_kind, source_id)
  where source_id is not null;
create index workforce_jobs_owner_idx
  on q_runtime.workforce_jobs (tenant_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Agent runs
-- ---------------------------------------------------------------------------

create table q_runtime.workforce_agent_runs (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  role              text not null check (role in (
                      'LEAD', 'OUTREACH', 'MANDATE_WATCHER', 'CONVERSATION', 'WRITER',
                      'REVIEWER', 'SCHEDULER', 'DOCUMENTS', 'RESEARCH', 'AD_HOC')),
  agent_name        text not null check (length(btrim(agent_name)) between 1 and 60),
  goal              text not null check (length(btrim(goal)) between 1 and 400),
  -- The tools this run may use: its role's (or, spawned, a subset of all
  -- roles'), narrowed to what the person allowed. Code's, never the model's.
  tools             text[] not null default '{}'
                      check (cardinality(tools) <= 16),
  budget_usd        numeric(12, 6) not null default 0 check (budget_usd >= 0 and budget_usd <= 10),
  step_key          text check (step_key is null or step_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  spawned_by_run_id uuid references q_runtime.workforce_agent_runs (id) on delete cascade,
  status            text not null default 'RUNNING'
                      check (status in ('RUNNING', 'DONE', 'HELD', 'FAILED', 'SKIPPED')),
  summary           text check (summary is null or length(summary) <= 500),
  started_at        timestamptz not null default clock_timestamp(),
  ended_at          timestamptz,
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  unique (id, job_id),
  constraint workforce_agent_runs_ended_check
    check ((status = 'RUNNING') = (ended_at is null)),
  constraint workforce_agent_runs_lead_check
    check ((role = 'LEAD') = (spawned_by_run_id is null))
);
create index workforce_agent_runs_job_idx
  on q_runtime.workforce_agent_runs (job_id, started_at);

-- ---------------------------------------------------------------------------
-- Hand-offs, drafts, grades, outcomes, feedback: history
-- ---------------------------------------------------------------------------

create table q_runtime.workforce_drafts (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  writer_run_id     uuid,
  attempt           integer not null check (attempt between 1 and 6),
  parent_draft_id   uuid references q_runtime.workforce_drafts (id) on delete cascade,
  channel           text not null check (channel in ('CHAT', 'EMAIL')),
  counterpart_name  text check (counterpart_name is null or length(counterpart_name) <= 200),
  body              text not null check (length(body) between 1 and 4000),
  body_sha256       text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  foreign key (writer_run_id, job_id)
    references q_runtime.workforce_agent_runs (id, job_id) on delete cascade,
  unique (id, job_id),
  constraint workforce_drafts_first_check check ((attempt = 1) = (parent_draft_id is null))
);
create index workforce_drafts_job_idx
  on q_runtime.workforce_drafts (job_id, created_at);

create table q_runtime.workforce_handoffs (
  id                uuid primary key default gen_random_uuid(),
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  from_run_id       uuid not null,
  to_run_id         uuid not null,
  draft_id          uuid,
  note              text not null check (length(btrim(note)) between 1 and 1000),
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  foreign key (from_run_id, job_id)
    references q_runtime.workforce_agent_runs (id, job_id) on delete cascade,
  foreign key (to_run_id, job_id)
    references q_runtime.workforce_agent_runs (id, job_id) on delete cascade,
  foreign key (draft_id, job_id)
    references q_runtime.workforce_drafts (id, job_id) on delete cascade
);
create index workforce_handoffs_job_idx
  on q_runtime.workforce_handoffs (job_id, created_at);

create table q_runtime.workforce_grades (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null,
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  reviewer_run_id   uuid,
  score             integer not null check (score between 0 and 100),
  passed            boolean not null,
  -- The bar it was held to, stored with the grade: a later change to the
  -- job's bar never re-reads an old grade.
  threshold         integer not null check (threshold between 0 and 100),
  max_redrafts      integer not null check (max_redrafts between 0 and 5),
  rubric_version    text not null check (length(rubric_version) between 1 and 64),
  prompt_version    text not null check (length(prompt_version) between 1 and 64),
  criteria          jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(criteria) = 'array' and pg_column_size(criteria) <= 8192),
  integrity         jsonb not null default '[]'::jsonb
                      check (jsonb_typeof(integrity) = 'array' and pg_column_size(integrity) <= 8192),
  feedback          text not null default '' check (length(feedback) <= 1000),
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  foreign key (draft_id, job_id)
    references q_runtime.workforce_drafts (id, job_id) on delete cascade,
  foreign key (reviewer_run_id, job_id)
    references q_runtime.workforce_agent_runs (id, job_id) on delete cascade,
  unique (draft_id)
);
create index workforce_grades_job_idx on q_runtime.workforce_grades (job_id);

create table q_runtime.workforce_draft_outcomes (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null,
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  -- SENT: Q sent it on its own (AUTO). OFFERED: put to the person for
  -- approval (ASK). HELD: not sent and not offered; the reason says why.
  outcome           text not null check (outcome in ('SENT', 'OFFERED', 'HELD')),
  reason            text check (reason is null or reason ~ '^[A-Z][A-Z_]{1,63}$'),
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  foreign key (draft_id, job_id)
    references q_runtime.workforce_drafts (id, job_id) on delete cascade,
  unique (draft_id, outcome)
);
create index workforce_draft_outcomes_job_idx on q_runtime.workforce_draft_outcomes (job_id);

create table q_runtime.workforce_feedback (
  id                uuid primary key default gen_random_uuid(),
  draft_id          uuid not null,
  job_id            uuid not null,
  tenant_id         uuid not null,
  user_id           uuid not null,
  kind              text not null check (kind in ('APPROVED', 'EDITED', 'REJECTED', 'REPLIED', 'NO_REPLY')),
  -- The person's own words when they edited the draft.
  edited_body       text check (edited_body is null or length(edited_body) between 1 and 4000),
  note              text check (note is null or length(note) <= 500),
  -- The preference the Write Gate kept from it, when it kept one.
  memory_item_id    uuid,
  idempotency_key   text not null check (length(idempotency_key) between 8 and 200),
  created_at        timestamptz not null default clock_timestamp(),
  foreign key (job_id, tenant_id, user_id)
    references q_runtime.workforce_jobs (id, tenant_id, user_id) on delete cascade,
  foreign key (draft_id, job_id)
    references q_runtime.workforce_drafts (id, job_id) on delete cascade,
  unique (tenant_id, user_id, idempotency_key),
  constraint workforce_feedback_edit_check check ((kind = 'EDITED') = (edited_body is not null))
);
create index workforce_feedback_owner_idx
  on q_runtime.workforce_feedback (tenant_id, user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- What may change, and how
-- ---------------------------------------------------------------------------

-- A job's status (and its clock) moves; nothing else about it does.
create function q_runtime.workforce_jobs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.id, new.tenant_id, new.user_id, new.source_kind, new.source_id, new.goal,
      new.budget_usd, new.review_threshold, new.max_redrafts, new.rubric_version,
      new.visibility_scope, new.created_at)
     is distinct from
     (old.id, old.tenant_id, old.user_id, old.source_kind, old.source_id, old.goal,
      old.budget_usd, old.review_threshold, old.max_redrafts, old.rubric_version,
      old.visibility_scope, old.created_at) then
    raise exception 'a workforce job''s status is all that changes'
      using errcode = 'check_violation';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
revoke all on function q_runtime.workforce_jobs_guard() from public;
create trigger workforce_jobs_guard
  before update on q_runtime.workforce_jobs
  for each row execute function q_runtime.workforce_jobs_guard();

-- An agent run ends once: status, summary and ended_at, from RUNNING only.
create function q_runtime.workforce_agent_runs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'RUNNING' then
    raise exception 'an agent run that ended is history'
      using errcode = 'check_violation';
  end if;
  if (new.id, new.job_id, new.tenant_id, new.user_id, new.role, new.agent_name, new.goal,
      new.tools, new.budget_usd, new.step_key, new.spawned_by_run_id, new.started_at)
     is distinct from
     (old.id, old.job_id, old.tenant_id, old.user_id, old.role, old.agent_name, old.goal,
      old.tools, old.budget_usd, old.step_key, old.spawned_by_run_id, old.started_at) then
    raise exception 'only an agent run''s ending is written'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function q_runtime.workforce_agent_runs_guard() from public;
create trigger workforce_agent_runs_guard
  before update on q_runtime.workforce_agent_runs
  for each row execute function q_runtime.workforce_agent_runs_guard();

-- History is never rewritten. (Deleting an account cascades through the
-- foreign keys; no role is granted delete directly.)
create function q_runtime.workforce_history_no_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name
    using errcode = 'check_violation';
end;
$$;
revoke all on function q_runtime.workforce_history_no_update() from public;

create trigger workforce_drafts_no_update before update on q_runtime.workforce_drafts
  for each row execute function q_runtime.workforce_history_no_update();
create trigger workforce_handoffs_no_update before update on q_runtime.workforce_handoffs
  for each row execute function q_runtime.workforce_history_no_update();
create trigger workforce_grades_no_update before update on q_runtime.workforce_grades
  for each row execute function q_runtime.workforce_history_no_update();
create trigger workforce_draft_outcomes_no_update before update on q_runtime.workforce_draft_outcomes
  for each row execute function q_runtime.workforce_history_no_update();
create trigger workforce_feedback_no_update before update on q_runtime.workforce_feedback
  for each row execute function q_runtime.workforce_history_no_update();

-- ---------------------------------------------------------------------------
-- RLS and grants: the owner reads; the server writes
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'workforce_jobs', 'workforce_agent_runs', 'workforce_handoffs', 'workforce_drafts',
    'workforce_grades', 'workforce_draft_outcomes', 'workforce_feedback'
  ] loop
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

-- Only a job's status and a run's ending are ever updated, by the server.
grant update on q_runtime.workforce_jobs to postgres, service_role;
grant update on q_runtime.workforce_agent_runs to postgres, service_role;

comment on table q_runtime.workforce_jobs is
  'J1-J9: one job of Q''s workforce for one person, with its budget and review bar. personal_private; only status changes.';
comment on table q_runtime.workforce_agent_runs is
  'J1/J4: one agent''s run in a job (role, tools, budget, who spawned it). Ends once.';
comment on table q_runtime.workforce_handoffs is
  'J1: who handed what to whom inside a job. Append-only.';
comment on table q_runtime.workforce_drafts is
  'J2: every outward draft and redraft Q''s writer produced. Append-only; never evidence.';
comment on table q_runtime.workforce_grades is
  'J2: the reviewer''s grade of a draft, with the bar (threshold, redrafts, rubric) it was held to. Append-only.';
comment on table q_runtime.workforce_draft_outcomes is
  'J2: whether a draft was sent, offered for approval or held, and why. Append-only.';
comment on table q_runtime.workforce_feedback is
  'J3: the person''s approval, edit or rejection of a draft, and outcomes. Append-only; learning goes through the memory Write Gate.';

-- ---------------------------------------------------------------------------
-- Billing: workforce jobs are a metered plan feature (J6)
-- ---------------------------------------------------------------------------

insert into billing.features (key, name, description, kind, unit_singular, unit_plural) values
  ('q.agent_jobs', 'Q''s agents', 'Jobs Q''s agents carry out for you: planned, drafted, graded and sent or offered for approval.', 'MONTHLY', 'job', 'jobs');

insert into billing.plan_features (plan_id, feature_key, included, limit_value)
select p.id, v.feature_key, v.included, v.limit_value
  from (values
    ('launch',       'q.agent_jobs', true, 100),
    ('free',         'q.agent_jobs', true, 5),
    ('founder_pro',  'q.agent_jobs', true, 100),
    ('investor_pro', 'q.agent_jobs', true, 200),
    ('fund',         'q.agent_jobs', true, 1000)
  ) as v (plan_key, feature_key, included, limit_value)
  join billing.plans p on p.key = v.plan_key and p.version = 1;
