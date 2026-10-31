-- Live re-check 2026-10-31 (20261231210000): investor onboarding v3 adds
-- "Not sure yet" to whether they are deploying capital. v3 is current; v2
-- (and v1) stay published and unchanged, so a session pinned to them keeps
-- its own journey. The option is an answer, never a deployment state.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select current_version from onboarding.definitions where journey_type = 'investor'),
  3, 'new investor sessions pin to v3');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'investor' and v.version = 2 and v.published_at is not null),
  'v2 stays published for sessions already pinned to it');

select is(
  (select jsonb_array_length(s.configuration -> 'options') from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 2 and s.step_key = 'I1.deployment_status'),
  4, 'v2 itself still offers its four deployment states');

select is(
  (select (s.configuration -> 'options' -> -1) ->> 'optionKey' || ' ' || ((s.configuration -> 'options' -> -1) ->> 'label')
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 3 and s.step_key = 'I1.deployment_status'
      and s.required and s.step_type = 'single_select'),
  'not_sure Not sure yet', 'v3 offers "Not sure yet" last on the required deployment step');

select is(
  (select s.writes_to from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 3 and s.step_key = 'I1.deployment_status'),
  '[{"targetKey":"investor.deployment_status"},{"targetKey":"investor.mandate.ensure"}]'::jsonb,
  'the v3 deployment step writes what v2''s did');

select is(
  (select count(*)::int from onboarding.steps s3
     join onboarding.definition_versions v3 on v3.id = s3.definition_version_id
     join onboarding.definitions d on d.id = v3.definition_id and d.journey_type = 'investor'
     join onboarding.definition_versions v2 on v2.definition_id = d.id and v2.version = 2
     join onboarding.steps s2 on s2.definition_version_id = v2.id and s2.step_key = s3.step_key
    where v3.version = 3
      and s2.sequence_order = s3.sequence_order and s2.step_type = s3.step_type
      and s2.required = s3.required and s2.writes_to = s3.writes_to
      and coalesce(s2.branching_expression::text, '') = coalesce(s3.branching_expression::text, '')
      and (s3.step_key = 'I1.deployment_status' or s2.configuration = s3.configuration)),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 2),
  'v3 has every v2 step unchanged but the deployment options');

select * from finish();
rollback;
