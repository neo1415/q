-- CQ-ONB-001 · onboarding runtime: published versions and steps frozen,
-- (fixtures use the investor journey: founder v1 is published by migration),
-- sessions user-owned with one-way binding and active-session uniqueness,
-- response history immutable with one current row per step, suggestions
-- constrained, idempotency hash-only, every table server-only.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(40);

-- Definitions ----------------------------------------------------------------------
insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000000d0', 'investor', 'Founder (test)');
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000d0', 1,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "COMPANY", "allowUnboundStart": true}}',
        repeat('a', 64));
insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
values ('00000000-0000-4000-8000-0000000000d1', 'intent', 0, 'single_select', true,
        '{"prompt": "Are you raising?", "options": [{"optionKey": "yes", "label": "Yes"}, {"optionKey": "no", "label": "No"}]}');

select throws_ok(
  $$ insert into onboarding.definitions (journey_type, name) values ('investor', 'Duplicate') $$,
  '23505', null, 'one canonical definition per journey type');
select throws_ok(
  $$ insert into onboarding.definition_versions (definition_id, version, schema, manifest_hash)
     values ('00000000-0000-4000-8000-0000000000d0', 1, '{"schemaVersion": 1}', repeat('b', 64)) $$,
  '23505', null, 'definition versions are unique per definition');
select throws_ok(
  $$ insert into onboarding.definition_versions (definition_id, version, schema, manifest_hash)
     values ('00000000-0000-4000-8000-0000000000d0', 0, '{"schemaVersion": 1}', repeat('b', 64)) $$,
  '23514', null, 'version must be >= 1');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, configuration)
     values ('00000000-0000-4000-8000-0000000000d1', 'intent', 1, 'short_text', '{"prompt": "x"}') $$,
  '23505', null, 'step keys are unique within a version');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, configuration)
     values ('00000000-0000-4000-8000-0000000000d1', 'other', 0, 'short_text', '{"prompt": "x"}') $$,
  '23505', null, 'sequence order is unique within a version');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, configuration)
     values ('00000000-0000-4000-8000-0000000000d1', 'stage', 2, 'company_stage_step', '{"prompt": "x"}') $$,
  '23514', null, 'step types are interaction semantics only');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, configuration, branching_expression)
     values ('00000000-0000-4000-8000-0000000000d1', 'b', 3, 'short_text', '{"prompt": "x"}', '"return true"') $$,
  '23514', null, 'a branching expression must be an object with an op, never code');

-- Publish, then everything about the version is frozen.
update onboarding.definition_versions set published_at = clock_timestamp() where id = '00000000-0000-4000-8000-0000000000d1';
update onboarding.definitions set current_version = 1 where id = '00000000-0000-4000-8000-0000000000d0';
select throws_ok(
  $$ update onboarding.definition_versions set schema = '{"schemaVersion": 1, "phases": [{"phaseKey": "x", "label": "X"}]}'
      where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'a published version schema cannot be changed');
select throws_ok(
  $$ delete from onboarding.definition_versions where id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'a published version cannot be deleted');
select throws_ok(
  $$ update onboarding.steps set required = false where definition_version_id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'steps of a published version cannot be changed');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, configuration)
     values ('00000000-0000-4000-8000-0000000000d1', 'late', 9, 'short_text', '{"prompt": "x"}') $$,
  '23514', null, 'steps cannot be added to a published version');
select throws_ok(
  $$ delete from onboarding.steps where definition_version_id = '00000000-0000-4000-8000-0000000000d1' $$,
  '23514', null, 'steps of a published version cannot be deleted');

-- Sessions -------------------------------------------------------------------------
insert into onboarding.sessions (id, user_id, journey_type, definition_version_id, current_step_key)
values ('00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('user_a'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent');
select is((select tenant_id from onboarding.sessions where id = '00000000-0000-4000-8000-0000000000e1'), null,
  'a bootstrap session has no tenant');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key)
     values (pg_temp.rls_id('user_a'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent') $$,
  '23505', null, 'at most one ACTIVE unbound session per user + journey');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key, subject_type)
     values (pg_temp.rls_id('user_b'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent', 'COMPANY') $$,
  '23514', null, 'subject_type without subject_id is rejected');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key, subject_id)
     values (pg_temp.rls_id('user_b'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent', '00000000-0000-4000-8000-0000000000c1') $$,
  '23514', null, 'subject_id without subject_type is rejected');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key, organisation_id)
     values (pg_temp.rls_id('user_b'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent', pg_temp.rls_id('org_b')) $$,
  '23514', null, 'an organisation without a tenant is rejected');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id)
     values (pg_temp.rls_id('user_b'), 'investor', '00000000-0000-4000-8000-0000000000d1') $$,
  '23514', null, 'an ACTIVE session must have a current step');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key, status)
     values (pg_temp.rls_id('user_b'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent', 'COMPLETED') $$,
  '23514', null, 'COMPLETED requires completed_at');

-- One-way binding.
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
values ('00000000-0000-4000-8000-0000000000c3', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Alpha', 'alpha-onb');
select lives_ok(
  $$ update onboarding.sessions
        set tenant_id = pg_temp.rls_id('tenant_a'), organisation_id = pg_temp.rls_id('org_a'),
            subject_type = 'COMPANY', subject_id = '00000000-0000-4000-8000-0000000000c3', version = version + 1
      where id = '00000000-0000-4000-8000-0000000000e1' $$,
  'an unbound session binds once to trusted context');
select lives_ok(
  $$ update onboarding.sessions
        set subject_type = 'COMPANY', subject_id = '00000000-0000-4000-8000-0000000000c3'
      where id = '00000000-0000-4000-8000-0000000000e1' $$,
  'rebinding to the same subject is idempotent');
select throws_ok(
  $$ update onboarding.sessions set subject_id = '00000000-0000-4000-8000-0000000000c1' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'a bound session cannot move to another subject');
select throws_ok(
  $$ update onboarding.sessions set organisation_id = pg_temp.rls_id('org_b'), tenant_id = pg_temp.rls_id('tenant_b') where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'a bound session cannot move to another organisation');
select throws_ok(
  $$ update onboarding.sessions set user_id = pg_temp.rls_id('user_b') where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'a session cannot change owner');
select throws_ok(
  $$ insert into onboarding.sessions (user_id, journey_type, definition_version_id, current_step_key, tenant_id, organisation_id, subject_type, subject_id)
     values (pg_temp.rls_id('user_a'), 'investor', '00000000-0000-4000-8000-0000000000d1', 'intent',
             pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c3') $$,
  '23505', null, 'at most one ACTIVE bound session per user + journey + subject');

-- Step states ----------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.step_states (session_id, step_key, status) values ('00000000-0000-4000-8000-0000000000e1', 'intent', 'COMPLETED') $$,
  '23514', null, 'COMPLETED requires completed_at');
select throws_ok(
  $$ insert into onboarding.step_states (session_id, step_key, status, skipped_at) values ('00000000-0000-4000-8000-0000000000e1', 'intent', 'DONE', now()) $$,
  '23514', null, 'step state vocabulary is closed');

-- Responses ------------------------------------------------------------------------
insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, source_modality)
values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-0000000000e1', 'intent', 'SINGLE_SELECT', '{"type": "SINGLE_SELECT", "optionKey": "yes"}', 'SELECTION');
select throws_ok(
  $$ insert into onboarding.responses (session_id, step_key, response_type, response_jsonb, source_modality)
     values ('00000000-0000-4000-8000-0000000000e1', 'intent', 'SINGLE_SELECT', '{"type": "SINGLE_SELECT", "optionKey": "no"}', 'SELECTION') $$,
  '23505', null, 'one current response per session + step');
select throws_ok(
  $$ update onboarding.responses set response_jsonb = '{"type": "SINGLE_SELECT", "optionKey": "no"}' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'response content is immutable');
select throws_ok(
  $$ delete from onboarding.responses where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'responses are history and cannot be deleted');
select throws_ok(
  $$ insert into onboarding.responses (session_id, step_key, response_type, response_jsonb, source_modality)
     values ('00000000-0000-4000-8000-0000000000e1', 'notes', 'TEXT', '{"type": "TEXT", "text": "hi"}', 'TYPED_TEXT') $$,
  '23514', null, 'a TEXT response carries its raw text');
insert into onboarding.responses (id, session_id, step_key, response_type, response_jsonb, source_modality)
values ('00000000-0000-4000-8000-0000000000f2', '00000000-0000-4000-8000-0000000000e1', 'other', 'SINGLE_SELECT', '{"type": "SINGLE_SELECT", "optionKey": "no"}', 'SELECTION');
select lives_ok(
  $$ update onboarding.responses set superseded_by_response_id = '00000000-0000-4000-8000-0000000000f2' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  'the forward link is the only permitted change');
select throws_ok(
  $$ update onboarding.responses set superseded_by_response_id = null where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'a response is superseded exactly once');

-- Suggestions ------------------------------------------------------------------------
select throws_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value, resolved_at)
     values ('00000000-0000-4000-8000-0000000000e1', 'intent', 'intent', '{"type": "SINGLE_SELECT", "optionKey": "yes"}', now()) $$,
  '23514', null, 'a PENDING suggestion has no resolved_at');
select throws_ok(
  $$ insert into onboarding.suggestions (session_id, step_key, target_field, suggested_value, confidence)
     values ('00000000-0000-4000-8000-0000000000e1', 'intent', 'intent', '{"type": "SINGLE_SELECT", "optionKey": "yes"}', 1.5) $$,
  '23514', null, 'confidence is bounded to [0, 1]');

-- Exposure ---------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from onboarding.sessions $$, '42501', null, 'browser user A cannot read raw sessions, even their own');
select throws_ok($$ select * from onboarding.responses $$, '42501', null, 'browser user A cannot read raw responses');
select throws_ok($$ select * from onboarding.definitions $$, '42501', null, 'browser user A cannot read raw definitions (API projection only)');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from onboarding.suggestions $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from onboarding.step_states $$, '42501', null, 'service_role holds no grant');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
