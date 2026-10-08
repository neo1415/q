-- VOICE-BRAIN (20261220150000): the duplex voice line's transcript.
--
-- Both sides of the line with who answered each turn, owner-private and
-- server-only: no browser principal reads or writes a turn, its own
-- included. Closed vocabularies, bounded text, tenant-safe link to the
-- conversation, and the transcript leaves with its conversation.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role reads every turn.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the Q API writes a turn only as the person on
-- the line).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(14);

-- Fixtures ------------------------------------------------------------------------
insert into q_runtime.conversations (id, tenant_id, user_id, organisation_id, context_type) values
  ('00000000-0000-4000-8000-0000000086a1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), pg_temp.rls_id('org_a'), 'ORGANISATION'),
  ('00000000-0000-4000-8000-0000000086b1', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), null, 'PERSONAL');

-- Writing turns --------------------------------------------------------------------
select lives_ok(
  $$ insert into q_runtime.voice_line_turns
       (tenant_id, user_id, voice_session_id, conversation_id, role, content, routed, provider_ref, spoken_at)
     values
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'b623d495-dee0-4d99-9035-4b68adee3938',
        '00000000-0000-4000-8000-0000000086a1', 'USER', 'Open my pitch deck.', 'ask_q', 'item_abc', now()),
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'b623d495-dee0-4d99-9035-4b68adee3938',
        '00000000-0000-4000-8000-0000000086a1', 'Q', 'Here it is, on your screen.', 'ask_q', 'resp_abc', now()),
       (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('user_b'), 'line-b',
        null, 'USER', 'Thanks!', 'smalltalk', null, now()) $$,
  'the Q API records both sides of a line, before and after a conversation exists');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'SYSTEM', 'x', 'ask_q', now()) $$,
  '23514', null, 'only USER and Q speak on a line');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'USER', 'x', 'llm', now()) $$,
  '23514', null, 'routing is a closed vocabulary');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'USER', repeat('x', 2001), 'ask_q', now()) $$,
  '23514', null, 'a turn of the person is bounded');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'Q', '', 'ask_q', now()) $$,
  '23514', null, 'an empty turn is not a turn');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, provider_ref, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'Q', 'x', 'ask_q', '{"payload":1}', now()) $$,
  '23514', null, 'a provider reference is opaque, never a payload');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, conversation_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a',
             '00000000-0000-4000-8000-0000000086b1', 'USER', 'x', 'ask_q', now()) $$,
  '23503', null, 'a turn cannot link to another tenant''s conversation');

-- Browser principals -------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from q_runtime.voice_line_turns $$,
  '42501', null, 'anonymous cannot read a line');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from q_runtime.voice_line_turns $$,
  '42501', null, 'an authenticated browser session cannot read a line, even its own');
select throws_ok(
  $$ insert into q_runtime.voice_line_turns (tenant_id, user_id, voice_session_id, role, content, routed, spoken_at)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('user_a'), 'line-a', 'USER', 'x', 'ask_q', now()) $$,
  '42501', null, 'a browser session cannot write a turn');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from q_runtime.voice_line_turns $$,
  '42501', null, 'a revoked user reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_runtime.voice_line_turns), 3,
  'the privileged server role reads the lines; DB privilege is not business authorisation');
select is(
  (select string_agg(routed, ',' order by spoken_at, role desc) from q_runtime.voice_line_turns
    where voice_session_id = 'b623d495-dee0-4d99-9035-4b68adee3938'),
  'ask_q,ask_q', 'which turns went to Q is kept with the turn');

-- Retention follows the conversation -------------------------------------------------
delete from q_runtime.conversations where id = '00000000-0000-4000-8000-0000000086a1';
select is(
  (select count(*)::int from q_runtime.voice_line_turns where tenant_id = pg_temp.rls_id('tenant_a')),
  0, 'a conversation''s line transcript goes with it');

select * from finish();
rollback;
