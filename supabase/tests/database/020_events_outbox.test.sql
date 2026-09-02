-- CQ-DATA-003 · events.outbox, pgmq and the domain-events queue.
--
-- Structure, privileges and invariants only. Publication behaviour is
-- exercised by the eventing integration tests. Rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(24);

-- Structure -----------------------------------------------------------------

select has_extension('pgmq', 'pgmq extension is enabled');
select has_schema('events', 'events schema exists');
select has_table('events', 'outbox', 'events.outbox exists');
select hasnt_table('events', 'domain_events', 'no retained domain-event history table yet');
select hasnt_table('events', 'processed_events', 'no consumer dedupe table yet');

select ok(
  (select relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'events' and c.relname = 'outbox'),
  'RLS enabled on events.outbox');
select has_index('events', 'outbox', 'outbox_pending_idx', 'pending publication index exists');
select col_is_unique('events', 'outbox', 'event_id', 'event_id is unique');

-- Queue ---------------------------------------------------------------------

select results_eq(
  $$ select is_unlogged, is_partitioned from pgmq.meta where queue_name = 'domain-events' $$,
  $$ values (false, false) $$,
  'domain-events queue exists, is logged (durable) and unpartitioned');

-- Privileges ----------------------------------------------------------------

select ok(not has_schema_privilege('anon', 'events', 'usage'), 'anon has no usage on events');
select ok(not has_schema_privilege('authenticated', 'events', 'usage'), 'authenticated has no usage on events');
select ok(not has_schema_privilege('anon', 'pgmq', 'usage'), 'anon has no usage on pgmq');
select ok(not has_schema_privilege('authenticated', 'pgmq', 'usage'), 'authenticated has no usage on pgmq');
select ok(not has_function_privilege('anon', 'pgmq.send(text,jsonb)', 'execute'), 'anon cannot pgmq.send');
select ok(not has_function_privilege('authenticated', 'pgmq.send(text,jsonb)', 'execute'), 'authenticated cannot pgmq.send');
select ok(not has_function_privilege('authenticated', 'pgmq.read(text,integer,integer,jsonb)', 'execute'), 'authenticated cannot pgmq.read');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema in ('events', 'pgmq')),
  0, 'no client role holds any table privilege on events or pgmq');

-- Invariants (as owner) -----------------------------------------------------

select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload)
     values (gen_random_uuid(), 'test.fixture.created', 0, '{}'::jsonb) $$,
  '23514', null, 'event_version below 1 is rejected');
select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload)
     values (gen_random_uuid(), 'test.fixture.created', 1, '[]'::jsonb) $$,
  '23514', null, 'non-object payload is rejected');
select lives_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'test.fixture.created', 1, '{"id":"x"}'::jsonb) $$,
  'a well-formed outbox row inserts');
select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload)
     values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'test.fixture.created', 1, '{"id":"y"}'::jsonb) $$,
  '23505', null, 'duplicate event_id is rejected');

-- Client access ---------------------------------------------------------------

set local role authenticated;
select throws_ok($$ select * from events.outbox $$, '42501', null, 'authenticated cannot read the outbox');
select throws_ok(
  $$ insert into events.outbox (event_id, event_type, event_version, payload)
     values (gen_random_uuid(), 'test.fixture.created', 1, '{}'::jsonb) $$,
  '42501', null, 'authenticated cannot insert into the outbox');
reset role;

set local role anon;
select throws_ok($$ select * from events.outbox $$, '42501', null, 'anon cannot read the outbox');
reset role;

select * from finish();

rollback;
