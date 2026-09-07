-- CQ-RAG-001 · q_knowledge chunks: server-only derived rows that inherit
-- their source's governance, keep provenance immutable, change lifecycle
-- only, and never reach a browser role.
--
--   source ≠ document ≠ version ≠ extraction ≠ chunk
--   chunk ≠ evidence item ≠ claim ≠ Q knowledge
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(29);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000004c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Chunk Co A', 'chunk-co-a'),
  ('00000000-0000-4000-8000-0000000004c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Chunk Co B', 'chunk-co-b');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000004d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000004c1', pg_temp.rls_id('org_a'), 'FINANCIAL_MODEL', 'Model A', 'founder_private', 'RESTRICTED', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000004d2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000004c2', pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Deck B', 'organisation_private', 'CONFIDENTIAL', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000004f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000004d1', 1, 'cq-documents-private', 'raw/tenant-a/00000000000000000000000000000004', 'model.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000004f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000004d2', 1, 'cq-documents-private', 'raw/tenant-b/00000000000000000000000000000005', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, repeat('b', 64), pg_temp.rls_id('user_b'));
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000004f1' where id = '00000000-0000-4000-8000-0000000004d1';
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000004f2' where id = '00000000-0000-4000-8000-0000000004d2';

insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at, chunking_version) values
  ('00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004f1', 'evidence-processing-v1', 'COMPLETED', now(), now(), 'q-chunking-v1'),
  ('00000000-0000-4000-8000-0000000004a2', '00000000-0000-4000-8000-0000000004f2', 'evidence-processing-v1', 'COMPLETED', now(), now(), null);

insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-0000000004e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004a1', 1, 'ooxml_xlsx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/a/4f1/4a1-0000000000000001.json', repeat('c', 64), 512, 2, 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-0000000004e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000004d2', '00000000-0000-4000-8000-0000000004f2', '00000000-0000-4000-8000-0000000004a2', 1, 'ooxml_pptx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/b/4f2/4a2-0000000000000002.json', repeat('d', 64), 512, 3, 'organisation_private', 'CONFIDENTIAL');

-- Shape -----------------------------------------------------------------------------
select has_table('q_knowledge', 'chunk_sets', 'the chunk set table exists');
select has_table('q_knowledge', 'chunks', 'the chunk table exists');
select has_column('evidence', 'document_processing_runs', 'chunking_version', 'a processing run records which chunker it used');
-- CQ-RAG-003 added the embedding store; rls/350 covers it. What matters here
-- is that it stayed a separate table: a chunk is not a vector.
select has_table('q_knowledge', 'embeddings', 'embeddings live in their own table (CQ-RAG-003)');
select hasnt_column('q_knowledge', 'chunks', 'embedding', 'a chunk is not a vector');
select is((select relrowsecurity from pg_class where oid = 'q_knowledge.chunk_sets'::regclass), true, 'chunk_sets has RLS enabled');
select is((select relrowsecurity from pg_class where oid = 'q_knowledge.chunks'::regclass), true, 'chunks has RLS enabled');

-- A derived set with its chunks ---------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate)
  values ('00000000-0000-4000-8000-000000000451', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004e1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', 'ooxml_xlsx', '1.0.0', 'spreadsheet', 'q-chunking-v1', 'founder_private', 'RESTRICTED', 'ACTIVE', 2, 40)
$$, 'an active set for the current version is recorded');

select lives_ok($$
  insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
  values ('00000000-0000-4000-8000-000000000461', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-0000000004f1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', null, 0, 'PARENT', 'section', 'RAG-FOUNDER-PRIVATE-DO-NOT-LEAK parent', repeat('1', 64), 10, 0, 1, '{"sheet":"Revenue","range":"A1:C4"}', 'founder_private', 'RESTRICTED'),
         ('00000000-0000-4000-8000-000000000462', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-0000000004f1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', '00000000-0000-4000-8000-000000000461', 1, 'LEAF', 'spreadsheet_range', 'RAG-FOUNDER-PRIVATE-DO-NOT-LEAK leaf', repeat('2', 64), 30, 0, 0, '{"sheet":"Revenue","range":"A1:C4","rowStart":1,"rowEnd":4}', 'founder_private', 'RESTRICTED')
$$, 'a parent and its leaf are recorded with locators');

-- Invariants ----------------------------------------------------------------------------
select throws_ok($$
  insert into q_knowledge.chunk_sets (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004e1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', 'ooxml_xlsx', '1.0.0', 'spreadsheet', 'q-chunking-v2', 'founder_private', 'RESTRICTED', 'ACTIVE', 1, 10)
$$, '23505', null, 'one document has at most one ACTIVE chunk set');

select throws_ok($$
  insert into q_knowledge.chunk_sets (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, invalidated_at, chunk_count, token_estimate)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000004d1', '00000000-0000-4000-8000-0000000004f1', '00000000-0000-4000-8000-0000000004e1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', 'ooxml_xlsx', '1.0.0', 'spreadsheet', 'q-chunking-v1', 'founder_private', 'RESTRICTED', 'SUPERSEDED', now(), 1, 10)
$$, '23505', null, 'same version, same extraction, same chunker is one logical set');

select throws_ok($$
  insert into q_knowledge.chunk_sets (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, invalidated_at, chunk_count, token_estimate)
  values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000004d2', '00000000-0000-4000-8000-0000000004f2', '00000000-0000-4000-8000-0000000004e2', 'COMPANY', '00000000-0000-4000-8000-0000000004c2', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'organisation_private', 'CONFIDENTIAL', 'SUPERSEDED', now(), 1, 10)
$$, '23503', null, 'a tenant cannot derive a set from another tenant''s document');

select throws_ok($$
  insert into q_knowledge.chunks (tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-0000000004f1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', null, 2, 'LEAF', 'passage', 'wider than the source', repeat('3', 64), 5, 2, 2, '{}', 'public', 'RESTRICTED')
$$, '23514', null, 'the visibility vocabulary is closed (ADR-001 values only)');

select throws_ok($$
  insert into q_knowledge.chunks (tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-0000000004f1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', null, 1, 'LEAF', 'passage', 'duplicate index', repeat('4', 64), 5, 2, 2, '{}', 'founder_private', 'RESTRICTED')
$$, '23505', null, 'chunk order within a set is unique');

-- A parent is a chunk of the same set: a chunk from another set (and tenant) cannot be one.
insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, invalidated_at, chunk_count, token_estimate)
  values ('00000000-0000-4000-8000-000000000452', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000004d2', '00000000-0000-4000-8000-0000000004f2', '00000000-0000-4000-8000-0000000004e2', 'COMPANY', '00000000-0000-4000-8000-0000000004c2', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'organisation_private', 'CONFIDENTIAL', 'ACTIVE', null, 1, 10);
select throws_ok($$
  insert into q_knowledge.chunks (tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000452', '00000000-0000-4000-8000-0000000004f2', 'COMPANY', '00000000-0000-4000-8000-0000000004c2', '00000000-0000-4000-8000-000000000461', 0, 'LEAF', 'slide', 'RAG-CROSS-TENANT-DO-NOT-LEAK', repeat('6', 64), 5, 0, 0, '{"slide":1}', 'organisation_private', 'CONFIDENTIAL')
$$, '23503', null, 'a chunk in tenant B cannot name a tenant A chunk as its parent');

-- Immutability ------------------------------------------------------------------------
select throws_ok($$ update q_knowledge.chunks set content = 'rewritten' where id = '00000000-0000-4000-8000-000000000462' $$,
  '23514', null, 'chunk content is immutable');
select throws_ok($$ update q_knowledge.chunks set locator = '{"slide":9}' where id = '00000000-0000-4000-8000-000000000462' $$,
  '23514', null, 'chunk provenance is immutable');
select throws_ok($$ update q_knowledge.chunk_sets set chunking_version = 'q-chunking-v9' where id = '00000000-0000-4000-8000-000000000451' $$,
  '23514', null, 'a set''s chunking version is immutable');
select throws_ok($$ delete from q_knowledge.chunks where id = '00000000-0000-4000-8000-000000000462' $$,
  '23514', null, 'an active chunk cannot be deleted');
select throws_ok($$ update q_knowledge.chunk_sets set status = 'SUPERSEDED' where id = '00000000-0000-4000-8000-000000000451' $$,
  '23514', null, 'leaving ACTIVE requires an invalidation time');
select lives_ok($$
  update q_knowledge.chunk_sets set status = 'SUPERSEDED', status_reason = 'NEWER_CHUNKING_VERSION', invalidated_at = now() where id = '00000000-0000-4000-8000-000000000451';
  update q_knowledge.chunks set status = 'SUPERSEDED', invalidated_at = now() where chunk_set_id = '00000000-0000-4000-8000-000000000451'
$$, 'lifecycle columns may change');
select lives_ok($$ delete from q_knowledge.chunks where id = '00000000-0000-4000-8000-000000000462' $$,
  'a superseded chunk is rebuildable derived data and may be purged');

-- Exposure -----------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_knowledge.chunks $$, '42501', null, 'anonymous cannot read chunks');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_knowledge.chunks $$, '42501', null, 'a signed-in user cannot read chunks through the database');
select throws_ok($$ select * from q_knowledge.chunk_sets $$, '42501', null, 'a signed-in user cannot read chunk sets through the database');
select throws_ok($$ insert into q_knowledge.chunks (tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000451', '00000000-0000-4000-8000-0000000004f1', 'COMPANY', '00000000-0000-4000-8000-0000000004c1', 9, 'LEAF', 'passage', 'x', repeat('7', 64), 1, 0, 0, '{}', 'founder_private', 'RESTRICTED') $$,
  '42501', null, 'a signed-in user cannot write chunks');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from q_knowledge.chunks where tenant_id = pg_temp.rls_id('tenant_a') $$, '42501', null, 'tenant B cannot read tenant A chunks');

select pg_temp.act_as_privileged();
select is((select count(*)::int from q_knowledge.chunk_sets), 2, 'the server role reads every set');
select is((select count(*)::int from q_knowledge.chunks where content like '%DO-NOT-LEAK%'), 1, 'the server role reads the remaining chunk; application authorisation still decides who may see it');

select * from finish();
rollback;
