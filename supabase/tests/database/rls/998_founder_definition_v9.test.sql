-- Owner 2026-11-07, DECISIONS 79 (20261231440000): founder onboarding v9 is
-- the mandatory set. v9 is current; v8 stays published and unchanged, so a
-- session pinned to it keeps its own journey.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  9, 'new founder sessions pin to v9');

select is(
  (select string_agg(s.step_key, ',' order by s.step_key) from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 9 and s.required
      and s.step_key in ('F1.website', 'F1.country', 'F1.description', 'F1.categories')),
  'F1.categories,F1.country,F1.description,F1.website',
  'v9 makes the website, country, description and categories mandatory');

select is(
  (select s.required from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 9 and s.step_key = 'F0.intent'),
  false, 'v9 makes why they came optional');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 9 and s.required
      and s.step_key in ('F4.founder_count', 'F4.full_time', 'F4.team_size')),
  0, 'v9: the founder''s role is enough; the team counts are optional');

select is(
  (select s.required from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8 and s.step_key = 'F1.website'),
  false, 'v8 itself is unchanged');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 9),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8),
  'v9 has the same steps as v8');

select * from finish();
rollback;
