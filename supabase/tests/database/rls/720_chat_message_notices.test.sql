-- 20261201090000 · communication.notifications kind CHAT_MESSAGE (QA run
-- 8a1d57b9): the recipient of a new chat message gets one notice per
-- conversation. Server-written; the person reads only their own.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes the notice.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the worker decides who receives it).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(6);

select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, link_path, dedupe_key, priority)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'CHAT_MESSAGE',
             'Chat Capital sent you a message', '/relationships/investor/x/messages',
             'chat:00000000-0000-4000-8000-0000000072c1', 'NEEDS_YOU') $$,
  'a chat message notice is a known kind');
select lives_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'EMAIL_RECEIVED',
             'A new email', 'email:00000000-0000-4000-8000-0000000072e1') $$,
  'the inbound email kind stays allowed');
select throws_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'CHAT_TYPING',
             'Typing', 'typing:00000000-0000-4000-8000-0000000072c1') $$,
  '23514', null, 'an unknown kind is still refused');
select throws_ok(
  $$ insert into communication.notifications (tenant_id, user_id, kind, title, dedupe_key)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'CHAT_MESSAGE',
             'Again', 'chat:00000000-0000-4000-8000-0000000072c1') $$,
  '23505', null, 'one notice per conversation per person (the worker updates it)');

-- Positive: A reads their own; cross-tenant negative: B reads none of A's.
select pg_temp.act_as_user_a();
select is((select count(*)::int from communication.notifications where kind = 'CHAT_MESSAGE'), 1,
  'the recipient sees their chat notice');
select pg_temp.act_as_user_b();
select is((select count(*)::int from communication.notifications where kind = 'CHAT_MESSAGE'), 0,
  'another tenant''s person never sees it');

select * from finish();
rollback;
