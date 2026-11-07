-- DECISIONS 79, batch 7 (20261231460000): founder onboarding v10 asks the
-- city, founding year and one-line summary the profile shows. v10 is
-- current; v9 stays published and unchanged.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  10, 'new founder sessions pin to v10');

select is(
  (select string_agg(s.step_key || ' ' || s.step_type || ' ' || s.required::text, ',' order by s.step_key)
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 10
      and s.step_key in ('F1.city', 'F1.founded_year', 'F1.one_line')),
  'F1.city short_text true,F1.founded_year range true,F1.one_line short_text true',
  'v10 asks the city, the founding year and the one line, mandatory');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 10
      and s.step_key in ('F1.city', 'F1.founded_year', 'F1.one_line')
      and s.writes_to::text <> '[{"targetKey": "company.basics"}]'),
  0, 'each writes only the company''s basics');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 9
      and s.step_key in ('F1.city', 'F1.founded_year', 'F1.one_line')),
  0, 'v9 itself is unchanged');

select * from finish();
rollback;
