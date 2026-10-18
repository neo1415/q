-- ADR 0043 · q_runtime.standing_instructions, instruction_grants,
-- instruction_steps.
--
-- Server-written; a person may read their own rows only through the API (no
-- usage grant on q_runtime; owner policies are a second layer). Grants are
-- append-only except for recording a version's approval; steps are
-- append-only even for the server role. A non-DRAFT instruction always
-- names its approved grant version.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

insert into q_runtime.standing_instructions (id, tenant_id, user_id, goal_text, status, grant_version) values
  ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Handle all the work for me', 'ACTIVE', 1),
  ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'Find me investors', 'DRAFT', null);
insert into q_runtime.instruction_grants (id, tenant_id, instruction_id, version, grant_payload, payload_hash) values
  ('00000000-0000-4000-8000-00000000f201', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000f101', 1,
   '{"actions": []}', 'sha256:' || repeat('a', 64));
insert into q_runtime.instruction_steps (tenant_id, user_id, instruction_id, grant_version, run_key, step_index, action, mode, status, words, idempotency_key) values
  (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000f101', 1, 'run:00000001', 0,
   'chat.message.send', 'AUTO', 'DONE', 'Sent Ledgerfold a short hello.', 'instruction:f101:run1:0');

-- Shape -----------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'q_runtime.standing_instructions'::regclass, 'q_runtime.instruction_grants'::regclass,
  'q_runtime.instruction_steps'::regclass)), true, 'row level security is on for every new table');

-- Constraints -------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.standing_instructions (tenant_id, user_id, goal_text, status) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'x', 'ACTIVE') $$,
  '23514', null, 'an active instruction must name its approved grant version');
select throws_ok(
  $$ insert into q_runtime.standing_instructions (tenant_id, user_id, goal_text, status, grant_version) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'x', 'RUNNING_WILD', 1) $$,
  '23514', null, 'an unknown status is refused');
select throws_ok(
  $$ insert into q_runtime.standing_instructions (tenant_id, user_id, goal_text, budget_usd_month) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'x', -1) $$,
  '23514', null, 'a budget is never negative');
select throws_ok(
  $$ insert into q_runtime.instruction_grants (tenant_id, instruction_id, version, grant_payload, payload_hash) values
     (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000f101', 1, '{}', 'sha256:' || repeat('b', 64)) $$,
  '23505', null, 'one grant per instruction version');
select throws_ok(
  $$ update q_runtime.instruction_grants set grant_payload = '{"actions": ["anything"]}'
     where id = '00000000-0000-4000-8000-00000000f201' $$,
  '42501', null, 'an approved grant is never rewritten');
select lives_ok(
  $$ update q_runtime.instruction_grants set approved_q_action_id = '00000000-0000-4000-8000-00000000a201'
     where id = '00000000-0000-4000-8000-00000000f201' $$,
  'recording the approval of a version is the one allowed change');
select throws_ok(
  $$ update q_runtime.instruction_grants set approved_q_action_id = '00000000-0000-4000-8000-00000000a202'
     where id = '00000000-0000-4000-8000-00000000f201' $$,
  '42501', null, 'and only once');
select throws_ok(
  $$ delete from q_runtime.instruction_grants where id = '00000000-0000-4000-8000-00000000f201' $$,
  '42501', null, 'a grant is never deleted');
select throws_ok(
  $$ update q_runtime.instruction_steps set words = 'rewritten' $$,
  '42501', null, 'the step trail is append-only');
select throws_ok(
  $$ insert into q_runtime.instruction_steps (tenant_id, user_id, instruction_id, grant_version, run_key, step_index, action, mode, status, words, idempotency_key) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000f101', 1, 'run:00000001', 1,
      'chat.message.send', 'AUTO', 'DONE', 'again', 'instruction:f101:run1:0') $$,
  '23505', null, 'a step happens once per idempotency key');

-- Clients ---------------------------------------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.standing_instructions $$, '42501', null,
  'B cannot reach instructions directly; the API answers for their own');
select throws_ok($$ insert into q_runtime.instruction_steps (tenant_id, user_id, instruction_id, grant_version, run_key, step_index, action, mode, status, words, idempotency_key)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000f101', 1, 'run:00000002', 0, 'x', 'AUTO', 'DONE', 'x', 'instruction:client:00') $$,
  '42501', null, 'no client writes a step');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.instruction_grants $$, '42501', null,
  'an anonymous visitor cannot read grants');

select * from finish();
rollback;
