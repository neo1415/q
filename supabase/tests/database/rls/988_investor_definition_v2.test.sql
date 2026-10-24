-- QO-27c (20261231090000): investor onboarding v2 adds the firm's website as
-- an optional step after the firm's name. v2 is current; v1 stays published
-- and unchanged, so a session pinned to it keeps its own journey.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select is(
  (select current_version from onboarding.definitions where journey_type = 'investor'),
  2, 'new investor sessions pin to v2');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'investor' and v.version = 1 and v.published_at is not null),
  'v1 stays published for sessions already pinned to it');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 1 and s.step_key = 'I0.website'),
  0, 'v1 itself gained no website step');

select is(
  (select s.writes_to from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 2 and s.step_key = 'I0.website'
      and s.required = false and s.step_type = 'short_text'),
  '[{"targetKey":"investor.website"}]'::jsonb,
  'v2 holds an optional website step that writes the firm website only');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 2 and s.step_key <> 'I0.website'),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 1),
  'v2 has every v1 step');

select * from finish();
rollback;
