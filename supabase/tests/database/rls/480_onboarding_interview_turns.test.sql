-- CQ-QX-006 · onboarding.interview_turns: the interview thread is
-- append-only, constrained, idempotent per exchange reference and role,
-- and server-only (no browser principal reads anyone's thread, their own
-- included; the API projects it after checking session ownership).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(15);

-- A synthetic journey on the one journey type without a production
-- definition (as 230); the version number stays clear of any publisher.
insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000004d0', 'external_investor_conversion', 'Interview (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000004d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 48,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('c', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000004d1', 'intent', 0, 'short_text', true, '{"prompt": "What brings you here?"}');

insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000004e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000004d1', 'intent');

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into onboarding.interview_turns (id, session_id, role, text, step_key, channel, turn_ref)
     values ('00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004e1', 'PERSON', 'We are raising a seed round.', 'intent', 'TEXT',
             '00000000-0000-4000-8000-0000000004a1') $$,
  'the person''s turn is recorded');
select lives_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, step_key, channel, turn_ref)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', 'Thanks. How much are you raising?', 'intent', 'TEXT',
             '00000000-0000-4000-8000-0000000004a1') $$,
  'Q''s reply shares the exchange reference under its own role');
select lives_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', 'Hello again.', 'VOICE') $$,
  'a turn without a reference or step is allowed');

-- Idempotency --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel, turn_ref)
     values ('00000000-0000-4000-8000-0000000004e1', 'PERSON', 'We are raising a seed round.', 'TEXT',
             '00000000-0000-4000-8000-0000000004a1') $$,
  '23505', null, 'one row per exchange reference and role');
select is(
  (select count(*)::int from onboarding.interview_turns where session_id = '00000000-0000-4000-8000-0000000004e1'),
  3, 'the retried append wrote nothing');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'SYSTEM', 'x', 'TEXT') $$,
  '23514', null, 'role vocabulary is closed');
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', 'x', 'VIDEO') $$,
  '23514', null, 'channel vocabulary is closed');
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', '', 'TEXT') $$,
  '23514', null, 'a turn has text');
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', repeat('a', 4001), 'TEXT') $$,
  '23514', null, 'a turn is bounded to 4000 characters');
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, step_key, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'Q', 'x', 'not a key!', 'TEXT') $$,
  '23514', null, 'a step key is a stable key');

-- Append-only --------------------------------------------------------------------------
select throws_ok(
  $$ update onboarding.interview_turns set text = 'We are raising a Series A.' where id = '00000000-0000-4000-8000-0000000004f1' $$,
  '23001', null, 'a turn cannot be rewritten');
select throws_ok(
  $$ delete from onboarding.interview_turns where id = '00000000-0000-4000-8000-0000000004f1' $$,
  '23001', null, 'a turn cannot be deleted');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.interview_turns $$, '42501', null,
  'browser user A cannot read the raw thread, even their own');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from onboarding.interview_turns where session_id = '00000000-0000-4000-8000-0000000004e1' $$, '42501', null,
  'another person cannot read user A''s thread');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into onboarding.interview_turns (session_id, role, text, channel)
     values ('00000000-0000-4000-8000-0000000004e1', 'PERSON', 'x', 'TEXT') $$,
  '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
