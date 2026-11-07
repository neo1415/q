-- Onboarding research as a durable job (onboarding plan §7, P1-4;
-- migration 20261231430000): the presence-research queue and its dead
-- letter exist, and no browser principal can send to or read them.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(5);

select is((select count(*)::int from pgmq.list_queues() where queue_name in ('presence-research', 'presence-research-dead')), 2,
  'the research queue and its dead letter exist');

select pg_temp.act_as_user_a();
select throws_ok($$ select pgmq.send('presence-research', '{}'::jsonb) $$, '42501', null, 'research queue: authenticated cannot send');
select throws_ok($$ select * from pgmq.read('presence-research', 1, 1) $$, '42501', null, 'research queue: authenticated cannot read');

select pg_temp.act_as_anonymous();
select throws_ok($$ select pgmq.send('presence-research', '{}'::jsonb) $$, '42501', null, 'research queue: anon cannot send');
select throws_ok($$ select * from pgmq.read('presence-research-dead', 1, 1) $$, '42501', null, 'research dead letter: anon cannot read');

select * from finish();

rollback;
