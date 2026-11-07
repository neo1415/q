-- Owner 2026-11-07, DECISIONS 79 (20261231450000): investor onboarding v4
-- is the mandatory set and asks where the firm is based. v4 is current; v3
-- stays published and unchanged.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'investor' and v.version = 4 and v.published_at is not null),
  'v4 stays published (v5, 20261231470000, is current)');

select is(
  (select s.step_type || ' ' || s.required::text || ' ' || (s.configuration ->> 'maxItems') || ' ' || s.writes_to::text
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 4 and s.step_key = 'I0.hq_country'),
  'reference_select true 1 [{"targetKey": "investor.hq_country"}]',
  'v4 asks for the firm''s country, once, and writes only its HQ country');

select is(
  (select string_agg(s.step_key, ',' order by s.step_key) from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 4 and s.required
      and s.step_key in ('I0.website', 'I2.cheque_min', 'I2.cheque_max', 'I3.geography', 'I3.sectors')),
  'I0.website,I2.cheque_max,I2.cheque_min,I3.geography,I3.sectors',
  'v4 makes the website, cheques, geography and sectors mandatory');

select is(
  (select s.required from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 4 and s.step_key = 'I9.discovery_mode'),
  false, 'v4 makes the discovery style optional');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'investor' and v.version = 3 and s.step_key = 'I0.hq_country'),
  0, 'v3 itself is unchanged');

select * from finish();
rollback;
