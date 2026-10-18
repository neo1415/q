-- CQ-QX-008 · onboarding.responses withdrawal: an answer can be taken back
-- without deleting or editing it; the withdrawn row stays as history,
-- stops being current, is withdrawn once, and a later answer is a new row.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000005d0', 'external_investor_conversion', 'Withdrawal (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000005d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 49,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('d', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000005d1', 'avoid', 0, 'short_text', false, '{"prompt": "Rather not see?"}');
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000005e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000005d1', 'avoid');
insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
values ('00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005e1', 'avoid', 'TEXT',
        '{"type": "TEXT", "text": "adult content"}', 'adult content', 'TYPED_TEXT');

-- Withdrawn, not deleted -----------------------------------------------------------------
select lives_ok(
  $$ update onboarding.responses set withdrawn_at = clock_timestamp()
      where id = '00000000-0000-4000-8000-0000000005f1' $$,
  'the current answer can be withdrawn');
select is(
  (select count(*)::int from onboarding.responses where session_id = '00000000-0000-4000-8000-0000000005e1'),
  1, 'the withdrawn answer is still there as history');
select is(
  (select count(*)::int from onboarding.responses
    where session_id = '00000000-0000-4000-8000-0000000005e1'
      and superseded_by_response_id is null and withdrawn_at is null),
  0, 'and it is no longer current');

-- Once, and never edited -----------------------------------------------------------------
select throws_ok(
  $$ update onboarding.responses set withdrawn_at = clock_timestamp() + interval '1 minute'
      where id = '00000000-0000-4000-8000-0000000005f1' $$,
  '23514', 'an onboarding response is withdrawn exactly once',
  'a withdrawal is not re-dated');
select throws_ok(
  $$ update onboarding.responses set withdrawn_at = null
      where id = '00000000-0000-4000-8000-0000000005f1' $$,
  '23514', 'an onboarding response is withdrawn exactly once',
  'a withdrawal is not undone by editing');
select throws_ok(
  $$ delete from onboarding.responses where id = '00000000-0000-4000-8000-0000000005f1' $$,
  '23514', 'onboarding responses are history and cannot be deleted',
  'a withdrawn answer is not deleted');

-- A later answer is a new current row ----------------------------------------------------
select lives_ok(
  $$ insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
     values ('00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-0000000005e1', 'avoid', 'TEXT',
             '{"type": "TEXT", "text": "gambling"}', 'gambling', 'TYPED_TEXT') $$,
  'a new answer to the same step is a new row beside the withdrawn one');
select throws_ok(
  $$ insert into onboarding.responses (session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
     values ('00000000-0000-4000-8000-0000000005e1', 'avoid', 'TEXT',
             '{"type": "TEXT", "text": "tobacco"}', 'tobacco', 'TYPED_TEXT') $$,
  '23505', null, 'still one current answer per step');
select throws_ok(
  $$ update onboarding.responses set superseded_by_response_id = '00000000-0000-4000-8000-0000000005f2'
      where id = '00000000-0000-4000-8000-0000000005f1' $$,
  '23514', null, 'a withdrawn answer is not also superseded');

select * from finish();
rollback;
