-- 20261231520000 · A8 D3: Q's reading of a document version for figures.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role records one reading per
-- version (status, attempts, a bounded failure code); no client role
-- reaches the table.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION (the job acts as the uploader, re-resolved).

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(9);

insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-00000000a8c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Readings Co A', 'readings-co-a');
insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000a8d1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a8c1', pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a'));
insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-00000000a8f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a8d1', 1, 'cq-documents-private', 'raw/tenant-a/000000000000000000000000000000a8', 'deck.pdf', 'application/pdf', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  -- A second version with no reading yet, so the cross-tenant case below
  -- meets the tenant foreign key, not the one-reading-per-version key.
  ('00000000-0000-4000-8000-00000000a8f2', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a8d1', 2, 'cq-documents-private', 'raw/tenant-a/000000000000000000000000000000a9', 'deck-2.pdf', 'application/pdf', 2048, repeat('b', 64), pg_temp.rls_id('user_a'));

select lives_ok(
  $$ insert into evidence.document_claim_readings (document_version_id, tenant_id, status)
     values ('00000000-0000-4000-8000-00000000a8f1', pg_temp.rls_id('tenant_a'), 'READING') $$,
  'the server records a reading for the version');
select throws_ok(
  $$ insert into evidence.document_claim_readings (document_version_id, tenant_id, status)
     values ('00000000-0000-4000-8000-00000000a8f1', pg_temp.rls_id('tenant_a'), 'READING') $$,
  '23505', null, 'one reading per version');
select throws_ok(
  $$ insert into evidence.document_claim_readings (document_version_id, tenant_id, status)
     values ('00000000-0000-4000-8000-00000000a8f2', pg_temp.rls_id('tenant_b'), 'READING') $$,
  '23503', null, 'a reading cannot name a version in another tenant');
select throws_ok(
  $$ update evidence.document_claim_readings set status = 'COMPLETED', error_code = 'SCHEMA_REFUSED'
      where document_version_id = '00000000-0000-4000-8000-00000000a8f1' $$,
  '23514', null, 'a completed reading carries no failure code');
select throws_ok(
  $$ update evidence.document_claim_readings set status = 'FAILED', error_code = 'free text from a model'
      where document_version_id = '00000000-0000-4000-8000-00000000a8f1' $$,
  '23514', null, 'a failure code is a bounded code, never free text');
select is((select relrowsecurity from pg_class where oid = 'evidence.document_claim_readings'::regclass),
  true, 'row level security is on');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where grantee in ('anon', 'authenticated') and table_schema = 'evidence'
      and table_name = 'document_claim_readings'),
  0, 'no client role holds any privilege on readings');

select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.document_claim_readings $$, '42501', null,
  'a founder cannot read the job''s readings directly');
select pg_temp.act_as_anonymous();
select throws_ok($$ insert into evidence.document_claim_readings (document_version_id, tenant_id, status)
  values ('00000000-0000-4000-8000-00000000a8f1', pg_temp.rls_id('tenant_a'), 'COMPLETED') $$, '42501', null,
  'an anonymous visitor cannot write a reading');

select * from finish();
rollback;
