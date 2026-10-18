-- RECOVERY F6 (20261220191000, audit F-D10): a duplex voice transcript has
-- a deletion path. An unlinked turn can be purged; a person's turns go with
-- the person; browsers still hold nothing.
begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(7);

select is(
  (select confdeltype::text from pg_constraint
    where conname = 'voice_line_turns_user_id_fkey'
      and conrelid = 'q_runtime.voice_line_turns'::regclass),
  'c', 'a person''s transcript is deleted with the person (on delete cascade)');
select is(
  (select confdeltype::text from pg_constraint
    where conname = 'voice_line_turns_tenant_id_fkey'
      and conrelid = 'q_runtime.voice_line_turns'::regclass),
  'r', 'the tenant FK still restricts: no cascade from a tenant');
select ok(
  exists (select 1 from pg_indexes where schemaname = 'q_runtime'
           and indexname = 'voice_line_turns_orphan_spoken_idx'),
  'unlinked turns are found by age through their own index');

insert into q_runtime.voice_line_turns
  (tenant_id, user_id, voice_session_id, conversation_id, role, content, routed, spoken_at)
values
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-896', null, 'USER', 'hello', 'model_only', now() - interval '40 days'),
  (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-896', null, 'Q', 'hi', 'model_only', now() - interval '1 day');

-- What the retention job runs (apps/workers/src/retention/voice-line-turns.ts).
select lives_ok($$
  delete from q_runtime.voice_line_turns
   where conversation_id is null and spoken_at < now() - interval '30 days' $$,
  'the service role can purge unlinked turns past retention');
select is(
  (select count(*)::int from q_runtime.voice_line_turns where voice_session_id = 'line-896'),
  1, 'only the turn past retention went');

set local role authenticated;
select throws_ok($$ delete from q_runtime.voice_line_turns $$,
  '42501', null, 'a browser principal still cannot delete transcript rows');
select throws_ok($$ select 1 from q_runtime.voice_line_turns $$,
  '42501', null, 'nor read them');
reset role;

select * from finish();
rollback;
