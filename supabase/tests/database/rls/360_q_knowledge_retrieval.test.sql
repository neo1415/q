-- CQ-RAG-004 · the lexical half of hybrid retrieval: a derived index that
-- cannot drift from the text it describes, and a sensitivity ordering that
-- means the same thing in SQL as it does in TypeScript.
--
--   exact match ≠ permission;  lexical rank ≠ authority ≠ confidence
--   an index over private text is private
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(22);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000006c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Lexical Co A', 'lexical-co-a'),
  ('00000000-0000-4000-8000-0000000006c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Lexical Co B', 'lexical-co-b');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000006d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000006c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck A', 'founder_private', 'RESTRICTED', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000006d2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000006c2', pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Deck B', 'organisation_private', 'CONFIDENTIAL', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000006f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000006d1', 1, 'cq-documents-private', 'raw/tenant-a/00000000000000000000000000000061', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000006f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000006d2', 1, 'cq-documents-private', 'raw/tenant-b/00000000000000000000000000000062', 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, repeat('b', 64), pg_temp.rls_id('user_b'));
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000006f1' where id = '00000000-0000-4000-8000-0000000006d1';
update evidence.documents set current_version_id = '00000000-0000-4000-8000-0000000006f2' where id = '00000000-0000-4000-8000-0000000006d2';

insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at, chunking_version) values
  ('00000000-0000-4000-8000-0000000006a1', '00000000-0000-4000-8000-0000000006f1', 'evidence-processing-v1', 'COMPLETED', now(), now(), 'q-chunking-v1'),
  ('00000000-0000-4000-8000-0000000006a2', '00000000-0000-4000-8000-0000000006f2', 'evidence-processing-v1', 'COMPLETED', now(), now(), 'q-chunking-v1');

insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-0000000006e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000006d1', '00000000-0000-4000-8000-0000000006f1', '00000000-0000-4000-8000-0000000006a1', 1, 'ooxml_pptx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/a/6f1/6a1-0000000000000061.json', repeat('c', 64), 512, 2, 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-0000000006e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000006d2', '00000000-0000-4000-8000-0000000006f2', '00000000-0000-4000-8000-0000000006a2', 1, 'ooxml_pptx', '1.0.0', 'evidence-processing-v1', 'cq-extractions-private', 'extractions/b/6f2/6a2-0000000000000062.json', repeat('d', 64), 512, 2, 'organisation_private', 'CONFIDENTIAL');

insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate) values
  ('00000000-0000-4000-8000-000000000651', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000006d1', '00000000-0000-4000-8000-0000000006f1', '00000000-0000-4000-8000-0000000006e1', 'COMPANY', '00000000-0000-4000-8000-0000000006c1', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'founder_private', 'RESTRICTED', 'ACTIVE', 1, 10),
  ('00000000-0000-4000-8000-000000000652', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000006d2', '00000000-0000-4000-8000-0000000006f2', '00000000-0000-4000-8000-0000000006e2', 'COMPANY', '00000000-0000-4000-8000-0000000006c2', 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'organisation_private', 'CONFIDENTIAL', 'ACTIVE', 1, 10);

insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-000000000661', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-000000000651', '00000000-0000-4000-8000-0000000006f1', 'COMPANY', '00000000-0000-4000-8000-0000000006c1', 0, 'LEAF', 'slide', 'Northstar completed SOC 2 Type II and reports 1.4m ARR with Apex Ventures leading the seed round. RAG-FOUNDER-PRIVATE-DO-NOT-LEAK', repeat('1', 64), 10, 0, 0, '{"slide":1}', 'founder_private', 'RESTRICTED'),
  ('00000000-0000-4000-8000-000000000662', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-000000000652', '00000000-0000-4000-8000-0000000006f2', 'COMPANY', '00000000-0000-4000-8000-0000000006c2', 0, 'LEAF', 'slide', 'tenant b slide', repeat('2', 64), 10, 0, 0, '{"slide":1}', 'organisation_private', 'CONFIDENTIAL');

-- The lexical representation -------------------------------------------------------
select has_column('q_knowledge', 'chunks', 'content_tsv', 'chunks carry a lexical representation');
select is((select format_type(atttypid, atttypmod) from pg_attribute
            where attrelid = 'q_knowledge.chunks'::regclass and attname = 'content_tsv'),
  'tsvector', 'it is a native tsvector, not text and not an application-built string');
select is((select attgenerated from pg_attribute
            where attrelid = 'q_knowledge.chunks'::regclass and attname = 'content_tsv'),
  's', 'it is a STORED generated column, so it cannot disagree with the content it describes');

select isnt_empty($$
  select 1 from q_knowledge.chunks
   where id = '00000000-0000-4000-8000-000000000661'
     and content_tsv @@ to_tsquery('english', 'soc & ''2''')
$$, 'an acronym survives the english configuration as a searchable lexeme');

select isnt_empty($$
  select 1 from q_knowledge.chunks
   where id = '00000000-0000-4000-8000-000000000661'
     and content_tsv @@ to_tsquery('english', 'arr')
$$, 'a financial metric survives as a searchable lexeme');

select isnt_empty($$
  select 1 from q_knowledge.chunks
   where id = '00000000-0000-4000-8000-000000000661'
     and content_tsv @@ phraseto_tsquery('english', 'Apex Ventures')
$$, 'an investor name survives as an adjacent phrase');

-- The generated column tracks content by construction ------------------------------
select throws_ok($$
  update q_knowledge.chunks set content_tsv = to_tsvector('english', 'anything')
   where id = '00000000-0000-4000-8000-000000000661'
$$, '428C9', null, 'the lexical column cannot be written directly: it is derived, never asserted');

-- The index ------------------------------------------------------------------------
select is((select amname from pg_class c join pg_am a on a.oid = c.relam
            where c.relname = 'chunks_content_tsv_idx'),
  'gin', 'the lexical index is a GIN index over the generated column');
select has_index('q_knowledge', 'chunks', 'chunks_tenant_active_lexical_idx',
  'the security prefilter has its own index, so authorisation narrows the scan');

-- Sensitivity ordering -------------------------------------------------------------
select is(q_knowledge.sensitivity_rank('PUBLIC'), 1, 'PUBLIC is the weakest class');
select is(q_knowledge.sensitivity_rank('RESTRICTED'), 6, 'RESTRICTED is the strongest class');
select ok(q_knowledge.sensitivity_rank('CONFIDENTIAL') < q_knowledge.sensitivity_rank('RESTRICTED'),
  'the order is by policy, not alphabetical: string comparison would put RESTRICTED below CONFIDENTIAL');
select is(q_knowledge.sensitivity_rank('NOT_A_CLASS'), null,
  'an unknown class has no rank, so a ceiling comparison against it is null and admits nothing');
select is((select provolatile from pg_proc where proname = 'sensitivity_rank'
            and pronamespace = 'q_knowledge'::regnamespace), 'i',
  'the ordering is immutable, so it can be trusted inside an index or a generated expression');
select is((select proconfig from pg_proc where proname = 'sensitivity_rank'
            and pronamespace = 'q_knowledge'::regnamespace), array['search_path=""'],
  'and it pins an empty search_path, so no schema on the caller path can redefine what it calls');

-- The ceiling actually excludes ----------------------------------------------------
select is_empty($$
  select 1 from q_knowledge.chunks
   where id = '00000000-0000-4000-8000-000000000661'
     and q_knowledge.sensitivity_rank(sensitivity_class)
         <= q_knowledge.sensitivity_rank('CONFIDENTIAL')
$$, 'a RESTRICTED chunk is outside a CONFIDENTIAL ceiling');

-- No new surface -------------------------------------------------------------------
select hasnt_table('q_knowledge', 'retrieval_cache',
  'no retrieval cache exists: a cached private result is a permission decision with a stale key');
select hasnt_table('q_knowledge', 'retrieval_results',
  'a retrieval result is request state, never a stored row');
select is((select count(*)::int from pg_proc
            where pronamespace = 'q_knowledge'::regnamespace and prosecdef), 0,
  'no SECURITY DEFINER function exists in q_knowledge: nothing here runs with more authority than its caller');

-- An index over private text is private --------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select content_tsv from q_knowledge.chunks $$,
  '42501', null, 'the browser cannot read the lexical index any more than the text');

select pg_temp.act_as_user_b();
select throws_ok($$
  select 1 from q_knowledge.chunks
   where content_tsv @@ to_tsquery('english', 'soc')
$$, '42501', null, 'a signed-in user cannot search another tenant''s chunks directly');

select is((select count(*)::int from pg_policies
            where schemaname = 'q_knowledge' and tablename = 'chunks'), 0,
  'chunks remain server-internal: retrieval authorisation is the Context Firewall''s, applied in the query');

select * from finish();
rollback;
