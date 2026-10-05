-- Founder brief J1-J9 · Q's workforce of agents.
--
-- q_runtime.workforce_*: jobs, agent runs, hand-offs, drafts, grades,
-- outcomes and feedback, personal_private. The owner (an active member of
-- the row's tenant) reads their own rows; nobody else does, in any tenant;
-- nobody in a browser writes; history is never rewritten; a job's status
-- and a run's ending are all that change; children can never be filed under
-- someone else's job.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(31);

-- Shape ------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'q_runtime' and c.relname like 'workforce\_%' and c.relkind = 'r'
      and c.relrowsecurity and c.relforcerowsecurity),
  7, 'all seven workforce tables have RLS on and forced');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename like 'workforce\_%'
     and cmd = 'SELECT' and qual like '%current_app_user_id%is_tenant_member%'),
  7, 'each has the owner''s-rows select policy');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename like 'workforce\_%'
     and cmd <> 'SELECT'),
  0, 'no client write policy on any of them');
select ok(
  not has_table_privilege('service_role', 'q_runtime.workforce_drafts', 'DELETE'),
  'no role deletes history directly');
select is(
  (select limit_value::int from billing.plan_features pf join billing.plans p on p.id = pf.plan_id
    where pf.feature_key = 'q.agent_jobs' and p.key = 'free'),
  5, 'workforce jobs are a metered plan feature');

-- Rows -------------------------------------------------------------------------
insert into q_runtime.workforce_jobs (id, tenant_id, user_id, source_kind, source_id, goal, rubric_version) values
  ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'JOB', null, 'Express interest in every company matching my mandate.', 'workforce-rubric/v1'),
  ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   'ERRAND', 'errand-1', 'Reply to Ada.', 'workforce-rubric/v1');
insert into q_runtime.workforce_agent_runs (id, job_id, tenant_id, user_id, role, agent_name, goal) values
  ('00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'LEAD', 'Lead Q', 'Plan it.');
insert into q_runtime.workforce_agent_runs (id, job_id, tenant_id, user_id, role, agent_name, goal, tools, spawned_by_run_id) values
  ('00000000-0000-4000-8000-00000000f202', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'WRITER', 'Writer', 'Draft it.', '{}',
   '00000000-0000-4000-8000-00000000f201');
insert into q_runtime.workforce_drafts (id, job_id, tenant_id, user_id, writer_run_id, attempt, channel, body, body_sha256) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000f202',
   1, 'CHAT', 'Hi Ada, I enjoyed reading about Tallyloom.', repeat('a', 64));
insert into q_runtime.workforce_grades (draft_id, job_id, tenant_id, user_id, score, passed, threshold, max_redrafts,
                                       rubric_version, prompt_version) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 88, true, 75, 2, 'workforce-rubric/v1', 'draft-review/v1');
insert into q_runtime.workforce_draft_outcomes (draft_id, job_id, tenant_id, user_id, outcome) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'SENT');
insert into q_runtime.workforce_handoffs (job_id, tenant_id, user_id, from_run_id, to_run_id, note) values
  ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   '00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f202', 'Assigned: draft it.');
insert into q_runtime.workforce_feedback (draft_id, job_id, tenant_id, user_id, kind, idempotency_key) values
  ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
   pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'APPROVED', 'feedback-key-1');

-- Integrity --------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.workforce_drafts (job_id, tenant_id, user_id, attempt, channel, body, body_sha256)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
             1, 'CHAT', 'Filed under A''s job.', repeat('b', 64)) $$,
  '23503', null, 'a draft cannot be filed under someone else''s job');
select throws_ok(
  $$ insert into q_runtime.workforce_handoffs (job_id, tenant_id, user_id, from_run_id, to_run_id, note)
     values ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
             '00000000-0000-4000-8000-00000000f201', '00000000-0000-4000-8000-00000000f202', 'Cross-job.') $$,
  '23503', null, 'a hand-off names runs of its own job only');
select throws_ok(
  $$ insert into q_runtime.workforce_jobs (tenant_id, user_id, source_kind, source_id, goal, rubric_version)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ERRAND', 'errand-1', 'Again.', 'r/v1') $$,
  '23505', null, 'one job per source');
select throws_ok(
  $$ insert into q_runtime.workforce_jobs (tenant_id, user_id, source_kind, goal, rubric_version, review_threshold)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'JOB', 'Bar too high.', 'r/v1', 101) $$,
  '23514', null, 'the review threshold is out of 100');
select throws_ok(
  $$ insert into q_runtime.workforce_jobs (tenant_id, user_id, source_kind, goal, rubric_version, visibility_scope)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'JOB', 'Shared?', 'r/v1', 'network_visible') $$,
  '23514', null, 'a job is personal_private only');
select throws_ok(
  $$ insert into q_runtime.workforce_agent_runs (job_id, tenant_id, user_id, role, agent_name, goal, spawned_by_run_id)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'HACKER', 'x', 'y', '00000000-0000-4000-8000-00000000f201') $$,
  '23514', null, 'a role is one of the registry''s');
select throws_ok(
  $$ insert into q_runtime.workforce_agent_runs (job_id, tenant_id, user_id, role, agent_name, goal)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'WRITER', 'Writer', 'Unspawned.') $$,
  '23514', null, 'every agent but the lead was spawned by a run');
select throws_ok(
  $$ insert into q_runtime.workforce_feedback (draft_id, job_id, tenant_id, user_id, kind, idempotency_key)
     values ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
             pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'EDITED', 'feedback-key-2') $$,
  '23514', null, 'an edit carries the person''s words');

-- What changes, and what never does -----------------------------------------------
select lives_ok(
  $$ update q_runtime.workforce_jobs set status = 'DONE' where id = '00000000-0000-4000-8000-00000000f101' $$,
  'a job''s status moves');
select throws_ok(
  $$ update q_runtime.workforce_jobs set budget_usd = 99 where id = '00000000-0000-4000-8000-00000000f101' $$,
  '23514', null, 'its budget does not');
select lives_ok(
  $$ update q_runtime.workforce_agent_runs set status = 'DONE', ended_at = clock_timestamp(), summary = 'Drafted.'
      where id = '00000000-0000-4000-8000-00000000f202' $$,
  'an agent run ends');
select throws_ok(
  $$ update q_runtime.workforce_agent_runs set status = 'FAILED' where id = '00000000-0000-4000-8000-00000000f202' $$,
  '23514', null, 'once');
select throws_ok(
  $$ update q_runtime.workforce_agent_runs set tools = '{chat.message.send}', status = 'DONE', ended_at = clock_timestamp()
      where id = '00000000-0000-4000-8000-00000000f201' $$,
  '23514', null, 'and its tools are never widened');
select throws_ok(
  $$ update q_runtime.workforce_drafts set body = 'Rewritten.' $$,
  '23514', null, 'a draft is never rewritten');
select throws_ok(
  $$ update q_runtime.workforce_grades set score = 100 $$,
  '23514', null, 'nor a grade');
select throws_ok(
  $$ update q_runtime.workforce_feedback set kind = 'REJECTED' $$,
  '23514', null, 'nor feedback');

-- RLS: closed to browsers by schema ---------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.workforce_jobs $$, '42501', null,
  'a browser session cannot reach the workforce tables');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.workforce_drafts $$, '42501', null,
  'nor can an anonymous visitor');

-- The policy itself, with schema usage opened inside this transaction only.
select pg_temp.act_as_privileged();
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.workforce_jobs), 1, 'the owner reads their own job');
select is((select count(*)::int from q_runtime.workforce_drafts), 1, 'and its drafts');
select is((select count(*)::int from q_runtime.workforce_grades), 1, 'and their grades');
select throws_ok(
  $$ insert into q_runtime.workforce_feedback (draft_id, job_id, tenant_id, user_id, kind, idempotency_key)
     values ('00000000-0000-4000-8000-00000000f301', '00000000-0000-4000-8000-00000000f101',
             pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REJECTED', 'browser-key-1') $$,
  '42501', null, 'feedback is written by the server, not the browser');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.workforce_drafts), 0,
  'another tenant''s person reads none of A''s drafts');
select is((select count(*)::int from q_runtime.workforce_jobs), 1, 'only their own job');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.workforce_jobs), 0, 'a revoked member reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.workforce_jobs), 2,
  'the privileged server role reads every row');

select * from finish();
rollback;
