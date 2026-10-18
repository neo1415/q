-- 2026-10-08 (20261220140200): "climate", "climate tech" and "saas" reach
-- industry nodes the Sectors step searches; an alias never adds a node.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is(
  (select n.canonical_code from taxonomy.aliases a
     join taxonomy.nodes n on n.id = a.node_id
     join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'industry'
    where a.normalized_alias = 'climate tech'),
  'clean_energy', 'climate tech is a Clean Energy synonym in industry');
select is(
  (select n.canonical_code from taxonomy.aliases a
     join taxonomy.nodes n on n.id = a.node_id
     join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'industry'
    where a.normalized_alias = 'saas'),
  'enterprise_software', 'saas is an Enterprise Software synonym in industry');
select ok(
  exists (select 1 from taxonomy.aliases a
            join taxonomy.nodes n on n.id = a.node_id
            join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'business_model'
           where a.normalized_alias = 'saas'),
  'saas still names the B2B SaaS business model');
select is(
  (select count(*)::int from taxonomy.nodes where canonical_code in ('climate_tech', 'saas')),
  0, 'no node was created for an alias');

select * from finish();
rollback;
