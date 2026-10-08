-- Recovery D3 (audit D-08) · durable agent work.
--
-- q_runtime.agent_work_queue: approved workforce jobs as leased work. The
-- owner (an active member of the row's tenant) reads their own rows;
-- nobody in a browser writes; the server claims with FOR UPDATE SKIP
-- LOCKED under a lease, reclaims a lapsed lease, and ends every row in a
-- terminal work state that then never changes.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(25);

-- Shape ------------------------------------------------------------------------
select ok(
  (select c.relrowsecurity and c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'q_runtime' and c.relname = 'agent_work_queue'),
  'RLS is on and forced');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename = 'agent_work_queue'
     and cmd = 'SELECT' and qual like '%current_app_user_id%is_tenant_member%'),
  1, 'the owner''s-rows select policy');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename = 'agent_work_queue'
     and cmd <> 'SELECT'),
  0, 'no client write policy');
select ok(
  not has_table_privilege('service_role', 'q_runtime.agent_work_queue', 'DELETE'),
  'no role deletes work history directly');
select ok(
  not has_table_privilege('authenticated', 'q_runtime.agent_work_queue', 'UPDATE'),
  'a browser session cannot update work');

-- Rows -------------------------------------------------------------------------
insert into q_runtime.workforce_jobs (id, tenant_id, user_id, source_kind, source_id, goal, rubric_version) values
  ('00000000-0000-4000-8000-00000000e101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'JOB', 'action-1', 'Reply to Zino.', 'workforce-rubric/v1'),
  ('00000000-0000-4000-8000-00000000e102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   'JOB', 'action-2', 'Research five investors.', 'workforce-rubric/v1'),
  ('00000000-0000-4000-8000-00000000e103', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   'JOB', 'action-3', 'Book calls.', 'workforce-rubric/v1');
insert into q_runtime.agent_work_queue (job_id, tenant_id, user_id, plan, trace) values
  ('00000000-0000-4000-8000-00000000e101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   '{"summary":"Reply"}', '{"conversationId":"00000000-0000-4000-8000-00000000e901"}'),
  ('00000000-0000-4000-8000-00000000e102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
   '{"summary":"Research"}', '{}'),
  ('00000000-0000-4000-8000-00000000e103', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   '{"summary":"Book"}', '{}');

-- Integrity --------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.agent_work_queue (job_id, tenant_id, user_id, plan)
     values ('00000000-0000-4000-8000-00000000e101', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '{}') $$,
  '23505', null, 'one work row per job');
select throws_ok(
  $$ insert into q_runtime.agent_work_queue (job_id, tenant_id, user_id, plan)
     values (gen_random_uuid(), pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '{}') $$,
  '23503', null, 'work names a real job');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'PLANNED' where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  '23514', null, 'a work row is never merely planned: plans are cards until approved');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'RUNNING' where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  '23514', null, 'running needs a lease');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'COMPLETED' where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  '23514', null, 'an ended row records when it ended');
select throws_ok(
  $$ update q_runtime.agent_work_queue set plan = '{"summary":"Something else"}'
      where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  '23514', null, 'the approved plan never changes');

-- The claim: FOR UPDATE SKIP LOCKED under a lease -----------------------------------
update q_runtime.agent_work_queue q
   set state = 'RUNNING', attempts = attempts + 1, locked_by = 'worker-1',
       locked_until = clock_timestamp() + interval '2 minutes', heartbeat_at = clock_timestamp()
 where q.job_id in (
   select job_id from q_runtime.agent_work_queue
    where state in ('QUEUED', 'RUNNING', 'RECOVERING')
      and (locked_until is null or locked_until < clock_timestamp())
      and attempts < max_attempts
    order by created_at limit 1
    for update skip locked);
select is(
  (select count(*)::int from q_runtime.agent_work_queue where state = 'RUNNING' and locked_by = 'worker-1'),
  1, 'a worker claims one live row under a lease');
select is(
  (select count(*)::int from q_runtime.agent_work_queue
    where state in ('QUEUED', 'RUNNING', 'RECOVERING')
      and (locked_until is null or locked_until < clock_timestamp())),
  2, 'a leased row is not claimable by another worker');

-- A worker that died: its lease lapses, the row is reclaimable and resumes.
update q_runtime.agent_work_queue
   set locked_until = clock_timestamp() - interval '1 second'
 where locked_by = 'worker-1';
update q_runtime.agent_work_queue
   set state = 'RECOVERING', locked_by = null, locked_until = null,
       reason = 'Q restarted while working on this; picking it up again.'
 where state = 'RUNNING' and locked_until < clock_timestamp();
select is(
  (select state from q_runtime.agent_work_queue where job_id = '00000000-0000-4000-8000-00000000e101'),
  'RECOVERING', 'a lapsed lease is reclaimed and shown as recovering');

-- Finishing ends the row for good.
select lives_ok(
  $$ update q_runtime.agent_work_queue
        set state = 'COMPLETED', finished_at = clock_timestamp(), locked_by = null, locked_until = null,
            results = '{"reply":{"status":"DONE","summary":"Replied to 1 person."}}'
      where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  'a job ends COMPLETED with its results');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'FAILED'
      where job_id = '00000000-0000-4000-8000-00000000e101' $$,
  '23514', null, 'and an ended row never changes');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'CANCELLED', finished_at = clock_timestamp(),
            locked_by = 'worker-2', locked_until = clock_timestamp()
      where job_id = '00000000-0000-4000-8000-00000000e102' $$,
  '23514', null, 'an ended row holds no lease');

-- RLS: closed to browsers by schema ---------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.agent_work_queue $$, '42501', null,
  'a browser session cannot reach the queue by default');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.agent_work_queue $$, '42501', null,
  'nor can an anonymous visitor');

select pg_temp.act_as_privileged();
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.agent_work_queue), 2, 'the owner reads their own work');
select throws_ok(
  $$ update q_runtime.agent_work_queue set state = 'CANCELLED', finished_at = clock_timestamp()
      where job_id = '00000000-0000-4000-8000-00000000e102' $$,
  '42501', null, 'stopping a job is the server''s, not the browser''s');
select throws_ok(
  $$ insert into q_runtime.agent_work_queue (job_id, tenant_id, user_id, plan)
     values ('00000000-0000-4000-8000-00000000e102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '{}') $$,
  '42501', null, 'nor is enqueuing');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.agent_work_queue), 1,
  'another tenant''s person reads only their own work');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.agent_work_queue), 0, 'a revoked member reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.agent_work_queue), 3,
  'the privileged server role reads every row');

select * from finish();
rollback;
