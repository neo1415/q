-- Scoped delegation · q_runtime.instruction_delegations (founder 2026-10-07).
--
-- Server-written; the person reads their own rows only through the API (no
-- usage grant on q_runtime; the owner policy is a second layer). A
-- delegation is revoked, never deleted or rewritten; one live per
-- instruction; switching on again is a new row.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

insert into q_runtime.standing_instructions (id, tenant_id, user_id, goal_text, status, grant_version) values
  ('00000000-0000-4000-8000-00000000d101', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Reply to founders who write to me', 'ACTIVE', 1);
insert into q_runtime.instruction_delegations (id, tenant_id, user_id, instruction_id, scope) values
  ('00000000-0000-4000-8000-00000000d201', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'),
   '00000000-0000-4000-8000-00000000d101', 'RELATIONSHIP_ROUTINE');

select is((select relrowsecurity from pg_class where oid = 'q_runtime.instruction_delegations'::regclass),
  true, 'row level security is on');
select throws_ok(
  $$ insert into q_runtime.instruction_delegations (tenant_id, user_id, instruction_id, scope) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000d101', 'RELATIONSHIP_ROUTINE') $$,
  '23505', null, 'one live delegation per instruction');
select throws_ok(
  $$ insert into q_runtime.instruction_delegations (tenant_id, user_id, instruction_id, scope) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000d101', 'EVERYTHING') $$,
  '23514', null, 'an unknown scope is refused');
select throws_ok(
  $$ update q_runtime.instruction_delegations set scope = 'RELATIONSHIP_ROUTINE', enabled_at = now() - interval '1 day'
     where id = '00000000-0000-4000-8000-00000000d201' $$,
  '42501', null, 'a delegation is never rewritten');
select lives_ok(
  $$ update q_runtime.instruction_delegations set revoked_at = clock_timestamp()
     where id = '00000000-0000-4000-8000-00000000d201' $$,
  'revoking is the one allowed change');
select throws_ok(
  $$ update q_runtime.instruction_delegations set revoked_at = null
     where id = '00000000-0000-4000-8000-00000000d201' $$,
  '42501', null, 'a revoked delegation is never switched back on');
select throws_ok(
  $$ delete from q_runtime.instruction_delegations where id = '00000000-0000-4000-8000-00000000d201' $$,
  '42501', null, 'a delegation is never deleted');
select lives_ok(
  $$ insert into q_runtime.instruction_delegations (tenant_id, user_id, instruction_id, scope) values
     (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000d101', 'RELATIONSHIP_ROUTINE') $$,
  'switching on again is a new row');

-- Clients ---------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.instruction_delegations $$, '42501', null,
  'another tenant cannot reach delegations directly');
select pg_temp.act_as_user_b();
select throws_ok($$ insert into q_runtime.instruction_delegations (tenant_id, user_id, instruction_id, scope)
  values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-00000000d101', 'RELATIONSHIP_ROUTINE') $$,
  '42501', null, 'no client switches a delegation on');

select * from finish();
rollback;
