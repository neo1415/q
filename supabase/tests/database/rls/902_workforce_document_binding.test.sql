-- Durable workforce replay lives on the canonical artifact. Privileged
-- database access still does not replace actor/firewall authorization.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(10);

insert into q_runtime.workforce_jobs
  (id, tenant_id, user_id, source_kind, goal, rubric_version)
values ('00000000-0000-4000-8000-0000000092a1', pg_temp.rls_id('tenant_a'),
  pg_temp.rls_id('user_a'), 'JOB', 'Prepare own memo', 'workforce-rubric/v1');

select lives_ok($$ insert into artifacts.artifacts
  (tenant_id, organisation_id, type, created_by_user_id,
   workforce_job_id, workforce_step_key, workforce_intent_sha256)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'MEMO',
    pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000092a1', 'memo', repeat('a', 64)) $$,
  'server creates one artifact bound to its job owner');
select throws_ok($$ insert into artifacts.artifacts
  (tenant_id, organisation_id, type, created_by_user_id,
   workforce_job_id, workforce_step_key, workforce_intent_sha256)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'MEMO',
    pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000092a1', 'memo', repeat('a', 64)) $$,
  '23505', null, 'database unique index arbitrates concurrent step claims');
select throws_ok($$ insert into artifacts.artifacts
  (tenant_id, organisation_id, type, created_by_user_id,
   workforce_job_id, workforce_step_key, workforce_intent_sha256)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'MEMO',
    pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-0000000092a1', 'other', repeat('a', 64)) $$,
  '23503', null, 'a different owner cannot bind another persons job');
select throws_ok($$ insert into artifacts.artifacts
  (tenant_id, organisation_id, type, created_by_user_id, workforce_job_id)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'MEMO',
    pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-0000000092a1') $$,
  '23514', null, 'partial bindings are refused');
select throws_ok($$ update artifacts.artifacts set workforce_intent_sha256 = repeat('b',64)
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1' $$,
  '23514', null, 'approved intent digest is immutable');
select throws_ok($$ update artifacts.artifacts set workforce_step_key = 'different'
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1' $$,
  '23514', null, 'step identity is immutable');
select throws_ok($$ update artifacts.artifacts set type = 'PITCH_DECK'
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1' $$,
  '23514', null, 'document kind cannot change under the binding');
select lives_ok($$ update artifacts.artifacts set status = 'FAILED'
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1' $$,
  'existing lifecycle still moves without changing identity');

select pg_temp.act_as_user_a();
select throws_ok($$ update artifacts.artifacts set status = 'READY'
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1' $$,
  '42501', null, 'browser cannot write even its own bound artifact');
select pg_temp.act_as_user_b();
select is((select count(*)::int from artifacts.artifacts
  where workforce_job_id = '00000000-0000-4000-8000-0000000092a1'), 0,
  'artifact RLS hides a different owners bound document');

select * from finish();
rollback;
