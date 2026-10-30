-- Live recheck 2026-10-30 (20261231180000): every ISO 3166-1 country in the
-- geography vocabulary. "Benelux and the Nordics" could not be placed: no
-- Belgium, no Luxembourg, no Nordic country. Additive only: the countries
-- already listed keep their ids and parents; re-running changes nothing.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

select is(
  (select count(distinct n.metadata ->> 'iso3166Alpha2')::int
     from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'geography' and n.metadata ? 'iso3166Alpha2' and n.status = 'ACTIVE'),
  249, 'every ISO 3166-1 alpha-2 code has one active geography node');

select is(
  (select count(*)::int
     from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'geography'),
  270, 'the geography vocabulary holds 270 nodes (47 before, 223 added)');

select is(
  (select array_agg(n.canonical_code || ':' || p.canonical_code order by n.canonical_code)
     from taxonomy.nodes n join taxonomy.nodes p on p.id = n.parent_node_id
    where n.canonical_code in ('belgium', 'luxembourg', 'netherlands', 'denmark', 'sweden',
                               'norway', 'finland', 'iceland')),
  array['belgium:europe', 'denmark:nordics', 'finland:nordics', 'iceland:nordics',
        'luxembourg:europe', 'netherlands:europe', 'norway:nordics', 'sweden:nordics'],
  'the Benelux countries sit under Europe and the Nordic countries under the Nordics');

select is(
  (select p.canonical_code from taxonomy.nodes n join taxonomy.nodes p on p.id = n.parent_node_id
    where n.id = '12d66413-ed86-5883-8b9d-3032a8d58dc5'),
  'europe', 'the Nordics region (stable id) sits under Europe');

-- Descendant matching: a mandate on Europe now reaches the new countries.
select is(
  (with recursive down as (
     select id, canonical_code from taxonomy.nodes where canonical_code = 'europe'
     union
     select n.id, n.canonical_code from taxonomy.nodes n join down d on n.parent_node_id = d.id
   )
   select count(*)::int from down
    where canonical_code in ('belgium', 'luxembourg', 'denmark', 'poland', 'spain', 'united_kingdom')),
  6, 'Europe contains the new countries and the ones it held before');

select is(
  (select count(*)::int from taxonomy.nodes
    where id in ('ccace354-1437-5fb0-a46f-2c6f11ff21cf', '20dc8cd8-bb51-517f-8fe0-1f6264e51a3b',
                 '57b96b49-499c-5192-be13-0ed9a66a60a3', '6180c1da-6483-57d0-be9c-e0520955c003')
      and parent_node_id in ('b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', '15494414-7ef7-5a7f-9374-c1e5f13c40d1')
      and depth = 1),
  4, 'countries already listed (UK, Netherlands, India, Singapore) keep their parents');

select is(
  (select count(*)::int from taxonomy.aliases a join taxonomy.nodes n on n.id = a.node_id
    where n.canonical_code = 'nordics' and a.normalized_alias in ('the nordics', 'nordic countries', 'scandinavia')),
  3, '"the Nordics" and its synonyms name the region');

select is(
  (select count(*)::int from taxonomy.aliases a join taxonomy.nodes n on n.id = a.node_id
     join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'geography' and a.normalized_alias in ('no', 'it', 'me', 'vc', 'pe', 'ai', 'ml')),
  0, 'an ISO code that is an everyday word or investment shorthand is not an alias');

select ok(
  (select version from taxonomy.vocabularies where code = 'geography') >= 5,
  'the geography vocabulary version moved to 5');

-- Idempotent: the migration's statements, run again, change nothing.
insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, description, parent_node_id, depth, status, metadata) values
  ('ac061d4c-a647-5268-9fd2-323479e90043', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'belgium', 'Belgium', null, 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{"iso3166Alpha2":"BE"}'::jsonb),
  ('12d66413-ed86-5883-8b9d-3032a8d58dc5', '512652ee-b4a7-519f-ae12-9db2b1607ee2', 'nordics', 'Nordics', 'The Nordic countries and their territories.', 'b6869c9c-b25c-5a8b-a1f1-38c2d3a5a994', 1, 'ACTIVE', '{}'::jsonb)
on conflict (id) do nothing;
insert into taxonomy.aliases (id, node_id, alias, locale, alias_type, normalized_alias) values
  ('6995ade0-055b-59da-b71f-e7db9fb2f56d', '12d66413-ed86-5883-8b9d-3032a8d58dc5', 'the Nordics', 'en', 'SYNONYM', 'the nordics')
on conflict (id) do nothing;
update taxonomy.vocabularies set version = 5
 where id = '512652ee-b4a7-519f-ae12-9db2b1607ee2' and version < 5;

select is(
  (select count(*)::int
     from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'geography'),
  270, 're-running the inserts adds no node');

select is(
  (select count(*)::int from taxonomy.aliases where normalized_alias = 'the nordics'),
  1, 're-running the inserts adds no alias');

select is(
  (select version from taxonomy.vocabularies where code = 'geography'),
  5, 're-running leaves the version at 5');

select * from finish();
rollback;
