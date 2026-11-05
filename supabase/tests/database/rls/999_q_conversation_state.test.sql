-- Q intelligence step 2 · q_runtime.conversation_states,
-- q_runtime.conversation_summary_revisions.
--
-- personal_private. The conversation's owner (an active member of its
-- tenant) reads their own state and summaries; nobody else does, in any
-- tenant; a revoked member reads nothing; nobody in a browser writes; a
-- state is never filed under someone other than the conversation's owner
-- and never moves to another; its version moves by one; summary revisions
-- come in order and are never rewritten.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(28);

-- Shape ------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'q_runtime' and c.relname in ('conversation_states', 'conversation_summary_revisions')
      and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity),
  2, 'both tables have RLS on and forced');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime'
     and tablename in ('conversation_states', 'conversation_summary_revisions')
     and cmd = 'SELECT' and qual like '%current_app_user_id%is_tenant_member%'),
  2, 'each has the owner''s-rows select policy');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime'
     and tablename in ('conversation_states', 'conversation_summary_revisions') and cmd <> 'SELECT'),
  0, 'no client write policy on either');
select ok(
  not has_table_privilege('authenticated', 'q_runtime.conversation_states', 'INSERT')
  and not has_table_privilege('authenticated', 'q_runtime.conversation_states', 'UPDATE')
  and not has_table_privilege('authenticated', 'q_runtime.conversation_summary_revisions', 'INSERT'),
  'browsers are granted no writes');
select ok(
  not has_table_privilege('service_role', 'q_runtime.conversation_summary_revisions', 'UPDATE')
  and not has_table_privilege('service_role', 'q_runtime.conversation_summary_revisions', 'DELETE')
  and not has_table_privilege('service_role', 'q_runtime.conversation_states', 'DELETE'),
  'no role rewrites a summary or deletes state directly');

-- Rows -------------------------------------------------------------------------
insert into q_runtime.conversations (id, tenant_id, user_id, context_type) values
  ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'PERSONAL'),
  ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'PERSONAL'),
  ('00000000-0000-4000-8000-00000000f103', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'PERSONAL');

select lives_ok(
  $$ insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, ledger, builder_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '{"entities": [{"ref": "E1", "kind": "COMPANY", "name": "Silo Credit"}], "lists": []}'::jsonb,
             'ledger-v1') $$,
  'the owner''s state is written by the server');
insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, builder_version) values
  ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ledger-v1'),
  ('00000000-0000-4000-8000-00000000f103', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('user_r'), 'ledger-v1');
insert into q_runtime.conversation_summary_revisions
  (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version) values
  ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1,
   'They asked about Silo Credit''s CFO.', now(), 4, 'summary-gate-v1'),
  ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 1,
   'B''s own summary.', now(), 2, 'summary-gate-v1');

-- Integrity --------------------------------------------------------------------
select throws_ok(
  $$ insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, builder_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'ledger-v1') $$,
  '23505', null, 'one state per conversation');
select throws_ok(
  $$ insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, builder_version)
     values ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'), 'ledger-v1') $$,
  '23514', null, 'a state is never filed under someone other than the conversation''s owner');
select throws_ok(
  $$ insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, builder_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'ledger-v1') $$,
  '23514', null, 'nor under a conversation in another tenant');
select throws_ok(
  $$ insert into q_runtime.conversation_states (conversation_id, tenant_id, user_id, ledger, builder_version)
     values ('00000000-0000-4000-8000-00000000f9ff', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             '[]'::jsonb, 'ledger-v1') $$,
  '23514', null, 'the ledger is an object');
select lives_ok(
  $$ update q_runtime.conversation_states set ledger = '{"entities": [], "lists": []}'::jsonb, version = 2,
       through_message_at = now(), through_message_id = '00000000-0000-4000-8000-00000000f9a1', messages_folded = 6
     where conversation_id = '00000000-0000-4000-8000-00000000f101' $$,
  'a fold moves the state to the next version');
select throws_ok(
  $$ update q_runtime.conversation_states set version = 2
     where conversation_id = '00000000-0000-4000-8000-00000000f101' $$,
  '23514', null, 'a stale writer (same version) is refused');
select throws_ok(
  $$ update q_runtime.conversation_states set user_id = pg_temp.rls_id('user_b'), version = 3
     where conversation_id = '00000000-0000-4000-8000-00000000f101' $$,
  '23514', null, 'a state never moves to another person');
select throws_ok(
  $$ update q_runtime.conversation_states set through_message_id = null, version = 3
     where conversation_id = '00000000-0000-4000-8000-00000000f101' $$,
  '23514', null, 'what it covers is a message and its time together');
select throws_ok(
  $$ insert into q_runtime.conversation_summary_revisions
       (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 3,
             'Skipped a revision.', now(), 6, 'summary-gate-v1') $$,
  '23514', null, 'revisions come in order: no skipping');
select throws_ok(
  $$ insert into q_runtime.conversation_summary_revisions
       (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 1,
             'A second revision 1.', now(), 6, 'summary-gate-v1') $$,
  '23514', null, 'and no second revision 1');
select lives_ok(
  $$ insert into q_runtime.conversation_summary_revisions
       (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 2,
             'Correction kept: Ledgerline meant Ledgerfold.', now(), 8, 'summary-gate-v1') $$,
  'a correction is the next revision, and the first stays');
select throws_ok(
  $$ insert into q_runtime.conversation_summary_revisions
       (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version)
     values ('00000000-0000-4000-8000-00000000f102', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_a'), 2,
             'Filed under B''s conversation.', now(), 3, 'summary-gate-v1') $$,
  '23514', null, 'a summary is never filed under someone else''s conversation');
select throws_ok(
  $$ update q_runtime.conversation_summary_revisions set summary = 'Rewritten.' $$,
  '23514', null, 'a summary revision is never rewritten');
select throws_ok(
  $$ insert into q_runtime.conversation_summary_revisions
       (conversation_id, tenant_id, user_id, revision, summary, covers_through_at, covered_messages, gate_version)
     values ('00000000-0000-4000-8000-00000000f101', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 3,
             '', now(), 8, 'summary-gate-v1') $$,
  '23514', null, 'an empty summary is no revision');

-- RLS: closed to browsers by schema ---------------------------------------------
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.conversation_states $$, '42501', null,
  'a browser session cannot reach the state tables');

-- The policy itself, with schema usage opened inside this transaction only.
select pg_temp.act_as_privileged();
grant usage on schema q_runtime to authenticated;

select pg_temp.act_as_user_a();
select is((select count(*)::int from q_runtime.conversation_states), 1, 'the owner reads their own state');
select is((select count(*)::int from q_runtime.conversation_summary_revisions), 2,
  'and every revision of their summary');
select throws_ok(
  $$ update q_runtime.conversation_states set version = version + 1 $$,
  '42501', null, 'the state is written by the server, not the browser');

select pg_temp.act_as_user_b();
select is((select count(*)::int from q_runtime.conversation_states
            where conversation_id = '00000000-0000-4000-8000-00000000f101'), 0,
  'another tenant''s person reads none of A''s state');
select is((select count(*)::int from q_runtime.conversation_summary_revisions
            where conversation_id = '00000000-0000-4000-8000-00000000f101'), 0,
  'nor A''s summaries');

select pg_temp.act_as_revoked_user();
select is((select count(*)::int from q_runtime.conversation_states), 0,
  'a revoked member reads nothing, their own state included');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.conversation_states), 3,
  'the privileged server role reads every row');

select * from finish();
rollback;
