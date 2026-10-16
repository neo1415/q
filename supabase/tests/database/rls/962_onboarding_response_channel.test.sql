-- Lane ob1 · onboarding.responses.channel: the surface an answer was given
-- in (FORM or CONVERSATION) is a closed vocabulary, optional for older
-- answers, and as immutable as the rest of the response.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role writes these rows.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(6);

insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000962d0', 'external_investor_conversion', 'Channel (test)')
on conflict (journey_type) do nothing;
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000962d1', (select id from onboarding.definitions where journey_type = 'external_investor_conversion'), 62,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('e', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000962d1', 'stage', 0, 'short_text', false, '{"prompt": "Stage?"}'),
       ('00000000-0000-4000-8000-0000000962d1', 'name', 1, 'short_text', false, '{"prompt": "Name?"}');
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000962e1', pg_temp.rls_id('user_a'), 'external_investor_conversion', '00000000-0000-4000-8000-0000000962d1', 'stage');

select lives_ok(
  $$ insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality, channel)
     values ('00000000-0000-4000-8000-0000000962f1', '00000000-0000-4000-8000-0000000962e1', 'stage', 'TEXT',
             '{"type": "TEXT", "text": "seed"}', 'seed', 'TYPED_TEXT', 'CONVERSATION') $$,
  'an answer given in the conversation says so');
select lives_ok(
  $$ insert into onboarding.responses (session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
     values ('00000000-0000-4000-8000-0000000962e1', 'name', 'TEXT',
             '{"type": "TEXT", "text": "Harbourline"}', 'Harbourline', 'TYPED_TEXT') $$,
  'an older client may leave it unsaid');
select is(
  (select channel from onboarding.responses where step_key = 'name' and session_id = '00000000-0000-4000-8000-0000000962e1'),
  null, 'unsaid stays unknown, never guessed');
select throws_ok(
  $$ insert into onboarding.responses (session_id, step_key, response_type, response_jsonb, raw_text, source_modality, channel)
     values ('00000000-0000-4000-8000-0000000962e1', 'stage', 'TEXT', '{"type": "TEXT", "text": "x"}', 'x', 'TYPED_TEXT', 'EMAIL') $$,
  '23514', null, 'the channel vocabulary is closed');
select throws_ok(
  $$ update onboarding.responses set channel = 'FORM' where id = '00000000-0000-4000-8000-0000000962f1' $$,
  '23514', 'onboarding response content is immutable',
  'the channel cannot be rewritten');
select pg_temp.act_as_user_a();
select throws_ok($$ select channel from onboarding.responses $$, '42501', null,
  'browser users cannot read raw responses');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
