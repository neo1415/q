-- CQ-TAX-002 · taxonomy classification provenance: runs and candidates
-- constrained, assignment provenance FK in place, pg_trgm available, no
-- embeddings, every table server-only.
--
-- DB BYPASS ≠ BUSINESS AUTHORISATION: the privileged role can read these
-- tables; application authorisation still gates every run and decision.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(32);

-- Schema ------------------------------------------------------------------------
select has_table('taxonomy', 'classification_runs', 'taxonomy.classification_runs exists');
select has_table('taxonomy', 'classification_candidates', 'taxonomy.classification_candidates exists');
select has_extension('pg_trgm', 'pg_trgm is installed for lexical typo tolerance');
select is((select count(*)::int from pg_extension where extname = 'vector'), 0, 'no pgvector: taxonomy embeddings are not part of CQ-TAX-002');
select is(
  (select count(*)::int from information_schema.columns
    where table_schema = 'taxonomy' and (udt_name = 'vector' or column_name ilike '%embedding%')),
  0, 'no vector / embedding column exists in the taxonomy schema');
select is(
  (select count(*)::int from pg_indexes where schemaname = 'taxonomy' and indexdef ilike '%hnsw%'),
  0, 'no HNSW index exists in the taxonomy schema');
select fk_ok('taxonomy', 'entity_assignments', 'classification_run_id', 'taxonomy', 'classification_runs', 'id',
  'entity_assignments.classification_run_id references classification_runs');
select has_index('taxonomy', 'classification_runs', 'classification_runs_subject_idx', 'runs are indexed by tenant + subject + started_at');
select has_index('taxonomy', 'classification_candidates', 'classification_candidates_classification_run_id_rank_key', 'candidates are unique per run + rank');

-- A deterministic run --------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
values ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Alpha Rails', 'alpha-rails-cls');

select lives_ok(
  $$ insert into taxonomy.classification_runs
       (id, tenant_id, subject_type, subject_id, input_source_type, input_source_id,
        classifier_provider, classifier_model, classifier_version, taxonomy_version, metadata)
     values ('00000000-0000-4000-8000-0000000000f1', pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c2',
             'COMPANY_PROFILE', '00000000-0000-4000-8000-0000000000c2',
             'capital_q', 'deterministic_lexical', 'taxonomy-lexical-v1', '{"industry": 1, "product_category": 1}',
             '{"strategy": "AUTO", "inputHash": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", "inputLength": 14}') $$,
  'a deterministic run is recorded with an honest classifier identity and a version-set snapshot');
select is((select status from taxonomy.classification_runs where id = '00000000-0000-4000-8000-0000000000f1'), 'RUNNING', 'a new run starts RUNNING');
select is((select cost_usd::text from taxonomy.classification_runs where id = '00000000-0000-4000-8000-0000000000f1'), '0.000000', 'deterministic runs cost exactly zero');
select throws_ok(
  $$ update taxonomy.classification_runs set metadata = '{"text": "We build rails"}' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'raw input text cannot be stored in run metadata');
select throws_ok(
  $$ update taxonomy.classification_runs set status = 'COMPLETED' where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'a finished run must carry completed_at');
select throws_ok(
  $$ insert into taxonomy.classification_runs (tenant_id, subject_type, subject_id, classifier_provider, classifier_model, classifier_version, taxonomy_version, status)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c2', 'capital_q', 'deterministic_lexical', 'taxonomy-lexical-v1', '{}', 'DONE') $$,
  '23514', null, 'the run lifecycle is RUNNING / COMPLETED / ABSTAINED / FAILED');
select throws_ok(
  $$ insert into taxonomy.classification_runs (tenant_id, subject_type, subject_id, classifier_provider, classifier_model, classifier_version, taxonomy_version, input_source_type)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c2', 'capital_q', 'deterministic_lexical', 'taxonomy-lexical-v1', '{}', 'COMPANY_PROFILE') $$,
  '23514', null, 'an input source type without an id is rejected');
select throws_ok(
  $$ insert into taxonomy.classification_runs (tenant_id, subject_type, subject_id, classifier_provider, classifier_model, classifier_version, taxonomy_version)
     values (pg_temp.rls_id('tenant_a'), 'INVESTOR', '00000000-0000-4000-8000-0000000000c2', 'capital_q', 'deterministic_lexical', 'taxonomy-lexical-v1', '{}') $$,
  '23514', null, 'only supported subject types are accepted');

-- Candidates ---------------------------------------------------------------------------
select lives_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
             1, 0.9500, array['ALIAS_EXACT'], 'Exact curated alias match ("payments rails").') $$,
  'a ranked candidate references a canonical node');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             0, 0.5, array['LEXICAL'], 'x') $$,
  '23514', null, 'rank 0 is rejected (ranks are 1-based)');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             1, 0.5, array['LEXICAL'], 'x') $$,
  '23505', null, 'a duplicate rank within a run is rejected');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             2, 1.5, array['LEXICAL'], 'x') $$,
  '23514', null, 'confidence above 1 is rejected');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             2, -0.1, array['LEXICAL'], 'x') $$,
  '23514', null, 'confidence below 0 is rejected');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1', '00000000-0000-4000-8000-00000000dead', 2, 0.5, array['LEXICAL'], 'x') $$,
  '23503', null, 'a candidate must reference an existing taxonomy node');
select throws_ok(
  $$ insert into taxonomy.classification_candidates (classification_run_id, node_id, rank, confidence, match_types, rationale_summary)
     values ('00000000-0000-4000-8000-0000000000f1',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             2, 0.5, array['SEMANTIC'], 'x') $$,
  '23514', null, 'match types are a closed set; SEMANTIC is not one of them');
select throws_ok(
  $$ update taxonomy.classification_candidates set accepted = true where classification_run_id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23514', null, 'a decision must record who decided and when');
select lives_ok(
  $$ update taxonomy.classification_candidates set accepted = true, decided_by_user_id = pg_temp.rls_id('user_a'), decided_at = clock_timestamp()
      where classification_run_id = '00000000-0000-4000-8000-0000000000f1' $$,
  'acceptance is recorded with decision provenance');

-- Assignment provenance FK ------------------------------------------------------------
select throws_ok(
  $$ insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source, classification_run_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c2',
             (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'industry' and n.canonical_code = 'fintech'),
             'user_selected', '00000000-0000-4000-8000-00000000dead') $$,
  '23503', null, 'an assignment cannot name a classification run that does not exist');
insert into taxonomy.entity_assignments (tenant_id, entity_type, entity_id, node_id, assignment_source, classification_run_id)
values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c2',
        (select n.id from taxonomy.nodes n join taxonomy.vocabularies v on v.id = n.vocabulary_id where v.code = 'product_category' and n.canonical_code = 'payment_infrastructure'),
        'user_selected', '00000000-0000-4000-8000-0000000000f1');
select throws_ok(
  $$ delete from taxonomy.classification_runs where id = '00000000-0000-4000-8000-0000000000f1' $$,
  '23503', null, 'a run referenced by an accepted assignment cannot be deleted (RESTRICT)');

-- Exposure ----------------------------------------------------------------------------
select pg_temp.act_as_user_a();
select throws_ok($$ select * from taxonomy.classification_runs $$, '42501', null, 'browser user A cannot read classification runs directly');
select throws_ok($$ select * from taxonomy.classification_candidates $$, '42501', null, 'browser user A cannot read candidates directly');
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from taxonomy.classification_runs $$, '42501', null, 'anonymous denied');
select pg_temp.act_as_service_role();
select throws_ok($$ select * from taxonomy.classification_candidates $$, '42501', null, 'service_role holds no grant');
select pg_temp.act_as_privileged();

select * from finish();

rollback;
