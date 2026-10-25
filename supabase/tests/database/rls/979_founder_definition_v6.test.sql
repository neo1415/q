-- Lane ob1 (20261228180500): founder onboarding v6 adds the company profile
-- sections as optional steps in phase F9. v6 is current; v5 stays published
-- and unchanged, so a session pinned to it keeps its own journey.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  7, 'new founder sessions pin to v7, the version after v6 (991 covers v7)');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder' and v.version = 5 and v.published_at is not null),
  'v5 stays published for sessions already pinned to it');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 5 and s.step_key like 'F9.%'),
  0, 'v5 itself gained no profile step');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 6 and s.step_key like 'F9.%'
      and s.required = false and s.step_type = 'long_text'),
  12, 'v6 holds twelve optional profile section steps');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 6 and s.step_key not like 'F9.%'),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 5),
  'v6 has every v5 step');

select * from finish();
rollback;
