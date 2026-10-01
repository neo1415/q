-- HARDEN 20261110010000: founder definition v3 is published, current, and
-- adds the two early-signal options; v2 stays published for its sessions.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(4);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  3,
  'new founder sessions pin to v3');

select ok(
  (select bool_and(v.published_at is not null)
     from onboarding.definition_versions v
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version in (2, 3)),
  'v2 and v3 are both published');

select is(
  (select jsonb_path_query_array(s.configuration, '$.options[*].optionKey')
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 3 and s.step_key = 'F5.signal'),
  '["pilots", "lois", "waitlist", "users", "paying", "partnerships", "none"]'::jsonb,
  'v3 early signal has paying customers and partnerships, nothing last');

select is(
  (select count(*)::int
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 3),
  (select count(*)::int
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 2),
  'v3 has exactly v2''s steps');

select * from finish();
rollback;
