-- CQ-TAX-001 · taxonomy: reference data present and stable, hierarchy
-- integrity enforced, assignments and mandate preferences constrained,
-- every table server-only.
--
-- Reference ids are deterministic (ADR 0005): a known node is asserted by
-- its rendered UUID. DB BYPASS ≠ BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(43);

-- Reference data -----------------------------------------------------------------
select results_eq(
  $$ select code from taxonomy.vocabularies where status = 'ACTIVE' order by code $$,
  $$ values ('business_model'), ('company_stage'), ('customer_type'), ('geography'), ('impact_theme'),
            ('industry'), ('product_category'), ('regulatory_profile'), ('technology') $$,
  'the nine V1 vocabularies exist');
select ok((select bool_and(version = 1) from taxonomy.vocabularies), 'every vocabulary is at version 1');
select ok((select count(*) from taxonomy.nodes) between 100 and 400, 'a useful, not exhaustive, node set is seeded');
select ok((select count(*) from taxonomy.aliases) >= 40, 'aliases are seeded');
select ok((select count(*) from taxonomy.node_edges) >= 10, 'semantic edges are seeded');

-- Stable identity: Financial Services → Fintech → Payments → Payment Infrastructure.
select is(
  (select n.id::text from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
    where v.code = 'industry' and n.canonical_code = 'payment_infrastructure'),
  (select p.id::text from taxonomy.nodes p join taxonomy.vocabularies v on v.id = p.vocabulary_id
    where v.code = 'industry' and p.canonical_code = 'payment_infrastructure'),
  'industry/payment_infrastructure resolves to one node');
select results_eq(
  $$ with recursive chain as (
       select n.id, n.parent_node_id, n.canonical_code, n.depth from taxonomy.nodes n
         join taxonomy.vocabularies v on v.id = n.vocabulary_id
        where v.code = 'industry' and n.canonical_code = 'payment_infrastructure'
       union all
       select p.id, p.parent_node_id, p.canonical_code, p.depth from taxonomy.nodes p join chain on chain.parent_node_id = p.id)
     select canonical_code from chain order by depth $$,
  $$ values ('financial_services'), ('fintech'), ('payments'), ('payment_infrastructure') $$,
  'the documented fintech hierarchy is present with the right ancestry');
select is((select depth from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
            where v.code = 'industry' and n.canonical_code = 'payment_infrastructure'), 3,
  'payment_infrastructure sits at depth 3');
select results_eq(
  $$ select n.canonical_code from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
      where v.code = 'company_stage' order by 1 $$,
  $$ values ('pre_seed'), ('seed'), ('series_a'), ('series_b'), ('series_c_plus') $$,
  'company_stage carries the existing stage codes');
select is((select metadata ->> 'iso3166Alpha2' from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id
            where v.code = 'geography' and n.canonical_code = 'nigeria'), 'NG',
  'country nodes keep their ISO code in bounded metadata');
select ok(exists (select 1 from taxonomy.aliases a join taxonomy.nodes n on n.id = a.node_id
                   where n.canonical_code = 'payment_infrastructure' and a.normalized_alias = 'payments rails'),
  'aliases are stored normalised');
select is((select count(*)::int from taxonomy.aliases where normalized_alias = 'payments rails'), 2,
  'the same phrase may alias nodes in different vocabularies');
-- Rename simulation: identity survives a label change.
update taxonomy.nodes set display_name = 'Payments Infrastructure'
 where canonical_code = 'payment_infrastructure';
select is((select count(*)::int from taxonomy.nodes where canonical_code = 'payment_infrastructure'), 2,
  'renaming the label leaves id and canonical_code untouched');

-- Hierarchy integrity ------------------------------------------------------------
select throws_ok(
  $$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, parent_node_id, depth)
     select gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'bad_child', 'Bad child',
            (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'geography' and n.canonical_code = 'africa'), 1 $$,
  '23503', null, 'a parent in another vocabulary is impossible');
select throws_ok(
  $$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, parent_node_id, depth)
     select gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'wrong_depth', 'Wrong depth',
            (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'), 5 $$,
  '23514', null, 'depth must be parent depth + 1');
select throws_ok(
  $$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, parent_node_id, depth)
     values (gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'root_with_depth', 'x', null, 1) $$,
  '23514', null, 'a root has depth 0');
-- Cycle: A → B → C, then make A a child of C.
insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name, parent_node_id, depth) values
  ('00000000-0000-4000-8000-0000000000a1', (select id from taxonomy.vocabularies where code = 'industry'), 'cycle_a', 'A', null, 0),
  ('00000000-0000-4000-8000-0000000000a2', (select id from taxonomy.vocabularies where code = 'industry'), 'cycle_b', 'B', '00000000-0000-4000-8000-0000000000a1', 1),
  ('00000000-0000-4000-8000-0000000000a3', (select id from taxonomy.vocabularies where code = 'industry'), 'cycle_c', 'C', '00000000-0000-4000-8000-0000000000a2', 2);
select throws_ok(
  $$ update taxonomy.nodes set parent_node_id = '00000000-0000-4000-8000-0000000000a3', depth = 3 where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'A → B → C → A is rejected');
select throws_ok(
  $$ update taxonomy.nodes set parent_node_id = id, depth = 1 where id = '00000000-0000-4000-8000-0000000000a1' $$,
  '23514', null, 'a node cannot be its own parent');
select throws_ok(
  $$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name)
     values (gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'Bad Code', 'x') $$,
  '23514', null, 'canonical codes are conservative lower-case codes');
select throws_ok(
  $$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name)
     values (gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'fintech', 'Duplicate') $$,
  '23505', null, 'canonical code is unique within a vocabulary');
-- Edges
select throws_ok(
  $$ insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'related_to') $$,
  '23514', null, 'self edges are rejected');
select throws_ok(
  $$ insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type)
     values ('00000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a2', 'ranks_above') $$,
  '23514', null, 'edge vocabulary is closed (no ranking relation)');
-- Deprecation + successor: history stays, successor recorded.
update taxonomy.nodes set status = 'DEPRECATED', valid_to = now() where id = '00000000-0000-4000-8000-0000000000a3';
select lives_ok(
  $$ insert into taxonomy.node_edges (from_node_id, to_node_id, edge_type)
     values ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a3', 'successor_of') $$,
  'a successor edge points from the replacement to the deprecated node');
select is((select status from taxonomy.nodes where id = '00000000-0000-4000-8000-0000000000a3'), 'DEPRECATED', 'a deprecated node remains loadable by id');

-- Assignments ----------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Company A', 'company-a');
insert into taxonomy.entity_assignments (id, tenant_id, entity_type, entity_id, node_id, assignment_source, raw_source_text, confirmed_by_user_id, confirmed_at)
  values ('00000000-0000-4000-8000-0000000000e1', pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1',
          (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
          'user_selected', 'We build rails for cooperative banks. PRIVATE-TAXONOMY-SOURCE-TEXT-DO-NOT-EMIT', pg_temp.rls_id('user_a'), now());
select throws_ok(
  $$ insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
             'user_selected') $$,
  '23505', null, 'one current assignment per subject and node');
select throws_ok(
  $$ insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
     values (pg_temp.rls_id('tenant_a'), 'DOCUMENT', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'user_selected') $$,
  '23514', null, 'entity_type is a closed typed set');
select throws_ok(
  $$ insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source, confidence)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1', 'q_inferred', 1.5) $$,
  '23514', null, 'confidence is bounded to [0, 1]');
select throws_ok(
  $$ update taxonomy.entity_assignments set status = 'SUPERSEDED' where id = '00000000-0000-4000-8000-0000000000e1' $$,
  '23514', null, 'supersession requires a valid_to');
select lives_ok(
  $$ update taxonomy.entity_assignments set status = 'SUPERSEDED', valid_to = clock_timestamp() where id = '00000000-0000-4000-8000-0000000000e1' $$,
  'supersession sets status and valid_to together');
select lives_ok(
  $$ insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
             'user_selected') $$,
  'a superseded assignment may be re-assigned later; history repeats are allowed');
select is((select count(*)::int from taxonomy.entity_assignments where entity_id = '00000000-0000-4000-8000-0000000000c1'), 2,
  'history is retained, never deleted');

-- Mandate preferences -----------------------------------------------------------------
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-0000000000e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Investor B');
insert into core.investor_mandates (id, tenant_id, investor_organisation_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000000d1', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000e2', 'Seed thesis', pg_temp.rls_id('user_b'));
select lives_ok(
  $$ insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000d1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
             'AVOID', false) $$,
  'AVOID persists as a soft negative (is_exclusion = false)');
select throws_ok(
  $$ insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'AVOID', true) $$,
  '23514', null, 'AVOID never becomes an exclusion');
select throws_ok(
  $$ insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'HARD_EXCLUSION', false) $$,
  '23514', null, 'HARD_EXCLUSION ⇔ is_exclusion');
select throws_ok(
  $$ insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion)
     values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'LOVE', false) $$,
  '23514', null, 'the preference scale is the existing CQ-INV-002 scale');
select throws_ok(
  $$ insert into taxonomy.mandate_preferences (tenant_id, mandate_id, node_id, preference_strength, is_exclusion)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000d1', '00000000-0000-4000-8000-0000000000a1', 'NICE', false) $$,
  '23503', null, 'a preference cannot name a mandate under another tenant');

-- Exposure -------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from taxonomy.nodes $$, '42501', null, 'browser user A cannot read reference nodes directly (API only)');
select throws_ok($$ select * from taxonomy.entity_assignments $$, '42501', null, 'browser user A cannot read raw assignments');
select throws_ok($$ insert into taxonomy.nodes (id, vocabulary_id, canonical_code, display_name) values (gen_random_uuid(), (select id from taxonomy.vocabularies where code = 'industry'), 'hack', 'x') $$, '42501', null, 'browser user A cannot edit the platform taxonomy');
select pg_temp.act_as_user_b();
select throws_ok($$ select * from taxonomy.mandate_preferences $$, '42501', null, 'investor-side user B cannot read raw mandate preferences');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from taxonomy.vocabularies $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from taxonomy.aliases $$, '42501', null, 'service_role holds no grant');
select pg_temp.act_as_privileged();
select is((select count(*)::int from information_schema.tables where table_schema = 'taxonomy' and table_name in ('classification_runs', 'classification_candidates')), 0,
  'no classification tables exist yet (CQ-TAX-002)');

select * from finish();

rollback;
