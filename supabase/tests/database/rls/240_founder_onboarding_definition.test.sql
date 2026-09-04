-- CQ-ONB-002 · Founder Definition v1 is published reference data: one
-- founder definition, version 1 published and current, every F0–F8 step
-- present with its declared type, the reference_select step type accepted,
-- and the published rows frozen.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(17);

-- The definition and its published version ----------------------------------
select is(
  (select count(*)::int from onboarding.definitions where journey_type = 'founder'),
  1, 'exactly one founder definition');
select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  1, 'founder definition points new sessions at version 1');
select is(
  (select count(*)::int
     from onboarding.definition_versions v
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 1 and v.published_at is not null),
  1, 'founder v1 is published');
select matches(
  (select v.manifest_hash from onboarding.definition_versions v
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 1),
  '^[0-9a-f]{64}$', 'founder v1 carries a manifest hash');
select is(
  (select v.schema -> 'runtime' from onboarding.definition_versions v
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 1),
  '{"subjectType": "COMPANY", "allowUnboundStart": true}'::jsonb,
  'founder sessions bind a COMPANY and may start unbound');

-- Steps ----------------------------------------------------------------------
create temporary view founder_steps as
  select s.*
    from onboarding.steps s
    join onboarding.definition_versions v on v.id = s.definition_version_id
    join onboarding.definitions d on d.id = v.definition_id
   where d.journey_type = 'founder' and v.version = 1;

select is((select count(*)::int from founder_steps), 28, 'founder v1 has 28 steps');
select is(
  (select step_key from founder_steps where sequence_order = 0),
  'F0.intent', 'the journey opens on intent');
select is(
  (select step_key from founder_steps order by sequence_order desc limit 1),
  'F8.snapshot', 'the journey ends on the snapshot');
select is(
  (select step_type from founder_steps where step_key = 'F1.categories'),
  'reference_select', 'taxonomy confirmation is a reference selection');
select is(
  (select writes_to from founder_steps where step_key = 'F1.company_name'),
  '[{"targetKey": "company.bootstrap"}]'::jsonb,
  'the company name bootstraps the canonical company');
select is(
  (select writes_to from founder_steps where step_key = 'F6.confirm'),
  '[{"targetKey": "capital.objective"}]'::jsonb,
  'the raise confirmation writes the capital objective');
select is(
  (select count(*)::int from founder_steps where step_key in ('F7.follow_up', 'F2.materials', 'F8.snapshot') and writes_to = '[]'::jsonb),
  3, 'materials, follow-up and snapshot write nothing canonical');
select is(
  (select branching_expression ->> 'stepKey' from founder_steps where step_key = 'F5.revenue_status'),
  'F1.stage', 'traction branches on stage');

-- Frozen ---------------------------------------------------------------------
select throws_ok(
  $$ update onboarding.steps set required = false
      where id = (select id from founder_steps where step_key = 'F0.intent') $$,
  '23514', null, 'published founder steps are immutable');
select throws_ok(
  $$ delete from onboarding.definition_versions
      where id = (select definition_version_id from founder_steps limit 1) $$,
  '23514', null, 'the published founder version cannot be deleted');

-- The extended step-type check accepts reference_select and nothing new ----
insert into onboarding.definitions (id, journey_type, name)
values ('00000000-0000-4000-8000-0000000000e0', 'investor', 'Investor (test)');
insert into onboarding.definition_versions (id, definition_id, version, schema, manifest_hash)
values ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e0', 1,
        '{"schemaVersion": 1, "phases": [], "runtime": {"subjectType": "INVESTOR_ORGANISATION", "allowUnboundStart": true}}',
        repeat('c', 64));
select lives_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
     values ('00000000-0000-4000-8000-0000000000e1', 'pick', 0, 'reference_select', false,
             '{"prompt": "Pick", "resourceType": "TAXONOMY_NODE", "vocabularyCodes": ["industry"], "minItems": 1, "maxItems": 3}') $$,
  'reference_select is an accepted step type');
select throws_ok(
  $$ insert into onboarding.steps (definition_version_id, step_key, sequence_order, step_type, required, configuration)
     values ('00000000-0000-4000-8000-0000000000e1', 'bogus', 1, 'free_form', true, '{}') $$,
  '23514', null, 'an unknown step type is refused');

select * from finish();
rollback;
