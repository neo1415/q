-- CQ-RAG-003 · q_knowledge.embeddings: a server-only, versioned vector store
-- whose rows cannot outlive, out-scope or contradict the chunk they encode.
--
--   chunk ≠ embedding ≠ evidence ≠ claim ≠ knowledge
--   nearest neighbour ≠ authorised neighbour;  vector presence ≠ permission
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
  ('00000000-0000-4000-8000-0000000005c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Vector Co A', 'vector-co-a'),
  ('00000000-0000-4000-8000-0000000005c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Vector Co B', 'vector-co-b');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000005d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000005c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck A', 'founder_private', 'RESTRICTED', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000005d2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000005c2', pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Deck B', 'organisation_private', 'CONFIDENTIAL', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000005f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000005d1', 1, 'cq-documents-private', 'raw/tenant-a/00000000000000000000000000000051', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000005f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000005d2', 1, 'cq-documents-private', 'raw/tenant-b/00000000000000000000000000000052', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, repeat('b', 64), pg_temp.rls_id('user_b'));
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000005f1' where id = '00000000-0000-4000-8000-0000000005d1';
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000005f2' where id = '00000000-0000-4000-8000-0000000005d2';

insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at, chunking_version) values
  ('00000000-0000-4000-8000-0000000005a1', '00000000-0000-4000-8000-0000000005f1', 'evidence-processing-v1', 'COMPLETED', now(), now(), 'q-chunking-v1'),
  ('00000000-0000-4000-8000-0000000005a2', '00000000-0000-4000-8000-0000000005f2', 'evidence-processing-v1', 'COMPLETED', now(), now(), 'q-chunking-v1');

insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-0000000005e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005a1', 1, 'ooxml_pptx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/a/5f1/5a1-0000000000000051.json', repeat('c', 64), 512, 2, 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-0000000005e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000005d2', '00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-0000000005a2', 1, 'ooxml_pptx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/b/5f2/5a2-0000000000000052.json', repeat('d', 64), 512, 2, 'organisation_private', 'CONFIDENTIAL');

insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate) values
  ('00000000-0000-4000-8000-000000000551', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000005d1', '00000000-0000-4000-8000-0000000005f1', '00000000-0000-4000-8000-0000000005e1', 'COMPANY', '00000000-0000-4000-8000-0000000005c1', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'founder_private', 'RESTRICTED', 'ACTIVE', 1, 10),
  ('00000000-0000-4000-8000-000000000552', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000005d2', '00000000-0000-4000-8000-0000000005f2', '00000000-0000-4000-8000-0000000005e2', 'COMPANY', '00000000-0000-4000-8000-0000000005c2', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'organisation_private', 'CONFIDENTIAL', 'ACTIVE', 1, 10);

insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-000000000561', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000551', '00000000-0000-4000-8000-0000000005f1', 'COMPANY', '00000000-0000-4000-8000-0000000005c1', 0, 'LEAF', 'slide', 'VECTOR-TENANT-A-PRIVATE-DO-NOT-LEAK', repeat('1', 64), 10, 0, 0, '{"slide":1}', 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-000000000562', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000552', '00000000-0000-4000-8000-0000000005f2', 'COMPANY', '00000000-0000-4000-8000-0000000005c2', 0, 'LEAF', 'slide', 'tenant b slide', repeat('2', 64), 10, 0, 0, '{"slide":1}', 'organisation_private', 'CONFIDENTIAL');

-- pgvector and shape -----------------------------------------------------------------
select is((select extname from pg_extension where extname = 'vector'), 'vector',
  'the vector extension is installed by migration, not by hand');
select has_table('q_knowledge', 'embeddings', 'the embedding store exists');
select is((select format_type(atttypid, atttypmod) from pg_attribute
            where attrelid = 'q_knowledge.embeddings'::regclass and attname = 'embedding'),
  'vector(1024)', 'embeddings are native pgvector at the configured dimension, never json or an array');
select is((select relrowsecurity from pg_class where oid = 'q_knowledge.embeddings'::regclass), true,
  'the embedding store has RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'q_knowledge' and tablename = 'embeddings'), 0,
  'and no policy: it is server-internal, never browser-reachable');
select hasnt_table('q_knowledge', 'query_embeddings', 'a query vector is request state, never a stored row');

-- A stored vector -----------------------------------------------------------------------
select lives_ok($$
  insert into q_knowledge.embeddings (id, tenant_id, chunk_id, provider_code, model_code, model_revision, configuration_version, instruction_version, embedding_dimension, embedding)
  values ('00000000-0000-4000-8000-000000000571', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', repeat('a', 40), 'capital-q-qwen3-embedding-0-6b-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, 'an embedding is stored for an active chunk');

-- Work identity and model coexistence -----------------------------------------------------
select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, model_revision, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', repeat('a', 40), 'capital-q-qwen3-embedding-0-6b-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, '23505', null, 'the same work identity cannot be stored twice: a retried worker collides');

select lives_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'another/embedding-model', 'capital-q-another-embedding-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.0625', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, 'a second model may embed the same chunk: migrations are a backfill, not a rewrite');

select is((select count(*)::int from q_knowledge.embeddings where chunk_id = '00000000-0000-4000-8000-000000000561'), 2,
  'both model versions coexist for one chunk');

-- Dimension and ownership ------------------------------------------------------------------
select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'short/model', 'capital-q-short-v1', 'none-v1', 1023,
          (select ('[' || string_agg('0.5', ',') || ']')::extensions.vector from generate_series(1, 1023)))
$$, '22000', null, 'a 1023-dimensional vector does not fit a 1024-dimensional store');

select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'lying/model', 'capital-q-lying-v1', 'none-v1', 768,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, '23514', null, 'the recorded dimension must equal the vector''s own: metadata cannot drift from payload');

select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000561', 'local-tei', 'wrong-tenant/model', 'capital-q-wrong-tenant-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, '23503', null, 'an embedding cannot claim a tenant its chunk does not have');

select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000009ff', 'local-tei', 'Qwen/Qwen3-Embedding-0.6B', 'capital-q-qwen3-embedding-0-6b-1024-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, '23503', null, 'a vector cannot dangle: it must encode a chunk that exists');

-- Immutability and lifecycle -----------------------------------------------------------------
select throws_ok($$
  update q_knowledge.embeddings
     set embedding = (select ('[' || string_agg('0.001', ',') || ']')::extensions.vector from generate_series(1, 1024))
   where id = '00000000-0000-4000-8000-000000000571'
$$, '23514', null, 'a stored vector is never edited; re-embedding means a new configuration');

select throws_ok($$
  update q_knowledge.embeddings set configuration_version = 'capital-q-other-v1' where id = '00000000-0000-4000-8000-000000000571'
$$, '23514', null, 'nor is its identity rewritten');

-- Revoking the chunk removes it from active retrieval without touching the vector row.
select lives_ok($$
  update q_knowledge.chunks set status = 'REVOKED', invalidated_at = now() where id = '00000000-0000-4000-8000-000000000561'
$$, 'the chunk can be revoked');

select is((select count(*)::int
             from q_knowledge.embeddings e
             join q_knowledge.chunks c on c.id = e.chunk_id and c.tenant_id = e.tenant_id
            where c.status = 'ACTIVE'), 0,
  'a revoked chunk''s embeddings are no longer eligible for active retrieval');

select is((select count(*)::int from q_knowledge.embeddings where chunk_id = '00000000-0000-4000-8000-000000000561'), 2,
  'the rows remain for provenance and rebuild: eligibility changed, history did not');

-- Purging a non-active chunk takes its derived vectors with it.
select lives_ok($$ delete from q_knowledge.chunks where id = '00000000-0000-4000-8000-000000000561' $$,
  'a non-active chunk may be purged as rebuildable derived data');
select is((select count(*)::int from q_knowledge.embeddings where chunk_id = '00000000-0000-4000-8000-000000000561'), 0,
  'and its embeddings go with it: no orphan vector outlives the chunk it encodes');

-- Exposure ---------------------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select * from q_knowledge.embeddings $$, '42501', null, 'anonymous cannot read vectors');

select pg_temp.act_as_user_a();
select throws_ok($$ select * from q_knowledge.embeddings $$, '42501', null, 'a signed-in user cannot read vectors through the database');
select throws_ok($$ select id from q_knowledge.embeddings limit 1 $$, '42501', null, 'not even an id: the store is server-internal');
select throws_ok($$
  insert into q_knowledge.embeddings (tenant_id, chunk_id, provider_code, model_code, configuration_version, instruction_version, embedding_dimension, embedding)
  values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000562', 'local-tei', 'x/y', 'capital-q-x-v1', 'none-v1', 1024,
          (select ('[' || string_agg('0.03125', ',') || ']')::extensions.vector from generate_series(1, 1024)))
$$, '42501', null, 'a signed-in user cannot write vectors');

select pg_temp.act_as_user_b();
select throws_ok($$ select * from q_knowledge.embeddings where tenant_id = pg_temp.rls_id('tenant_a') $$,
  '42501', null, 'tenant B cannot read tenant A vectors');

select * from finish();
rollback;
