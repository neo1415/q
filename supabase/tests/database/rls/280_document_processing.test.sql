-- CQ-EVD-003 · Document processing: the states a run may honestly report,
-- the immutability of a structured extraction, and the fact that neither the
-- work queue nor the derived artifacts are reachable from a browser.
--
--   uploaded ≠ safe ≠ parsed ≠ trusted
--   extracted block ≠ evidence item ≠ claim ≠ Q knowledge
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(26);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000003c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Processing Co A', 'processing-co-a');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000003d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000003c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000003d2', pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Their deck', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000003f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000003d1', 1, 'cq-documents-private', 'raw/tenant-a/00000000000000000000000000000001', 'deck.pdf', 'application/pdf', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000003f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000003d2', 1, 'cq-documents-private', 'raw/tenant-b/00000000000000000000000000000002', 'deck.pdf', 'application/pdf', 2048, repeat('b', 64), pg_temp.rls_id('user_b'));

insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status) values
  ('00000000-0000-4000-8000-0000000003a1', '00000000-0000-4000-8000-0000000003f1', 'evidence-processing-v1', 'RUNNING'),
  ('00000000-0000-4000-8000-0000000003a2', '00000000-0000-4000-8000-0000000003f2', 'evidence-processing-v1', 'RUNNING');

-- The work queue -------------------------------------------------------------------
select has_table('pgmq', 'q_documents', 'the documents work queue exists');
select has_table('pgmq', 'q_documents-dead', 'exhausted attempts have somewhere to land');
select has_table('pgmq', 'q_domain-events', 'the domain event queue still exists');

-- Processing state vocabulary --------------------------------------------------------
select lives_ok(
  $$ update evidence.document_processing_runs set status = 'BLOCKED', error_code = 'MALWARE_SCAN_UNAVAILABLE'
      where id = '00000000-0000-4000-8000-0000000003a1' $$,
  'a run may report that policy refused the work');
select lives_ok(
  $$ update evidence.document_versions set text_extraction_status = 'UNSUPPORTED'
      where id = '00000000-0000-4000-8000-0000000003f1' $$,
  'a format with no extractor is UNSUPPORTED, never COMPLETED');
select throws_ok(
  $$ update evidence.document_processing_runs set status = 'SKIPPED' where id = '00000000-0000-4000-8000-0000000003a1' $$,
  '23514', null, 'a run cannot invent a status');
select throws_ok(
  $$ update evidence.document_processing_runs set status = 'RUNNING', error_code = 'MALWARE_DETECTED'
      where id = '00000000-0000-4000-8000-0000000003a1' $$,
  '23514', null, 'only a failed or blocked run carries an error code');

-- The private artifact bucket ---------------------------------------------------------
select is((select public from storage.buckets where id = 'cq-extractions-private'), false,
  'the extraction bucket is private');
select is((select file_size_limit from storage.buckets where id = 'cq-extractions-private'), 8388608::bigint,
  'the extraction bucket has a size ceiling');
select is((select allowed_mime_types from storage.buckets where id = 'cq-extractions-private'), array['application/json'],
  'the extraction bucket holds only structured artifacts');
select is((select public from storage.buckets where id = 'cq-documents-private'), false,
  'the raw document bucket is still private');
select is((select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'), 0,
  'no storage policy exposes either private bucket to a browser');

-- Extraction provenance ---------------------------------------------------------------
insert into evidence.document_extractions
  (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id,
   schema_version, extractor_id, extractor_version, pipeline_version,
   artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count,
   visibility_scope, sensitivity_class, instruction_risk_signals)
values
  ('00000000-0000-4000-8000-0000000003e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003a1',
   1, 'pdf', '1.0.0', 'evidence-processing-v1',
   'cq-extractions-private', 'extractions/tenant-a/v1/run-0001.json', repeat('c', 64), 4096, 12,
   'founder_private', 'CONFIDENTIAL', 3);

select hasnt_column('evidence', 'document_extractions', 'text',
  'the extracted text is not in the row; it lives in private storage');
select hasnt_column('evidence', 'document_extractions', 'blocks',
  'extracted blocks are not in the row');
select is((select visibility_scope || '/' || sensitivity_class from evidence.document_extractions where id = '00000000-0000-4000-8000-0000000003e1'),
  'founder_private/CONFIDENTIAL',
  'an extraction inherits the document''s scope; a parser running never widens it');

select throws_ok(
  $$ update evidence.document_extractions set block_count = 99 where id = '00000000-0000-4000-8000-0000000003e1' $$,
  '23514', null, 'an extraction is immutable; reprocessing means a new pipeline version');
select throws_ok(
  $$ delete from evidence.document_extractions where id = '00000000-0000-4000-8000-0000000003e1' $$,
  '23514', null, 'extractions are never deleted');
select throws_ok(
  $$ insert into evidence.document_extractions
       (tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id,
        schema_version, extractor_id, extractor_version, pipeline_version,
        artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count,
        visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
       '00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003a1',
       1, 'pdf', '1.0.0', 'evidence-processing-v1',
       'cq-extractions-private', 'extractions/tenant-a/v1/run-0002.json', repeat('d', 64), 4096, 12,
       'founder_private', 'CONFIDENTIAL') $$,
  '23505', null, 'one artifact per document version per pipeline version');
select throws_ok(
  $$ insert into evidence.document_extractions
       (tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id,
        schema_version, extractor_id, extractor_version, pipeline_version,
        artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count,
        visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
       '00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003f2', '00000000-0000-4000-8000-0000000003a2',
       1, 'pdf', '1.0.0', 'evidence-processing-v2',
       'cq-extractions-private', 'extractions/tenant-a/v1/run-0003.json', repeat('e', 64), 4096, 12,
       'founder_private', 'CONFIDENTIAL') $$,
  '23503', null, 'an extraction cannot name a document version from another tenant');
select throws_ok(
  $$ insert into evidence.document_extractions
       (tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id,
        schema_version, extractor_id, extractor_version, pipeline_version,
        artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count,
        visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
       '00000000-0000-4000-8000-0000000003d1', '00000000-0000-4000-8000-0000000003f1', '00000000-0000-4000-8000-0000000003a1',
       1, 'pdf', '1.0.0', 'evidence-processing-v3',
       'cq-extractions-private', 'extractions/../../etc/passwd', repeat('f', 64), 4096, 12,
       'founder_private', 'CONFIDENTIAL') $$,
  '23514', null, 'an artifact key never traverses');

-- Browser principals -------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from evidence.document_extractions $$,
  '42501', null, 'anonymous cannot read extractions');
select throws_ok($$ select count(*) from pgmq.q_documents $$,
  '42501', null, 'anonymous cannot read the work queue');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.document_extractions $$,
  '42501', null, 'an authenticated browser session cannot read extractions, even its own organisation''s');
select throws_ok($$ select count(*) from evidence.document_processing_runs $$,
  '42501', null, 'an authenticated browser session cannot read processing runs');
select throws_ok($$ select pgmq.send('documents', '{"forged":true}'::jsonb) $$,
  '42501', null, 'a browser cannot enqueue document work');

select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.document_extractions), 1,
  'the privileged server role reads the extraction; DB privilege is not business authorisation');

select * from finish();
rollback;
