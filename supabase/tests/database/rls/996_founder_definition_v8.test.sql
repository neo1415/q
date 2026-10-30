-- Owner 2026-10-30 (20261231190000): founder onboarding v8 chooses the
-- company's country from the geography taxonomy, one canonical country
-- list, instead of a fixed option list. v8 is current; v7 stays published
-- and unchanged, and every option key an older version offered maps to
-- exactly one geography node carrying that ISO code, so an older session's
-- answer stays a country without rewriting any row.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  8, 'new founder sessions pin to v8');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder' and v.version = 7 and v.published_at is not null),
  'v7 stays published for sessions already pinned to it');

select is(
  (select s.step_type from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 7 and s.step_key = 'F1.country'),
  'single_select', 'v7 itself still offers its option list');

select is(
  (select s.step_type || ' ' || (s.configuration ->> 'resourceType') || ' '
          || (s.configuration -> 'vocabularyCodes')::text || ' '
          || (s.configuration ->> 'maxItems')
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8 and s.step_key = 'F1.country'),
  'reference_select TAXONOMY_NODE ["geography"] 1',
  'v8 chooses one geography node for the country');

select ok(
  (select not (s.configuration ? 'options')
     from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8 and s.step_key = 'F1.country'),
  'v8 has no country option list');

select is(
  (select s.writes_to::text from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8 and s.step_key = 'F1.country'),
  '[{"targetKey": "company.basics"}]',
  'the v8 country still writes the company''s basics (headquarters country)');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 8),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 7),
  'v8 has exactly v7''s steps');

-- Every option an older version offered, other than "somewhere else", is
-- a country of the geography vocabulary: exactly one node carries its code.
select is(
  (select count(*)::int
     from (select distinct o ->> 'optionKey' as key
             from onboarding.steps s
             join onboarding.definition_versions v on v.id = s.definition_version_id
             join onboarding.definitions d on d.id = v.definition_id
             cross join lateral jsonb_array_elements(s.configuration -> 'options') o
            where d.journey_type = 'founder' and v.version < 8
              and s.step_key = 'F1.country'
              and o ->> 'optionKey' <> 'other') legacy
    where (select count(*) from taxonomy.nodes n
             join taxonomy.vocabularies vv on vv.id = n.vocabulary_id
            where vv.code = 'geography'
              and n.metadata ->> 'iso3166Alpha2' = upper(legacy.key)) <> 1),
  0, 'every older country option maps to exactly one geography node');

select ok(
  exists (select 1 from taxonomy.nodes n
            join taxonomy.vocabularies vv on vv.id = n.vocabulary_id
           where vv.code = 'geography' and n.metadata ->> 'iso3166Alpha2' = 'DK'),
  'Denmark, missing from every older option list, is a geography country');

select * from finish();
rollback;
