-- Q room W3 (R3, 20261210091000): a document's text page by page.
--
-- A page is server-only (no browser principal reads it, own organisation
-- included), matches its extraction's document, owner, scope and
-- sensitivity, keeps honest offsets, is one row per page per extraction,
-- and is immutable.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the API reads a page only after the data room
-- authorised the person for that document).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(16);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000088c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Pages Co A', 'pages-co-a');

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000088d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000088c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Certificate', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000088d2', pg_temp.rls_id('tenant_b'), null, pg_temp.rls_id('org_b'), 'PITCH_DECK', 'Their deck', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000088f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000088d1', 1, 'cq-documents-private', 'raw/tenant-a/00000000000000000000000000008801', 'certificate.pdf', 'application/pdf', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-0000000088f2', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000088d2', 1, 'cq-documents-private', 'raw/tenant-b/00000000000000000000000000008802', 'deck.pdf', 'application/pdf', 2048, repeat('b', 64), pg_temp.rls_id('user_b'));

insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status) values
  ('00000000-0000-4000-8000-0000000088a1', '00000000-0000-4000-8000-0000000088f1', 'evidence-processing-v1', 'RUNNING'),
  ('00000000-0000-4000-8000-0000000088a2', '00000000-0000-4000-8000-0000000088f2', 'evidence-processing-v1', 'RUNNING');

insert into evidence.document_extractions
  (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id,
   schema_version, extractor_id, extractor_version, pipeline_version,
   artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, page_count,
   visibility_scope, sensitivity_class)
values
  ('00000000-0000-4000-8000-0000000088e1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'),
   '00000000-0000-4000-8000-0000000088d1', '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088a1',
   1, 'pdf', '1.0.0', 'evidence-processing-v1',
   'cq-extractions-private', 'extractions/tenant-a/v1/run-8801.json', repeat('c', 64), 4096, 4, 2,
   'organisation_private', 'CONFIDENTIAL'),
  ('00000000-0000-4000-8000-0000000088e2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'),
   '00000000-0000-4000-8000-0000000088d2', '00000000-0000-4000-8000-0000000088f2', '00000000-0000-4000-8000-0000000088a2',
   1, 'pdf', '1.0.0', 'evidence-processing-v1',
   'cq-extractions-private', 'extractions/tenant-b/v1/run-8802.json', repeat('d', 64), 4096, 1, 1,
   'organisation_private', 'CONFIDENTIAL');

-- Writing pages -------------------------------------------------------------------
select lives_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        1, 'Certificate of incorporation', 0, 28, 'organisation_private', 'CONFIDENTIAL'),
       (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        2, 'Statement of capital', 30, 50, 'organisation_private', 'CONFIDENTIAL') $$,
  'the pipeline writes one row per page of an extraction');
select lives_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values
       (pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), '00000000-0000-4000-8000-0000000088d2',
        '00000000-0000-4000-8000-0000000088f2', '00000000-0000-4000-8000-0000000088e2',
        1, 'Their page', 0, 10, 'organisation_private', 'CONFIDENTIAL') $$,
  'another tenant has its own pages');

select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        1, 'Again', 0, 5, 'organisation_private', 'CONFIDENTIAL') $$,
  '23505', null, 'one row per page per extraction');
select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        3, 'Page three', 60, 99, 'organisation_private', 'CONFIDENTIAL') $$,
  '23514', null, 'offsets must match the page text');
select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        0, 'Page zero', 0, 9, 'organisation_private', 'CONFIDENTIAL') $$,
  '23514', null, 'pages are numbered from 1');
select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        3, 'Wider', 0, 5, 'network_visible', 'CONFIDENTIAL') $$,
  '23514', null, 'a page is never more visible than its extraction');
select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e2',
        3, 'Cross', 0, 5, 'organisation_private', 'CONFIDENTIAL') $$,
  '23503', null, 'a page cannot name another tenant''s extraction');

select throws_ok(
  $$ update evidence.document_pages set text = 'Rewritten', char_end = 9
      where extraction_id = '00000000-0000-4000-8000-0000000088e1' and page_number = 1 $$,
  '23514', null, 'a page is immutable');
select throws_ok(
  $$ delete from evidence.document_pages where extraction_id = '00000000-0000-4000-8000-0000000088e1' $$,
  '23514', null, 'pages are never deleted');
select is(
  (select count(*)::int from evidence.document_pages
    where tenant_id = pg_temp.rls_id('tenant_a') and search @@ to_tsquery('simple', 'capital')),
  1, 'page text is searchable by words');

-- Browser principals -------------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from evidence.document_pages $$,
  '42501', null, 'anonymous cannot read pages');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.document_pages $$,
  '42501', null, 'an authenticated browser session cannot read pages, even its own organisation''s');
select throws_ok(
  $$ insert into evidence.document_pages
       (tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id,
        page_number, text, char_start, char_end, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), '00000000-0000-4000-8000-0000000088d1',
        '00000000-0000-4000-8000-0000000088f1', '00000000-0000-4000-8000-0000000088e1',
        4, 'Forged', 0, 6, 'organisation_private', 'CONFIDENTIAL') $$,
  '42501', null, 'a browser cannot write a page');

select pg_temp.act_as_user_b();
select throws_ok($$ select count(*) from evidence.document_pages $$,
  '42501', null, 'another tenant''s person cannot read pages');

select pg_temp.act_as_revoked_user();
select throws_ok($$ select count(*) from evidence.document_pages $$,
  '42501', null, 'a revoked user reads nothing');

select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.document_pages), 3,
  'the privileged server role reads the pages; DB privilege is not business authorisation');

select * from finish();
rollback;
