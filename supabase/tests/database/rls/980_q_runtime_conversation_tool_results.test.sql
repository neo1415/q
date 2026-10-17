-- Owner live 2026-10-17: what Q fetched in a conversation, kept for its
-- follow-ups. One row per successful read-only tool result of a run, owned
-- by the conversation's owner, written once, bounded in size and lifetime,
-- and unreachable from any browser principal.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes and reads rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: the Q API reads a
-- row back only for the conversation's own owner; the owner trigger and the
-- absent client grants are the second layer.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'PERSONAL'),
  ('00000000-0000-4000-8000-00000000c902', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'PERSONAL');

insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values
  ('00000000-0000-4000-8000-00000000c911', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null,
   '00000000-0000-4000-8000-00000000c901', 'Top three on my mandate', 'ANSWER', 'MODERATE',
   'cor_00000000-0000-4000-8000-00000000c911'),
  ('00000000-0000-4000-8000-00000000c912', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null,
   '00000000-0000-4000-8000-00000000c902', 'Another person''s turn', 'ANSWER', 'MODERATE',
   'cor_00000000-0000-4000-8000-00000000c912');

select has_table('q_runtime', 'conversation_tool_results', 'the table exists');

-- Positive: the run's own result, for its own owner and conversation.
select lives_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, arguments, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c911', 0, 'fit.profile', '{"companyId":"x"}',
             '{"score":8.8,"name":"Clearwater Assurance"}', 'NETWORK_VISIBLE') $$,
  'a run keeps its own read for its own conversation');
select is(
  (select result->>'name' from q_runtime.conversation_tool_results
    where run_id = '00000000-0000-4000-8000-00000000c911'),
  'Clearwater Assurance', 'the server reads the result back');
select ok(
  (select expires_at <= created_at + interval '14 days' + interval '1 second'
     from q_runtime.conversation_tool_results
    where run_id = '00000000-0000-4000-8000-00000000c911'),
  'a row expires within 14 days by default');

-- Cross-user negative: nobody's row in another person's conversation.
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_b'),
             '00000000-0000-4000-8000-00000000c911', 1, 'fit.profile', '{}', 'PUBLIC') $$,
  '23514', null, 'another user cannot own a row of this conversation');
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000c902', pg_temp.rls_id('user_b'),
             '00000000-0000-4000-8000-00000000c911', 2, 'fit.profile', '{}', 'PUBLIC') $$,
  '23514', null, 'a run cannot file its result in another person''s conversation');
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c912', 3, 'fit.profile', '{}', 'PUBLIC') $$,
  '23514', null, 'another person''s run cannot write into this conversation');

-- Bounds.
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c911', 4, 'x', '{}', 'RESTRICTED') $$,
  '23514', null, 'nothing above CONFIDENTIAL is kept');
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity, expires_at)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c911', 5, 'x', '{}', 'PUBLIC', now() + interval '400 days') $$,
  '23514', null, 'retention is bounded to 30 days');
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c911', 6, 'x',
             jsonb_build_object('blob', (select string_agg(md5(random()::text), '') from generate_series(1, 8000))), 'PUBLIC') $$,
  '23514', null, 'a result is size-bounded');
select throws_ok(
  $$ update q_runtime.conversation_tool_results set result = '{"score":10}'
      where run_id = '00000000-0000-4000-8000-00000000c911' $$,
  '23514', null, 'a kept result is never rewritten');
select lives_ok(
  $$ delete from q_runtime.conversation_tool_results where expires_at < now() + interval '15 days' $$,
  'the retention pass may delete expired rows');

-- No browser principal reaches a row, even their own.
select pg_temp.act_as_user_a();
select throws_ok(
  $$ select count(*) from q_runtime.conversation_tool_results $$,
  '42501', null, 'authenticated: the owner cannot read rows from a client');
select throws_ok(
  $$ insert into q_runtime.conversation_tool_results
       (tenant_id, conversation_id, user_id, run_id, call_index, tool_name, result, sensitivity)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000c901', pg_temp.rls_id('user_a'),
             '00000000-0000-4000-8000-00000000c911', 7, 'x', '{}', 'PUBLIC') $$,
  '42501', null, 'authenticated: nobody writes a row from a client');
select pg_temp.act_as_user_b();
select throws_ok(
  $$ select count(*) from q_runtime.conversation_tool_results $$,
  '42501', null, 'authenticated: another user reads nothing');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ select count(*) from q_runtime.conversation_tool_results $$,
  '42501', null, 'anon: denied');

select * from finish();
rollback;
