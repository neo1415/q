-- 20261204090000 · WORK-58: "Not now" on a Q's work suggestion, per person.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes and reads the
-- person's own dismissals; no client role reaches the table.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the API scopes every read to the actor).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(8);

select lives_ok(
  $$ insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'stalled_reply:00000000-0000-4000-8000-00000000c001') $$,
  'the server records a dismissal for the person');
select throws_ok(
  $$ insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'stalled_reply:00000000-0000-4000-8000-00000000c001') $$,
  '23505', null, 'one dismissal per person and suggestion');
select lives_ok(
  $$ insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'stalled_reply:00000000-0000-4000-8000-00000000c001') $$,
  'another person dismisses the same suggestion separately');
select throws_ok(
  $$ insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'free text; drop table') $$,
  '23514', null, 'a key outside the opaque shape is refused');
select is((select relrowsecurity from pg_class where oid = 'q_runtime.work_suggestion_dismissals'::regclass),
  true, 'row level security is on');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'q_runtime'
      and table_name = 'work_suggestion_dismissals'),
  0, 'no client role holds any privilege on dismissals');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.work_suggestion_dismissals $$, '42501', null,
  'A cannot read dismissals directly; the API answers for their own');
select pg_temp.act_as_anonymous();
select throws_ok($$ insert into q_runtime.work_suggestion_dismissals (tenant_id, user_id, suggestion_key)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'deck_unshared:x') $$, '42501', null,
  'an anonymous visitor cannot write a dismissal');

select * from finish();
rollback;
