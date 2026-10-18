-- ADR 0012 · q_knowledge.memory_items: what Q remembers about a person,
-- server-internal, one live value per key per owner, never a browser row.
--
--   Q Memory ≠ Q Knowledge ≠ Audit History
--   a candidate ≠ a memory;  superseded is kept, never deleted
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- Shape ---------------------------------------------------------------------------
select has_table('q_knowledge', 'memory_items', 'the memory store exists');
select is((select count(*)::int from pg_policies
            where schemaname = 'q_knowledge' and tablename = 'memory_items'), 0,
  'no policy: server-internal, never browser-reachable');
select is((select relrowsecurity from pg_class where oid = 'q_knowledge.memory_items'::regclass), true,
  'RLS is enabled');
select is((select relforcerowsecurity from pg_class where oid = 'q_knowledge.memory_items'::regclass), true,
  'RLS is forced even for the table owner');

-- A remembered preference ----------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.memory_items
    (id, tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status)
  values ('00000000-0000-4000-8000-00000000e7e1', pg_temp.rls_id('tenant_a'), 'user',
          pg_temp.rls_id('user_a'), 'preference', 'preference.address_as',
          'Address them as Dan.', 'call me Dan', repeat('a', 64), 'Q_PROPOSED', 'active')
$$, 'a quote-verified, model-proposed preference is recorded as active');

-- One live value per key per owner -------------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'preference',
          'preference.address_as', 'Address them as Daniel.', 'call me Daniel',
          repeat('b', 64), 'Q_PROPOSED', 'active')
$$, '%memory_items_live_key_idx%',
  'a second live value for the same key and owner is refused by the index');

-- The same content is never remembered twice ---------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'fact',
          'person.other', 'Address them as Dan.', 'call me Dan',
          repeat('a', 64), 'Q_PROPOSED', 'active')
$$, '%memory_items_live_content_idx%',
  'the same content hash for the same owner is refused while live');

-- Supersession keeps history -------------------------------------------------------
select lives_ok($$
  update q_knowledge.memory_items
     set status = 'archived', valid_to = now()
   where id = '00000000-0000-4000-8000-00000000e7e1'
$$, 'the earlier value is retired first');
select lives_ok($$
  insert into q_knowledge.memory_items
    (id, tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, quote, content_sha256, write_mode, status)
  values ('00000000-0000-4000-8000-00000000e7e2', pg_temp.rls_id('tenant_a'), 'user',
          pg_temp.rls_id('user_a'), 'preference', 'preference.address_as',
          'Address them as Daniel.', 'call me Daniel', repeat('b', 64), 'Q_PROPOSED', 'active')
$$, 'a new value for the key lands once the earlier one is retired');
select lives_ok($$
  update q_knowledge.memory_items
     set status = 'superseded', superseded_by = '00000000-0000-4000-8000-00000000e7e2'
   where id = '00000000-0000-4000-8000-00000000e7e1'
$$, 'the retired row is marked superseded by the new one');
select throws_like($$
  update q_knowledge.memory_items set status = 'superseded', superseded_by = null
   where id = '00000000-0000-4000-8000-00000000e7e1'
$$, '%memory_items_superseded_check%',
  'superseded without a successor is refused');
select is((select count(*)::int from q_knowledge.memory_items
            where owner_context_id = pg_temp.rls_id('user_a')), 2,
  'history is kept: two rows, one live');

-- Shape constraints ----------------------------------------------------------------
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, memory_type, memory_key,
     content, content_sha256, write_mode, status)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'fact',
          'Not A Key', 'x', repeat('c', 64), 'Q_PROPOSED', 'active')
$$, '%memory_items_memory_key_check%', 'a memory key is lowercase and dotted');
select throws_like($$
  insert into q_knowledge.memory_items
    (tenant_id, owner_context_type, owner_context_id, subject_type, memory_type, memory_key,
     content, content_sha256, write_mode, status)
  values (pg_temp.rls_id('tenant_a'), 'user', pg_temp.rls_id('user_a'), 'COMPANY', 'fact',
          'company.customers', 'x', repeat('d', 64), 'Q_PROPOSED', 'active')
$$, '%memory_items_subject_check%', 'a subject type without a subject id is refused');

-- Browser roles ----------------------------------------------------------------------
set local role authenticated;
select throws_like($$ select * from q_knowledge.memory_items $$, '%permission denied%',
  'an authenticated browser role cannot read memory');
reset role;

select * from finish();
rollback;
