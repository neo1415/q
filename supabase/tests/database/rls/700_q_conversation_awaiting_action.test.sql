-- 20261129090000 · q_runtime.conversations.awaiting_action: the declared
-- action a conversation waits on, server-written and taken once.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(5);

insert into q_runtime.conversations (id, tenant_id, user_id, context_type)
values ('00000000-0000-4000-8000-0000000070c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'PERSONAL');

select lives_ok(
  $$ update q_runtime.conversations
        set awaiting_action = '{"tool":"propose_reminder","arguments":{"title":"Review the deck"},"needs":"TIME_ZONE","at":1}'::jsonb
      where id = '00000000-0000-4000-8000-0000000070c1' $$,
  'the server keeps the action a conversation waits on');
select throws_ok(
  $$ update q_runtime.conversations set awaiting_action = '[1]'::jsonb
      where id = '00000000-0000-4000-8000-0000000070c1' $$,
  '23514', null, 'only an object');
create temp table taken on commit drop as
  with t as (
    update q_runtime.conversations c set awaiting_action = null
      from (select awaiting_action from q_runtime.conversations
             where id = '00000000-0000-4000-8000-0000000070c1' for update) before
     where c.id = '00000000-0000-4000-8000-0000000070c1'
    returning before.awaiting_action ->> 'tool' as tool)
  select tool from t;
select is((select tool from taken), 'propose_reminder',
  'taking it returns what was held');
select is(
  (select awaiting_action from q_runtime.conversations
    where id = '00000000-0000-4000-8000-0000000070c1'),
  null, 'and clears it: read once');
select is(
  (select count(*)::int from information_schema.column_privileges
    where table_schema = 'q_runtime' and table_name = 'conversations'
      and column_name = 'awaiting_action' and privilege_type in ('INSERT', 'UPDATE')
      and grantee in ('anon', 'authenticated', 'PUBLIC')),
  0, 'no client role may write it');

select * from finish();
rollback;
