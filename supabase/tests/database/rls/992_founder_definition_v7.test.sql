-- Live e2e 25 Oct 2026 (20261231130000): founder onboarding v7 asks the
-- number of paying customers at seed too, for an early-stage company whose
-- signal is "Paying customers". v7 is current; v6 stays published and
-- unchanged, so a session pinned to it keeps its own journey.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  7, 'new founder sessions pin to v7');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder' and v.version = 6 and v.published_at is not null),
  'v6 stays published for sessions already pinned to it');

select ok(
  (select s.branching_expression::text not like '%paying%'
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 6 and s.step_key = 'F5.customers'),
  'v6 itself still asks paying customers only from Series A');

select ok(
  (select s.branching_expression::text like '%"F5.signal"%' and s.branching_expression::text like '%"paying"%'
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 7 and s.step_key = 'F5.customers'),
  'v7 asks paying customers of an early-stage company whose signal is paying customers');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 7),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 6),
  'v7 has exactly v6''s steps');

select * from finish();
rollback;
