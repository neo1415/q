-- Onboarding speed 2026-10-20 (D9) · onboarding.interview_readings: which
-- steps each interview sentence stated, kept so a restart or another q-api
-- instance cannot lose it. Append-only, constrained, idempotent per
-- exchange, and server-only (no browser principal reads anyone's, their
-- own included; the API projects it after checking session ownership).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(13);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000009d0', 'external_investor_conversion', 'Interview readings (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000009d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 49,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('d', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000009d1', 'intent', 0, 'short_text', true, '{"prompt": "What brings you here?"}');

insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000009e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000009d1', 'intent');

-- Positive ----------------------------------------------------------------------------
select lives_ok(
  $$ insert into onboarding.interview_readings (id, session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009f1', '00000000-0000-4000-8000-0000000009e1',
             '00000000-0000-4000-8000-0000000009a1', array['F1.stage', 'F1.country']) $$,
  'what a sentence stated is recorded');

-- Idempotency --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a1', array['F1.stage']) $$,
  '23505', null, 'one reading per exchange');
select is(
  (select count(*)::int from onboarding.interview_readings where session_id = '00000000-0000-4000-8000-0000000009e1'),
  1, 'the retried append wrote nothing');

-- Constraints --------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a2', array[]::text[]) $$,
  '23514', null, 'a reading names at least one step');
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a3',
             array(select 'F1.k' || g from generate_series(1, 41) g)) $$,
  '23514', null, 'a reading is bounded to 40 steps');
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a4', array['not a key!']) $$,
  '23514', null, 'each entry is a stable step key');
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a5', array['F1.stage', null]) $$,
  '23514', null, 'no empty entries');
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e9', '00000000-0000-4000-8000-0000000009a6', array['F1.stage']) $$,
  '23503', null, 'a reading belongs to a real session');

-- Append-only --------------------------------------------------------------------------
select throws_ok(
  $$ update onboarding.interview_readings set stated_step_keys = array['F6.raising'] where id = '00000000-0000-4000-8000-0000000009f1' $$,
  '23001', null, 'a reading cannot be rewritten');
select throws_ok(
  $$ delete from onboarding.interview_readings where id = '00000000-0000-4000-8000-0000000009f1' $$,
  '23001', null, 'a reading cannot be deleted');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.interview_readings $$, '42501', null,
  'browser user A cannot read the raw readings, even their own');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from onboarding.interview_readings where session_id = '00000000-0000-4000-8000-0000000009e1' $$, '42501', null,
  'another person cannot read user A''s readings');
select pg_temp.act_as_anonymous();
select throws_ok(
  $$ insert into onboarding.interview_readings (session_id, turn_ref, stated_step_keys)
     values ('00000000-0000-4000-8000-0000000009e1', '00000000-0000-4000-8000-0000000009a7', array['F1.stage']) $$,
  '42501', null, 'anonymous denied');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
