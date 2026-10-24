-- QA F-81 (20261231110000): the Gulf (GCC) region. The six GCC countries
-- are re-parented under it with the same ids; the Middle East still
-- contains all six; "the Gulf" and "GCC" name the region.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

select is(
  (select p.canonical_code from taxonomy.nodes n
     join taxonomy.nodes p on p.id = n.parent_node_id
    where n.canonical_code = 'gcc'),
  'middle_east', 'the Gulf (GCC) region sits under the Middle East');

select is(
  (select count(*)::int from taxonomy.nodes n
    where n.id in ('2593e271-7b16-575d-8650-5e35054df867', 'ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3',
                   'd0145b00-c51b-5a03-ae2f-526a4169c8a3', '3d04d1f9-22f4-58f8-8c07-f3f5fea82ff6',
                   '50e42308-e484-51b5-97d0-34a7cd3b0033', 'c3c5d0cf-4e01-5d2d-bfa9-6902ed35e6af')
      and n.parent_node_id = 'e7020c85-8cfc-56fc-8250-ff4be3af6512'
      and n.depth = 2 and n.status = 'ACTIVE'),
  6, 'the six GCC countries keep their ids and sit under the region');

select is(
  (select array_agg(n.metadata ->> 'iso3166Alpha2' order by n.metadata ->> 'iso3166Alpha2')
     from taxonomy.nodes n where n.parent_node_id = 'e7020c85-8cfc-56fc-8250-ff4be3af6512'),
  array['AE', 'BH', 'KW', 'OM', 'QA', 'SA'], 'their ISO codes are unchanged');

-- Descendant matching: everything the Middle East contained, it still does.
select is(
  (with recursive down as (
     select id, canonical_code from taxonomy.nodes where canonical_code = 'middle_east'
     union
     select n.id, n.canonical_code from taxonomy.nodes n join down d on n.parent_node_id = d.id
   )
   select count(*)::int from down
    where canonical_code in ('united_arab_emirates', 'qatar', 'saudi_arabia', 'kuwait', 'bahrain', 'oman')),
  6, 'the Middle East still contains all six countries');

select is(
  (select count(*)::int from taxonomy.aliases a
    where a.node_id = 'e7020c85-8cfc-56fc-8250-ff4be3af6512'
      and a.normalized_alias in ('the gulf', 'gulf', 'gulf states', 'arabian gulf', 'gcc')),
  5, '"the Gulf", "GCC" and the other names reach the region');

select ok(
  (select version from taxonomy.vocabularies where code = 'geography') >= 4,
  'the geography vocabulary version moved to 4');

-- An assignment to a country is untouched by its new parent.
select lives_ok(
  $$ select 1 from taxonomy.entity_assignments a
      where a.node_id = 'ed0e602d-d9ad-576c-9a5a-b74ccb57ebf3' limit 1 $$,
  'assignments to a re-parented country still resolve by its id');

select * from finish();
rollback;
