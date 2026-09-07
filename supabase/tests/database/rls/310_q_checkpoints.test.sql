-- CQ-Q-003 · Q orchestration checkpoints: engine infrastructure under
-- q_runtime, never in `public`, never reachable by a browser principal, and
-- shaped exactly as the LangGraph PostgresSaver expects so that no runtime
-- call ever needs to create a table.
--
--   graph checkpoint ≠ Q institutional memory
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION AUTHORISATION IS STILL REQUIRED: a thread id is a run id and
-- grants nothing; the orchestrator authorises the actor against the
-- canonical run before touching any checkpoint.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

-- Shape the saver relies on -------------------------------------------------------
select has_table('q_runtime', 'checkpoints', 'checkpoints live under q_runtime');
select has_table('q_runtime', 'checkpoint_blobs', 'checkpoint blobs live under q_runtime');
select has_table('q_runtime', 'checkpoint_writes', 'checkpoint writes live under q_runtime');
select has_table('q_runtime', 'checkpoint_migrations', 'the saver''s migration ledger lives under q_runtime');
select hasnt_table('public', 'checkpoints', 'no checkpoint table is exposed through the public schema');
select hasnt_table('public', 'checkpoint_blobs', 'no checkpoint blob table is exposed through the public schema');
select col_is_pk('q_runtime', 'checkpoints', array['thread_id', 'checkpoint_ns', 'checkpoint_id'],
  'a checkpoint is identified by thread, namespace and id');
select col_is_pk('q_runtime', 'checkpoint_blobs', array['thread_id', 'checkpoint_ns', 'channel', 'version'],
  'a blob is identified by thread, namespace, channel and version');
select is((select max(v) from q_runtime.checkpoint_migrations), 4,
  'the saver ledger is seeded to the version this repository reproduces, so setup() has nothing to do');

-- A row can be written by the server ------------------------------------------------
insert into q_runtime.checkpoints (thread_id, checkpoint_id, checkpoint)
values ('00000000-0000-4000-8000-000000000a11', '1ef', '{"v": 1}'::jsonb);

-- Browser principals ------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.checkpoints $$,
  '42501', null, 'anonymous cannot read checkpoints');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.checkpoints $$,
  '42501', null, 'an authenticated browser session cannot read checkpoints');
select throws_ok($$ select count(*) from q_runtime.checkpoint_blobs $$,
  '42501', null, 'a browser cannot read checkpoint blobs');
select throws_ok(
  $$ insert into q_runtime.checkpoints (thread_id, checkpoint_id, checkpoint) values ('x', 'y', '{}'::jsonb) $$,
  '42501', null, 'a browser cannot write a checkpoint');
select throws_ok(
  $$ delete from q_runtime.checkpoints where thread_id = '00000000-0000-4000-8000-000000000a11' $$,
  '42501', null, 'a browser cannot delete a checkpoint');

select pg_temp.act_as_service_role();
select throws_ok($$ select count(*) from q_runtime.checkpoints $$,
  '42501', null, 'service_role holds no grant on checkpoints');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.checkpoints where thread_id = '00000000-0000-4000-8000-000000000a11'), 1,
  'the privileged server role reads checkpoints; DB privilege is not business authorisation');

select * from finish();
rollback;
