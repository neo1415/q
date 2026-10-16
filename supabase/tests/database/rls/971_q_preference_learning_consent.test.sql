-- Lane ob1 · q_knowledge.preference_learning_consents: one decision per
-- person per tenant, closed vocabulary, a "Not now" always carries when it
-- may be asked again, and the table is server-only (no browser principal
-- reads or writes anyone's consent, their own included).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

select lives_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'GRANTED', 'PROMPT', 'v1') $$,
  'a person grants learning in their workspace');
select throws_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'REVOKED', 'SETTINGS', 'v1') $$,
  '23505', null, 'one decision per person per tenant');
select lives_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, ask_again_after, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'), 'DECLINED', now() + interval '30 days', 'PROMPT', 'v1') $$,
  'another tenant keeps its own decision, never inherited');
select throws_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'DECLINED', 'PROMPT', 'v1') $$,
  '23514', null, 'a Not now carries when it may be asked again');
select throws_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'MAYBE', 'PROMPT', 'v1') $$,
  '23514', null, 'status vocabulary is closed');
select throws_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'GRANTED', 'EMAIL', 'v1') $$,
  '23514', null, 'where it was decided is a closed vocabulary');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_knowledge.preference_learning_consents $$, '42501', null,
  'browser user A cannot read consent rows, even their own');
select throws_ok(
  $$ insert into q_knowledge.preference_learning_consents (tenant_id, user_id, status, decided_via, policy_version)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_b'), 'GRANTED', 'PROMPT', 'v1') $$,
  '42501', null, 'a browser user cannot grant consent for anyone');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_knowledge.preference_learning_consents $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
