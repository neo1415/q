-- 2026-10-16 (20261228160000): the customer words a fund deck uses reach
-- existing customer_type nodes; an alias never adds a node.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

create temporary table expected (normalized_alias text, canonical_code text) on commit drop;
insert into expected values
  ('smes', 'small_business'),
  ('msme', 'small_business'),
  ('small businesses', 'small_business'),
  ('mid-market', 'mid_market'),
  ('enterprises', 'enterprise'),
  ('consumers', 'consumer'),
  ('b2c', 'consumer'),
  ('government', 'government');

select is(
  (select n.canonical_code from taxonomy.aliases a
     join taxonomy.nodes n on n.id = a.node_id
     join taxonomy.vocabularies v on v.id = n.vocabulary_id and v.code = 'customer_type'
    where a.normalized_alias = e.normalized_alias),
  e.canonical_code,
  format('%s is a %s customer type', e.normalized_alias, e.canonical_code))
  from expected e
 order by e.normalized_alias;

select is(
  (select count(*)::int from taxonomy.nodes
    where canonical_code in ('sme', 'smes', 'msme', 'msmes', 'smbs', 'midmarket', 'enterprises', 'consumers', 'b2c', 'governments')),
  0, 'no node was created for an alias');

select * from finish();
rollback;
