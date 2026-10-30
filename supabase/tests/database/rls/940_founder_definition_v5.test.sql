-- D (20261227110000, 20261227120000): founder onboarding v5 adds the Gulf
-- to the country list, and the geography vocabulary gains the same five
-- countries. v5 is current; v4 stays published and unchanged, so a session
-- pinned to it keeps its own journey.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

select is(
  (select current_version from onboarding.definitions where journey_type = 'founder'),
  8, 'new founder sessions pin to v8, a later version than v5 (979 covers v6, 992 v7, 996 v8)');

select ok(
  exists (select 1 from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder' and v.version = 4 and v.published_at is not null),
  'v4 stays published for sessions already pinned to it');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4 and s.step_key = 'F1.country'
      and s.configuration -> 'options' @> '[{"optionKey":"qa"}]'::jsonb),
  0, 'v4 itself gained no country');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 5 and s.step_key = 'F1.country'
      and s.configuration -> 'options' @> '[{"optionKey":"qa"},{"optionKey":"sa"},{"optionKey":"kw"},{"optionKey":"bh"},{"optionKey":"om"},{"optionKey":"ae"}]'::jsonb),
  1, 'v5 offers Qatar and the other GCC countries');

select is(
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 5),
  (select count(*)::int from onboarding.steps s
     join onboarding.definition_versions v on v.id = s.definition_version_id
     join onboarding.definitions d on d.id = v.definition_id
    where d.journey_type = 'founder' and v.version = 4),
  'v5 has exactly v4''s steps');

select is(
  (select count(*)::int from taxonomy.nodes n
     join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'geography'
      and n.canonical_code in ('qatar', 'saudi_arabia', 'kuwait', 'bahrain', 'oman')
      -- Since 20261231110000 through the Gulf (GCC) region, still in the Middle East.
      and n.parent_node_id = (select id from taxonomy.nodes where canonical_code = 'gcc')
      and (select p.parent_node_id from taxonomy.nodes p where p.canonical_code = 'gcc')
          = (select id from taxonomy.nodes where canonical_code = 'middle_east')
      and n.metadata ? 'iso3166Alpha2'),
  5, 'the five Gulf countries sit in the Middle East (through the Gulf region) with ISO codes');

select * from finish();
rollback;
