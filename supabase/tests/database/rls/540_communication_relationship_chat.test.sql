-- R34 · communication.conversations, communication.messages,
-- communication.read_receipts.
--
-- Only active members of a relationship's two party organisations read its
-- thread; never another tenant's thread, never after membership is revoked,
-- never anonymously. No client writes. Messages are append-only for every
-- role, including the privileged server role.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the server also requires a CONNECTED relationship).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(26);

-- Company A (tenant A) ↔ investor B (tenant B); company R (tenant R, whose
-- only member is revoked) ↔ investor B.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000008c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Chat Co A', 'chat-co-a'),
  ('00000000-0000-4000-8000-0000000008c2', pg_temp.rls_id('tenant_r'), pg_temp.rls_id('org_r'), 'Chat Co R', 'chat-co-r');
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000008e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Chat Capital B');
insert into network.relationships (id, tenant_id, company_id, investor_organisation_id) values
  ('00000000-0000-4000-8000-000000008b01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000008c1', '00000000-0000-4000-8000-0000000008e2'),
  ('00000000-0000-4000-8000-000000008b02', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-0000000008c2', '00000000-0000-4000-8000-0000000008e2');
insert into communication.conversations (id, tenant_id, relationship_id) values
  ('00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008b01');
insert into communication.messages (id, tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key) values
  ('00000000-0000-4000-8000-000000008d01', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'Hello from A', 'fixture-a-0001'),
  ('00000000-0000-4000-8000-000000008d02', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_b'), 'INVESTOR', 'TEXT', 'Hello from B', 'fixture-b-0001');
insert into communication.read_receipts (conversation_id, tenant_id, user_id, last_read_message_id) values
  ('00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_b'), '00000000-0000-4000-8000-000000008d01');

-- Shape ------------------------------------------------------------------------
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'communication.conversations'::regclass, 'communication.messages'::regclass,
  'communication.read_receipts'::regclass)), true, 'row level security is on for every table');
select ok(not has_table_privilege('authenticated', 'communication.messages', 'insert'),
  'no client role may insert a message');
select ok(not has_table_privilege('anon', 'communication.messages', 'select'),
  'the anonymous role has no grant on messages');

-- Constraints ------------------------------------------------------------------
select throws_ok(
  $$ insert into communication.conversations (tenant_id, relationship_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008b01') $$,
  '23505', null, 'one thread per canonical relationship');
select throws_ok(
  $$ insert into communication.conversations (tenant_id, relationship_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008b02') $$,
  '23503', null, 'a thread belongs to its relationship''s tenant');

insert into communication.conversations (id, tenant_id, relationship_id) values
  ('00000000-0000-4000-8000-000000008f02', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000008b02');
insert into communication.messages (id, tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key) values
  ('00000000-0000-4000-8000-000000008d03', pg_temp.rls_id('tenant_r'), '00000000-0000-4000-8000-000000008f02', pg_temp.rls_id('user_b'), 'INVESTOR', 'TEXT', 'B to R only', 'fixture-b-0002');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'fixture-a-0002') $$,
  '23514', null, 'a text message has a body');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'again', 'fixture-a-0001') $$,
  '23505', null, 'one message per sender idempotency key');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'ATTACHMENT', 'fixture-a-0003') $$,
  '23514', null, 'an attachment names a document');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, revises_message_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TOMBSTONE',
             '00000000-0000-4000-8000-000000008d02', 'fixture-a-0004') $$,
  '23514', null, 'nobody may unsend the other side''s message');
select lives_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, revises_message_id, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'EDIT', 'Hello from A (edited)',
             '00000000-0000-4000-8000-000000008d01', 'fixture-a-0005') $$,
  'an edit is a new row revising the sender''s own original');
select throws_ok(
  $$ update communication.messages set body = 'rewritten' where id = '00000000-0000-4000-8000-000000008d01' $$,
  '55000', null, 'even the server role cannot overwrite a message');
select throws_ok(
  $$ delete from communication.messages where id = '00000000-0000-4000-8000-000000008d01' $$,
  '55000', null, 'even the server role cannot delete a message');

-- Privileged server role -----------------------------------------------------------
select is((select count(*)::int from communication.messages), 4, 'the server role reads every message');

-- Positive: A (company side) reads its own thread ------------------------------------
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.conversations), 1, 'user A sees exactly one thread');
select is((select count(*)::int from communication.messages), 3, 'user A reads both sides of their thread, with the edit');
select is((select count(*)::int from communication.read_receipts), 1, 'user A sees the other side''s read cursor');

-- Cross-tenant negative: A never sees B↔R -------------------------------------------
select is((select count(*)::int from communication.messages where conversation_id = '00000000-0000-4000-8000-000000008f02'), 0,
  'user A cannot read a thread they are not a party to');
select ok(not private.is_conversation_party('00000000-0000-4000-8000-000000008f02'),
  'the party predicate says no for a non-party');
select throws_ok(
  $$ insert into communication.messages (tenant_id, conversation_id, sender_user_id, sender_side, kind, body, idempotency_key)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000008f01', pg_temp.rls_id('user_a'), 'COMPANY', 'TEXT', 'direct', 'fixture-a-0006') $$,
  '42501', null, 'user A cannot write a message directly');
select throws_ok(
  $$ update communication.read_receipts set last_read_at = now() $$,
  '42501', null, 'user A cannot move a read cursor directly');

-- Positive: B (investor side) reads both of its threads -------------------------------
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.conversations), 2, 'user B sees both of its organisation''s threads');
select is((select count(*)::int from communication.messages), 4, 'user B reads every message on its threads');

-- Revoked membership -----------------------------------------------------------------
select pg_temp.act_as_revoked_user();
select is((select count(*)::int from communication.conversations), 0,
  'a person whose membership was revoked sees no thread, not even their organisation''s');
select is((select count(*)::int from communication.messages), 0,
  'and no message');

-- Anonymous --------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from communication.messages $$, '42501', null,
  'an anonymous visitor cannot read messages');
select throws_ok($$ select count(*) from communication.conversations $$, '42501', null,
  'an anonymous visitor cannot read threads');

select * from finish();
rollback;
