-- Situation-first planning (owner 2026-10-28) · q_runtime.q_plans,
-- q_plan_versions, workforce_thread.
--
-- personal_private. The owner (an active member of the row's tenant) reads
-- their own rows; nobody else does, in any tenant; a revoked member reads
-- nothing; nobody in a browser writes; versions are sequential and never
-- rewritten; a plan's status and head are all that move; the head moves
-- only to a version that was written; nothing is filed under someone
-- else's plan or job; only the person gives direction.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(34);

-- Shape ------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'q_runtime' and c.relname in ('q_plans', 'q_plan_versions', 'workforce_thread')
      and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
  3, 'all three tables have RLS on and forced');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime'
     and tablename in ('q_plans', 'q_plan_versions', 'workforce_thread')
     and cmd = 'SELECT' and qual like '%current_app_user_id%is_tenant_member%'),
  3, 'each has the owner''s-rows select policy');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime'
     and tablename in ('q_plans', 'q_plan_versions', 'workforce_thread') and cmd <> 'SELECT'),
  0, 'no client write policy on any of them');
select ok(
  not has_table_privilege('service_role', 'q_runtime.q_plan_versions', 'UPDATE')
  and not has_table_privilege('service_role', 'q_runtime.q_plan_versions', 'DELETE')
  and not has_table_privilege('service_role', 'q_runtime.workforce_thread', 'DELETE'),
  'no role rewrites or deletes history directly');
select ok(
  not has_table_privilege('authenticated', 'q_runtime.q_plans', 'INSERT')
  and not has_table_privilege('authenticated', 'q_runtime.workforce_thread', 'INSERT'),
  'browsers are granted no writes');

-- Rows -------------------------------------------------------------------------
insert into q_runtime.workforce_jobs (id, tenant_id, user_id, source_kind, goal, rubric_version) values
  ('00000000-0000-4000-8000-00000000e101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'JOB', 'Plan my seed raise.', 'plan-rubric/v1');
insert into q_runtime.q_plans (id, tenant_id, user_id, side, goal, job_id, idempotency_key) values
  ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'FOUNDER', 'Close my seed round by March.', '00000000-0000-4000-8000-00000000e101', 'plan-key-a-1'),
  ('00000000-0000-4000-8000-00000000e202', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   'INVESTOR', 'Deploy into two fintech seeds this quarter.', null, 'plan-key-b-1'),
  ('00000000-0000-4000-8000-00000000e203', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'),
   'FOUNDER', 'A revoked member''s plan.', null, 'plan-key-r-1');
insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
                                       review_threshold, rubric_version, prompt_version, score_r1, score_r2,
                                       fully_reviewed, cause) values
  ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1,
   '{"steps": []}'::jsonb, repeat('a', 64), '{"sections": []}'::jsonb,
   99, 'plan-rubric/v1', 'plan-write/v1', 99, 100, true, 'DRAFT'),
  ('00000000-0000-4000-8000-00000000e202', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 1,
   '{"steps": []}'::jsonb, repeat('b', 64), '{"sections": []}'::jsonb,
   99, 'plan-rubric/v1', 'plan-write/v1', 80, 90, false, 'DRAFT'),
  ('00000000-0000-4000-8000-00000000e203', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 1,
   '{"steps": []}'::jsonb, repeat('c', 64), '{"sections": []}'::jsonb,
   99, 'plan-rubric/v1', 'plan-write/v1', null, null, false, 'DRAFT');
insert into q_runtime.workforce_thread (id, tenant_id, user_id, plan_id, job_id, seq, kind, author, step_key, body,
                                        idempotency_key) values
  ('00000000-0000-4000-8000-00000000e301', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   '00000000-0000-4000-8000-00000000e201', '00000000-0000-4000-8000-00000000e101', 1, 'NOTE', 'PLANNER',
   'warm_intros', 'Two investors left notes asking about churn.', 'thread-key-a-1'),
  ('00000000-0000-4000-8000-00000000e302', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   '00000000-0000-4000-8000-00000000e201', null, 2, 'DIRECTION', 'PERSON',
   null, 'Leave the Lagos funds out for now.', 'thread-key-a-2');

select is(
  (select current_version from q_runtime.q_plans where id = '00000000-0000-4000-8000-00000000e201'),
  1, 'writing a version moves the plan to it');

-- Integrity --------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
       review_threshold, rubric_version, prompt_version, fully_reviewed, cause)
     values ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 3,
       '{}'::jsonb, repeat('d', 64), '{}'::jsonb, 99, 'plan-rubric/v1', 'plan-write/v1', false, 'CHANGE') $$,
  '23514', null, 'versions come in order: no skipping');
select throws_ok(
  $$ insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
       review_threshold, rubric_version, prompt_version, fully_reviewed, cause)
     values ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1,
       '{}'::jsonb, repeat('d', 64), '{}'::jsonb, 99, 'plan-rubric/v1', 'plan-write/v1', false, 'DRAFT') $$,
  '23514', null, 'and no second version 1');
select lives_ok(
  $$ insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
       review_threshold, rubric_version, prompt_version, score_r1, score_r2, fully_reviewed, cause, direction_id)
     values ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 2,
       '{"steps": []}'::jsonb, repeat('e', 64), '{}'::jsonb, 99, 'plan-rubric/v1', 'plan-write/v1', 99, 99, true,
       'CHANGE', '00000000-0000-4000-8000-00000000e302') $$,
  'the person''s change is the next version, naming their direction');
select is(
  (select current_version from q_runtime.q_plans where id = '00000000-0000-4000-8000-00000000e201'),
  2, 'and the plan follows it');
select throws_ok(
  $$ insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
       review_threshold, rubric_version, prompt_version, fully_reviewed, cause)
     values ('00000000-0000-4000-8000-00000000e201', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 3,
       '{}'::jsonb, repeat('f', 64), '{}'::jsonb, 99, 'plan-rubric/v1', 'plan-write/v1', false, 'REPLAN') $$,
  '23503', null, 'a version cannot be filed under someone else''s plan');
select throws_ok(
  $$ insert into q_runtime.q_plan_versions (plan_id, tenant_id, user_id, version, body, body_sha256, situation,
       review_threshold, rubric_version, prompt_version, fully_reviewed, cause)
     values ('00000000-0000-4000-8000-00000000e202', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 2,
       '{}'::jsonb, repeat('f', 64), '{}'::jsonb, 99, 'plan-rubric/v1', 'plan-write/v1', true, 'REPLAN') $$,
  '23514', null, 'fully reviewed means both reviews were scored');
select throws_ok(
  $$ insert into q_runtime.q_plans (tenant_id, user_id, side, goal, job_id, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'INVESTOR', 'Under A''s job.',
             '00000000-0000-4000-8000-00000000e101', 'plan-key-b-2') $$,
  '23503', null, 'a plan names its own person''s job only');
select throws_ok(
  $$ insert into q_runtime.q_plans (tenant_id, user_id, side, goal, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'FOUNDER', 'Retried.', 'plan-key-a-1') $$,
  '23505', null, 'a retried plan writes nothing new');
select throws_ok(
  $$ insert into q_runtime.q_plans (tenant_id, user_id, side, goal, idempotency_key, visibility_scope)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'FOUNDER', 'Shared?', 'plan-key-a-9',
             'network_visible') $$,
  '23514', null, 'a plan is personal_private only');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, plan_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000e201',
             3, 'NOTE', 'WORKER', 'Filed under A''s plan.', 'thread-key-b-1') $$,
  '23503', null, 'a thread entry cannot be filed under someone else''s plan');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, plan_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000e201',
             3, 'DIRECTION', 'PLANNER', 'Do it my way.', 'thread-key-a-3') $$,
  '23514', null, 'only the person gives direction');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1, 'NOTE', 'WORKER', 'Orphan.', 'thread-key-a-4') $$,
  '23514', null, 'an entry belongs to a plan or a job');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, plan_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000e201',
             2, 'NOTE', 'WORKER', 'Same place.', 'thread-key-a-5') $$,
  '23505', null, 'one entry per place in a thread');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, plan_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000e201',
             3, 'DIRECTION', 'PERSON', 'Retried.', 'thread-key-a-2') $$,
  '23505', null, 'a retried direction writes nothing new');

-- What changes, and what never does -----------------------------------------------
select lives_ok(
  $$ update q_runtime.q_plans set status = 'ON_BOARD' where id = '00000000-0000-4000-8000-00000000e201' $$,
  'a plan''s status moves');
select throws_ok(
  $$ update q_runtime.q_plans set goal = 'Rewritten.' where id = '00000000-0000-4000-8000-00000000e201' $$,
  '23514', null, 'its goal does not');
select throws_ok(
  $$ update q_runtime.q_plans set current_version = 3 where id = '00000000-0000-4000-8000-00000000e201' $$,
  '23514', null, 'nor does its version, except by writing the next one');
select throws_ok(
  $$ update q_runtime.q_plan_versions set body = '{}'::jsonb $$,
  '23514', null, 'a version is never rewritten');
select throws_ok(
  $$ update q_runtime.workforce_thread set body = 'Rewritten.' $$,
  '23514', null, 'nor is the thread');

-- RLS: closed to browsers by schema ---------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.q_plans $$, '42501', null,
  'a browser session cannot reach the plan tables');

-- The policy itself, with schema usage opened inside this transaction only.
select pg_temp.act_as_privileged();
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.q_plans), 1, 'the owner reads their own plan');
select is((select count(*)::int from q_runtime.q_plan_versions), 2, 'and its versions');
select is((select count(*)::int from q_runtime.workforce_thread), 2, 'and its thread');
select throws_ok(
  $$ insert into q_runtime.workforce_thread (tenant_id, user_id, plan_id, seq, kind, author, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000e201',
             9, 'DIRECTION', 'PERSON', 'From the browser.', 'browser-key-1') $$,
  '42501', null, 'direction is written by the server, not the browser');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.q_plan_versions
            where plan_id = '00000000-0000-4000-8000-00000000e201'), 0,
  'another tenant''s person reads none of A''s versions');
select is((select count(*)::int from q_runtime.workforce_thread), 0, 'nor A''s thread');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.q_plans), 0, 'a revoked member reads nothing, their own plan included');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.q_plans), 3,
  'the privileged server role reads every row');

select * from finish();
rollback;
