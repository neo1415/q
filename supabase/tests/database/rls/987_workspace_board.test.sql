-- Work board (owner 2026-10-23) · workspace.board_items and
-- workspace.board_item_events: the person's own board, server-only.
-- Constrained, one revision per change, identity and pointer immutable,
-- history append-only, a linked Q job only ever the same person's, and no
-- browser principal reads or writes any of it (their own rows included;
-- the API projects them after resolving the actor).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(28);

insert into q_runtime.workforce_jobs (id, tenant_id, user_id, source_kind, goal, rubric_version) values
  ('00000000-0000-4000-8000-000000000ba1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'JOB', 'Research the market for item one', 'rubric.v1'),
  ('00000000-0000-4000-8000-000000000bb1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'JOB', 'Someone else''s job', 'rubric.v1');

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into workspace.board_items (id, tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values ('00000000-0000-4000-8000-000000000b01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'TASK', 'Hire a head of sales', 1000, 'PERSON', '00000000-0000-4000-8000-000000000c01') $$,
  'the person keeps a task on their board');
select lives_ok(
  $$ insert into workspace.board_items (id, tenant_id, user_id, kind, ref_id, title, position, created_by, idempotency_key)
     values ('00000000-0000-4000-8000-000000000b02', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
             'DOCUMENT', '00000000-0000-4000-8000-000000000d01', '12-month plan', 2000, 'Q', '00000000-0000-4000-8000-000000000c02') $$,
  'Q keeps a document on their board for them');
select is(
  (select (status, revision) from workspace.board_items where id = '00000000-0000-4000-8000-000000000b01'),
  row('TODO'::text, 1), 'a new item starts in TODO at revision 1');

-- Idempotency --------------------------------------------------------------------------
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'TASK', 'Hire a head of sales', 1000, 'PERSON',
             '00000000-0000-4000-8000-000000000c01') $$,
  '23505', null, 'a retried add writes nothing');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'DOCUMENT', 'No document', 1, 'Q', gen_random_uuid()) $$,
  '23514', null, 'a document item points at a document');
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'DEAL', 'Not a kind', 1, 'Q', gen_random_uuid()) $$,
  '23514', null, 'only the board''s kinds');
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, status, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'TASK', 'Bad column', 'BLOCKED', 1, 'Q', gen_random_uuid()) $$,
  '23514', null, 'only TODO, DOING and DONE');
select throws_ok(
  $$ insert into workspace.board_items (tenant_id, user_id, kind, title, position, created_by, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'TASK', '   ', 1, 'Q', gen_random_uuid()) $$,
  '23514', null, 'an item has a title');

-- One revision per change; identity and pointer never change ---------------------------
select lives_ok(
  $$ update workspace.board_items set status = 'DOING', revision = 2 where id = '00000000-0000-4000-8000-000000000b01' $$,
  'an item moves to DOING as its next revision');
select throws_ok(
  $$ update workspace.board_items set status = 'DONE', revision = 4 where id = '00000000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'a change is exactly the next revision');
select throws_ok(
  $$ update workspace.board_items set status = 'DONE' where id = '00000000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'a change without a revision is refused');
select throws_ok(
  $$ update workspace.board_items set kind = 'NOTE', revision = 3 where id = '00000000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'what an item is never changes');
select throws_ok(
  $$ update workspace.board_items set ref_id = 'another', revision = 2 where id = '00000000-0000-4000-8000-000000000b02' $$,
  '23514', null, 'what an item points at never changes');
select throws_ok(
  $$ update workspace.board_items set user_id = pg_temp.rls_id('user_b'), revision = 3 where id = '00000000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'an item never moves to another person');

-- History is append-only ---------------------------------------------------------------
select lives_ok(
  $$ insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor, from_status, to_status, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-000000000b01', 2, 'MOVED', 'PERSON',
             'TODO', 'DOING', '00000000-0000-4000-8000-000000000e01') $$,
  'the move is recorded');
select throws_ok(
  $$ insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-000000000b01', 2, 'EDITED', 'Q') $$,
  '23505', null, 'one event per revision');
select throws_ok(
  $$ insert into workspace.board_item_events (tenant_id, user_id, item_id, revision, action, actor)
     values (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-000000000b01', 3, 'EDITED', 'PERSON') $$,
  '23503', null, 'an event is filed only under its own owner''s item');
select throws_ok(
  $$ update workspace.board_item_events set actor = 'Q' where item_id = '00000000-0000-4000-8000-000000000b01' $$,
  '23514', null, 'history is never rewritten');

-- A linked Q job is the same person's --------------------------------------------------
select throws_ok(
  $$ update workspace.board_items set work_job_id = '00000000-0000-4000-8000-000000000bb1', revision = 3
     where id = '00000000-0000-4000-8000-000000000b01' $$,
  '23503', null, 'another person''s job cannot work on this item');
select lives_ok(
  $$ update workspace.board_items set work_job_id = '00000000-0000-4000-8000-000000000ba1', revision = 3
     where id = '00000000-0000-4000-8000-000000000b01' $$,
  'their own Q job works on the item');
delete from q_runtime.workforce_jobs where id = '00000000-0000-4000-8000-000000000ba1';
select is(
  (select (work_job_id, revision) from workspace.board_items where id = '00000000-0000-4000-8000-000000000b01'),
  row(null::uuid, 3), 'a job that goes leaves the item, unchanged otherwise');

-- Archived is final --------------------------------------------------------------------
select lives_ok(
  $$ update workspace.board_items set archived_at = now(), revision = 2 where id = '00000000-0000-4000-8000-000000000b02' $$,
  'an item is removed by archiving it');
select throws_ok(
  $$ update workspace.board_items set title = 'Back again', revision = 3 where id = '00000000-0000-4000-8000-000000000b02' $$,
  '23514', null, 'an archived item is not changed');

-- Exposure -----------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_policies where schemaname = 'workspace'), 0,
  'no policy: the schema is server-internal');
select pg_temp.act_as_user_a();
select throws_ok($$ select * from workspace.board_items $$, '42501', null,
  'browser user A cannot read the board tables, even their own items');
select throws_ok(
  $$ update workspace.board_items set status = 'DONE', revision = 4 where id = '00000000-0000-4000-8000-000000000b01' $$,
  '42501', null, 'browser user A cannot move an item directly');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from workspace.board_item_events $$, '42501', null,
  'another tenant''s person cannot read user A''s history');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select * from workspace.board_items $$, '42501', null,
  'a revoked member reads nothing');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
