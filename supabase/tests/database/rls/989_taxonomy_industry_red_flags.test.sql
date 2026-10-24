-- QO-28b (20261231100000): the red-flag industries are industry nodes a
-- company can declare. Reference data only: no grant or policy changes.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is(
  (select count(*)::int from taxonomy.nodes n
     join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'industry' and n.status = 'ACTIVE'
      and n.canonical_code in ('gambling', 'tobacco', 'weapons', 'adult_content', 'crypto_speculation')),
  5, 'the five red-flag industries are active industry nodes');

select ok(
  (select version from taxonomy.vocabularies where code = 'industry') >= 2,
  'the industry vocabulary version moved to 2');

select is(
  (select n.id from taxonomy.nodes n
     join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'industry' and n.canonical_code = 'gambling'),
  '69419580-1247-540b-810e-1ae3360f55c9'::uuid,
  'ids are the stable v5 ids the reference data names');

select is(
  (select count(*)::int from taxonomy.aliases a
     join taxonomy.nodes n on n.id = a.node_id
    where n.canonical_code = 'gambling' and a.normalized_alias = 'sports betting'),
  1, 'aliases arrive with their nodes');

select * from finish();
rollback;
