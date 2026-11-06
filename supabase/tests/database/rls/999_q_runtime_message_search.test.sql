-- Q intelligence step 9 · search over a person's own past Q turns.
--
-- One additive expression index on q_runtime.conversation_messages; the
-- table's visibility is unchanged: RLS on, no policies, no client grants,
-- so no browser principal (own tenant, other tenant, revoked) reads a
-- row. The Q API's owner-scoped search (tenant and owner from the actor,
-- archived conversations and marked lines left out) finds the owner's own
-- words and nobody else's, in any tenant.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION. The search below is the Q API's own query shape.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

-- Shape ------------------------------------------------------------------------
select is(
  (select count(*)::int from pg_indexes
    where schemaname = 'q_runtime' and tablename = 'conversation_messages'
      and indexname = 'conversation_messages_content_search_idx'
      and indexdef like '%USING gin%to_tsvector(''english''::regconfig, content)%'),
  1, 'the search index exists, over the content, english');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'q_runtime' and c.relname = 'conversation_messages'),
  'conversation_messages keeps RLS on');
select is(
  (select count(*)::int from pg_policies where schemaname = 'q_runtime' and tablename = 'conversation_messages'),
  0, 'conversation_messages still has no policy');
select ok(
  not has_table_privilege('authenticated', 'q_runtime.conversation_messages', 'SELECT')
  and not has_table_privilege('anon', 'q_runtime.conversation_messages', 'SELECT'),
  'no browser role has a read grant');

-- Fixture: the same words in two tenants, plus an archived conversation and a
-- marked line of the owner's own.
insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type, archived_at) values
  ('00000000-0000-4000-8000-00000000e901', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'PERSONAL', null),
  ('00000000-0000-4000-8000-00000000e902', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'PERSONAL', null),
  ('00000000-0000-4000-8000-00000000e903', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'PERSONAL', now());
insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values
  ('00000000-0000-4000-8000-00000000e911', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null,
   '00000000-0000-4000-8000-00000000e901', 'pass', 'ANSWER', 'MODERATE', 'cor_00000000-0000-4000-8000-00000000e911'),
  ('00000000-0000-4000-8000-00000000e912', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null,
   '00000000-0000-4000-8000-00000000e902', 'pass', 'ANSWER', 'MODERATE', 'cor_00000000-0000-4000-8000-00000000e912'),
  ('00000000-0000-4000-8000-00000000e913', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null,
   '00000000-0000-4000-8000-00000000e903', 'pass', 'ANSWER', 'MODERATE', 'cor_00000000-0000-4000-8000-00000000e913');
insert into q_runtime.conversation_messages (id, tenant_id, conversation_id, run_id, role, content) values
  ('00000000-0000-4000-8000-00000000e921', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e901',
   '00000000-0000-4000-8000-00000000e911', 'USER', 'I am going to pass on Ledgerline: the runway is too short for us.'),
  ('00000000-0000-4000-8000-00000000e922', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e901',
   '00000000-0000-4000-8000-00000000e911', 'USER', 'Ledgerline marked line: never read back.'),
  ('00000000-0000-4000-8000-00000000e923', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000e902',
   '00000000-0000-4000-8000-00000000e912', 'USER', 'TENANT_B_SECRET: we pass on Ledgerline, runway too short.'),
  ('00000000-0000-4000-8000-00000000e924', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e903',
   '00000000-0000-4000-8000-00000000e913', 'USER', 'ARCHIVED_LINE: Ledgerline runway.');
insert into q_runtime.conversation_message_marks (tenant_id, conversation_id, message_id, mark, marked_by) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e901',
   '00000000-0000-4000-8000-00000000e922', 'HIDDEN_BY_PERSON', 'PERSON');

-- The Q API's owner-scoped search, as a function of (tenant, owner, words).
create function pg_temp.search(p_tenant uuid, p_user uuid, p_text text) returns table (id uuid)
language sql stable as $$
  with q as (
    select nullif(array_to_string(array(
             select quote_literal(lexeme)
               from unnest(tsvector_to_array(to_tsvector('english', p_text))) as lexeme
           ), ' | '), '')::tsquery as query
  )
  select m.id
    from q_runtime.conversation_messages m
    join q_runtime.conversations c
      on c.id = m.conversation_id and c.tenant_id = m.tenant_id
   cross join q
   where q.query is not null
     and m.tenant_id = p_tenant
     and c.tenant_id = p_tenant
     and c.user_id = p_user
     and c.archived_at is null
     and to_tsvector('english', m.content) @@ q.query
     and not exists (select 1 from q_runtime.conversation_message_marks k
                      where k.message_id = m.id and k.tenant_id = m.tenant_id)
   order by ts_rank_cd(to_tsvector('english', m.content), q.query) desc, m.created_at desc
$$;

-- Positive: the owner's own words.
select is(
  (select array_agg(id) from pg_temp.search(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'),
     'What did I decide about Ledgerline?')),
  array['00000000-0000-4000-8000-00000000e921']::uuid[],
  'the owner finds their own past turn');
-- Cross-tenant negative: tenant B's identical words never reach tenant A's owner.
select ok(
  not exists (select 1 from pg_temp.search(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'Ledgerline runway')
               where id = '00000000-0000-4000-8000-00000000e923'),
  'another tenant''s turn is never found');
-- Another person, scoped to a tenant that is not theirs: nothing.
select is(
  (select count(*)::int from pg_temp.search(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_b'), 'Ledgerline runway')),
  0, 'another person finds nothing in this owner''s tenant');
select is(
  (select array_agg(id) from pg_temp.search(pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'Ledgerline runway')),
  array['00000000-0000-4000-8000-00000000e923']::uuid[],
  'tenant B''s owner finds only their own');
select ok(
  not exists (select 1 from pg_temp.search(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'Ledgerline runway archived marked')
               where id in ('00000000-0000-4000-8000-00000000e922', '00000000-0000-4000-8000-00000000e924')),
  'archived conversations and marked lines are left out');
select is(
  (select count(*)::int from pg_temp.search(pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'the of and')),
  0, 'stop words alone match nothing, never everything');

-- Browser principals ---------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.conversation_messages $$,
  '42501', null, 'the owner''s browser session cannot read messages, even its own');
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from q_runtime.conversation_messages where to_tsvector('english', content) @@ 'ledgerlin'::tsquery $$,
  '42501', null, 'another tenant''s member cannot search them');
select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from q_runtime.conversation_messages $$,
  '42501', null, 'a revoked member cannot read them');
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.conversation_messages $$,
  '42501', null, 'anonymous cannot read them');

select * from finish();
rollback;
