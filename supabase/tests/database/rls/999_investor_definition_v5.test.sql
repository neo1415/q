-- DECISIONS 79, batch 7 (20261231470000): investor onboarding v5 makes
-- every field the profile shows mandatory and asks the firm's description.
-- v5 is current; v4 stays published and unchanged.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select current_version from onboarding.definitions where journey_type = 'investor'),
  5, 'new investor sessions pin to v5');

select is(
  (select s.step_type || ' ' || s.required::text || ' ' || s.writes_to::text
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 5 and s.step_key = 'I11.public_description'),
  'long_text true [{"targetKey": "investor.public_description"}]',
  'v5 asks the firm''s description and writes only that');

select is(
  (select string_agg(s.step_key, ',' order by s.step_key) from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 5 and not s.required),
  'I9.discovery_mode',
  'v5: every step but the discovery style is mandatory');

select is(
  (select s.required from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 4 and s.step_key = 'I7.hard_exclusions'),
  false, 'v4 itself is unchanged');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 5),
  (select count(*)::int + 1 from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 4),
  'v5 is v4 plus the description step');

select * from finish();
rollback;
