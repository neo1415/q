-- CQ-QX-008 P0-2 · Q recommendations as onboarding suggestions: the
-- proposed payload never changes, a decision is made once, nothing is
-- deleted, one pending Q recommendation per step, and no browser principal
-- reads or writes them (server-only, like every journey-state table).
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(12);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000006d0', 'external_investor_conversion', 'Recommendations (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000006d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 50,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('e', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000006d1', 'avoid', 0, 'short_text', false, '{"prompt": "Rather not see?"}');
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000006e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000006d1', 'avoid');

select lives_ok(
  $$ insert into onboarding.suggestions (id, session_id, step_key, target_field, suggested_value, source_refs, rationale)
     values ('00000000-0000-4000-8000-0000000006f1', '00000000-0000-4000-8000-0000000006e1', 'avoid', 'avoid',
             '{"type": "TEXT", "text": "gambling"}', '[{"sourceType": "Q_RECOMMENDATION", "sourceId": "run-1"}]',
             'Least aligned with an education focus.') $$,
  'Q''s recommendation is stored with its reason');

-- The payload cannot move under an approval -------------------------------------------
select throws_ok(
  $$ update onboarding.suggestions set suggested_value = '{"type": "TEXT", "text": "tobacco"}'
      where id = '00000000-0000-4000-8000-0000000006f1' $$,
  '23514', 'an onboarding suggestion''s proposal is immutable', 'the proposed value is immutable');
select throws_ok(
  $$ update onboarding.suggestions set rationale = 'Something else.'
      where id = '00000000-0000-4000-8000-0000000006f1' $$,
  '23514', 'an onboarding suggestion''s proposal is immutable', 'the reason is immutable');
select throws_ok(
  $$ delete from onboarding.suggestions where id = '00000000-0000-4000-8000-0000000006f1' $$,
  '23514', 'onboarding suggestions are history and cannot be deleted', 'nothing is deleted');

-- One pending Q recommendation per step ---------------------------------------------------
select throws_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value, source_refs)
     values ('00000000-0000-4000-8000-0000000006e1', 'avoid', 'avoid',
             '{"type": "TEXT", "text": "weapons"}', '[{"sourceType": "Q_RECOMMENDATION", "sourceId": "run-2"}]') $$,
  '23505', null, 'a second pending Q recommendation for the step is refused');
select lives_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value, source_refs)
     values ('00000000-0000-4000-8000-0000000006e1', 'avoid', 'avoid',
             '{"type": "TEXT", "text": "from the deck"}', '[{"sourceType": "DOCUMENT", "sourceId": "doc-1"}]') $$,
  'a document proposal beside it is unaffected');

-- Decided once -------------------------------------------------------------------------
select lives_ok(
  $$ update onboarding.suggestions set status = 'EXPIRED', resolved_at = clock_timestamp()
      where id = '00000000-0000-4000-8000-0000000006f1' $$,
  'a pending recommendation can be superseded');
select throws_ok(
  $$ update onboarding.suggestions set status = 'ACCEPTED'
      where id = '00000000-0000-4000-8000-0000000006f1' $$,
  '23514', 'an onboarding suggestion is decided exactly once', 'a decided recommendation is not decided again');
select lives_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value, source_refs)
     values ('00000000-0000-4000-8000-0000000006e1', 'avoid', 'avoid',
             '{"type": "TEXT", "text": "weapons"}', '[{"sourceType": "Q_RECOMMENDATION", "sourceId": "run-2"}]') $$,
  'after it is superseded, a new one may be pending');

-- Server-only --------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from onboarding.suggestions $$, '42501', null,
  'the owner''s browser session cannot read suggestions directly');
select throws_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value)
     values ('00000000-0000-4000-8000-0000000006e1', 'avoid', 'avoid', '{"type": "TEXT", "text": "x"}') $$,
  '42501', null, 'nor write one');
select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from onboarding.suggestions $$, '42501', null,
  'another person cannot read them');
select pg_temp.act_as_privileged();

select * from finish();
rollback;
