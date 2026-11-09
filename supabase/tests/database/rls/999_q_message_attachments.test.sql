-- D82 · the files a person's turn carried (q_runtime.conversation_messages
-- .attachments). Additive; the table's visibility is unchanged: RLS on, no
-- policies, no browser grants, so no browser principal (own tenant, other
-- tenant, revoked) reads a row, attachments included.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(10);

select has_column('q_runtime', 'conversation_messages', 'attachments',
  'the attachments column exists');
select col_is_null('q_runtime', 'conversation_messages', 'attachments',
  'it is nullable: a turn with nothing attached has none');
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

insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-00000000f901', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null, 'PERSONAL');
insert into q_runtime.runs
  (id, tenant_id, actor_user_id, actor_organisation_id, conversation_id, objective, capability, consequence_class, correlation_id)
values
  ('00000000-0000-4000-8000-00000000f911', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), null,
   '00000000-0000-4000-8000-00000000f901', 'attach', 'ANSWER', 'MODERATE', 'cor_00000000-0000-4000-8000-00000000f911');

-- Positive: a person's turn with one file.
select lives_ok($$
  insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content, attachments)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f901',
          '00000000-0000-4000-8000-00000000f911', 'USER', 'Whats this about?',
          '[{"documentId":"00000000-0000-4000-8000-00000000f9d1","title":"TERMS AND CONDITIONS"}]'::jsonb)
$$, 'a person''s turn records the file it carried');

-- Negative: Q's turn never carries attachments.
select throws_ok($$
  insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content, attachments)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f901',
          '00000000-0000-4000-8000-00000000f911', 'Q', 'It is a set of terms.',
          '[{"documentId":"00000000-0000-4000-8000-00000000f9d1","title":"T"}]'::jsonb)
$$, '23514', null, 'Q''s turn cannot carry attachments');

-- Negative: not an array, empty, or more than five.
select throws_ok($$
  insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content, attachments)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f901',
          '00000000-0000-4000-8000-00000000f911', 'USER', 'x', '{"documentId":"a"}'::jsonb)
$$, '23514', null, 'attachments must be an array');
select throws_ok($$
  insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content, attachments)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f901',
          '00000000-0000-4000-8000-00000000f911', 'USER', 'x', '[]'::jsonb)
$$, '23514', null, 'an empty list is stored as none, not []');
select throws_ok($$
  insert into q_runtime.conversation_messages (tenant_id, conversation_id, run_id, role, content, attachments)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000f901',
          '00000000-0000-4000-8000-00000000f911', 'USER', 'x',
          '[{"t":1},{"t":2},{"t":3},{"t":4},{"t":5},{"t":6}]'::jsonb)
$$, '23514', null, 'at most five files on one turn');

select * from finish();
rollback;
