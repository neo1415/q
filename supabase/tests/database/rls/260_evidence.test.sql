-- CQ-EVD-001 · Evidence foundation: every evidence table is server-only,
-- document versions are immutable, claims change only through appended
-- revisions, and the same file hash in two tenants is two records.
--
-- EXPECTED DB BEHAVIOUR: the privileged server role can read every row.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: DB BYPASS ≠
-- BUSINESS AUTHORISATION.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(31);

-- Fixtures ------------------------------------------------------------------------
insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug) values
  ('00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'Evidence Co A', 'evidence-co-a'),
  ('00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'Evidence Co B', 'evidence-co-b');

insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, visibility_scope, sensitivity_class, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000e001', pg_temp.rls_id('tenant_a'), 'DOCUMENT', 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'Model A', 'organisation_private', 'HIGHLY_CONFIDENTIAL', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000e002', pg_temp.rls_id('tenant_b'), 'PUBLIC_WEB', 'COMPANY', '00000000-0000-4000-8000-0000000000c2', 'Site B', 'organisation_private', 'INTERNAL', pg_temp.rls_id('user_b'));

insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000d001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c1', pg_temp.rls_id('org_a'), 'FINANCIAL_MODEL', 'FY2026 Model', pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000d002', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('org_b'), 'FINANCIAL_MODEL', 'Their Model', pg_temp.rls_id('user_b'));

insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-00000000f001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 1, 'company-private', 'documents/d001/v1', 'model.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2048, repeat('a', 64), pg_temp.rls_id('user_a')),
  ('00000000-0000-4000-8000-00000000f002', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000d002', 1, 'company-private', 'documents/d002/v1', 'model.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 2048, repeat('a', 64), pg_temp.rls_id('user_b'));
update evidence.documents set current_version_id = '00000000-0000-4000-8000-00000000f001' where id = '00000000-0000-4000-8000-00000000d001';

insert into evidence.claims (id, tenant_id, subject_type, subject_id, claim_type, claim_key, statement, asserted_by_type, asserted_by_id, asserted_at, truth_class, evidence_status, current_revision_id) values
  ('00000000-0000-4000-8000-00000000a001', pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'metric', 'revenue.arr', 'ARR is 2M', 'USER', pg_temp.rls_id('user_a'), now(), 'USER_CLAIM', 'SELF_REPORTED', '00000000-0000-4000-8000-00000000b001');
insert into evidence.claim_revisions (id, tenant_id, claim_id, revision_number, statement, truth_class, evidence_status, lifecycle_status, changed_by_type, changed_by_id) values
  ('00000000-0000-4000-8000-00000000b001', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', 1, 'ARR is 2M', 'USER_CLAIM', 'SELF_REPORTED', 'CURRENT', 'USER', pg_temp.rls_id('user_a'));

insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, locator, evidence_status, visibility_scope, sensitivity_class) values
  ('00000000-0000-4000-8000-00000000e101', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e001', 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'financial.revenue', 'ARR line shows 2.0M', '{"kind":"document","documentVersionId":"00000000-0000-4000-8000-00000000f001","page":4}', 'DOCUMENT_SUPPORTED', 'organisation_private', 'HIGHLY_CONFIDENTIAL'),
  ('00000000-0000-4000-8000-00000000e102', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e001', 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'financial.revenue', 'Accounts show 1.4M', '{"kind":"document","documentVersionId":"00000000-0000-4000-8000-00000000f001","page":9}', 'DOCUMENT_SUPPORTED', 'organisation_private', 'HIGHLY_CONFIDENTIAL');

insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship) values
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000e101', 'SUPPORTS'),
  (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000e102', 'CONTRADICTS');

insert into evidence.document_processing_runs (document_version_id, pipeline_version) values
  ('00000000-0000-4000-8000-00000000f001', 'evidence-v1');

-- Shape and invariants ------------------------------------------------------------
select is((select count(*)::int from evidence.document_versions where sha256 = repeat('a', 64)), 2,
  'the same bytes in two tenants are two version records with separate ownership');
select is((select visibility_scope || '/' || sensitivity_class from evidence.documents where id = '00000000-0000-4000-8000-00000000d001'),
  'organisation_private/CONFIDENTIAL', 'a document defaults to organisation_private and CONFIDENTIAL');
select is((select lifecycle_status from evidence.claims where id = '00000000-0000-4000-8000-00000000a001'), 'CURRENT', 'a claim defaults to CURRENT');
select is((select count(*)::int from evidence.claim_evidence where claim_id = '00000000-0000-4000-8000-00000000a001'), 2,
  'supporting and contradicting evidence coexist on one claim');
select hasnt_column('evidence', 'claims', 'truth_state', 'no superseded doc-13 truth_state column');
select hasnt_column('evidence', 'claims', 'verification_state', 'no superseded doc-13 verification_state column');

select throws_ok(
  $$ insert into evidence.document_versions (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 1, 'company-private', 'documents/d001/dup', 'x.pdf', 'application/pdf', 1, repeat('b', 64), pg_temp.rls_id('user_a')) $$,
  '23505', null, 'version numbers are unique per document');
select throws_ok(
  $$ insert into evidence.document_versions (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 0, 'company-private', 'documents/d001/zero', 'x.pdf', 'application/pdf', 1, repeat('b', 64), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'version_number >= 1');
select throws_ok(
  $$ insert into evidence.document_versions (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, supersedes_version_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 2, 'company-private', 'documents/d001/v2', 'x.pdf', 'application/pdf', 1, repeat('b', 64), pg_temp.rls_id('user_a'), '00000000-0000-4000-8000-00000000f002') $$,
  '23503', null, 'a superseded version must belong to the same document');
select throws_ok(
  $$ insert into evidence.document_versions (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 3, 'company-private', 'documents/../escape', 'x.pdf', 'application/pdf', 1, repeat('b', 64), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'storage keys never traverse');
select throws_ok(
  $$ insert into evidence.document_versions (tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000d001', 3, 'company-private', 'documents/d001/v3', 'x.pdf', 'application/pdf', 1, repeat('B', 64), pg_temp.rls_id('user_a')) $$,
  '23514', null, 'sha256 is lowercase hex');
-- The pointer FK is deferred so a version insert and the pointer move can
-- share one transaction; checked immediately here to observe the refusal.
set constraints all immediate;
select throws_ok(
  $$ update evidence.documents set current_version_id = '00000000-0000-4000-8000-00000000f002' where id = '00000000-0000-4000-8000-00000000d001' $$,
  '23503', null, 'the current version pointer must point into the same document');
select throws_ok(
  $$ insert into evidence.documents (tenant_id, company_id, owner_organisation_id, title, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000000c2', pg_temp.rls_id('org_a'), 'Cross', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'a document cannot name a company from another tenant');
select throws_ok(
  $$ insert into evidence.documents (tenant_id, owner_organisation_id, title, created_by_user_id)
     values (pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_b'), 'Cross', pg_temp.rls_id('user_a')) $$,
  '23503', null, 'a document cannot be owned by an organisation outside its tenant');

-- Immutability -------------------------------------------------------------------
select throws_ok(
  $$ update evidence.document_versions set storage_key = 'documents/d001/moved' where id = '00000000-0000-4000-8000-00000000f001' $$,
  '23514', null, 'document version file identity is immutable');
select throws_ok(
  $$ update evidence.document_versions set sha256 = repeat('c', 64) where id = '00000000-0000-4000-8000-00000000f001' $$,
  '23514', null, 'a version hash never changes');
select throws_ok(
  $$ delete from evidence.document_versions where id = '00000000-0000-4000-8000-00000000f001' $$,
  '23514', null, 'document versions cannot be deleted');
select lives_ok(
  $$ update evidence.document_versions set malware_scan_status = 'CLEAN', processing_status = 'QUEUED' where id = '00000000-0000-4000-8000-00000000f001' $$,
  'processing state may evolve');
select throws_ok(
  $$ update evidence.claims set statement = 'rewritten' where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'a claim statement changes only through a new revision');
select throws_ok(
  $$ update evidence.claim_revisions set statement = 'rewritten' where id = '00000000-0000-4000-8000-00000000b001' $$,
  '23514', null, 'claim revisions are append-only');
select throws_ok(
  $$ delete from evidence.claims where id = '00000000-0000-4000-8000-00000000a001' $$,
  '23514', null, 'claims are never deleted');
select throws_ok(
  $$ insert into evidence.claims (tenant_id, subject_type, subject_id, claim_type, claim_key, statement, asserted_by_type, asserted_by_id, asserted_at, truth_class, evidence_status, current_revision_id)
     values (pg_temp.rls_id('tenant_a'), 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'metric', 'x', 'x', 'USER', pg_temp.rls_id('user_a'), now(), 'VERIFIED', 'SELF_REPORTED', gen_random_uuid()) $$,
  '23514', null, 'a VERIFIED claim needs verifying evidence');
select throws_ok(
  $$ insert into evidence.document_processing_runs (document_version_id, pipeline_version) values ('00000000-0000-4000-8000-00000000f001', 'evidence-v1') $$,
  '23505', null, 'one processing run per pipeline version per document version');
select throws_ok(
  $$ insert into evidence.claim_evidence (tenant_id, claim_id, evidence_item_id, relationship) values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000a001', '00000000-0000-4000-8000-00000000e101', 'SUPPORTS') $$,
  '23505', null, 'a claim-evidence relationship is linked once');
select throws_ok(
  $$ insert into evidence.evidence_items (tenant_id, source_id, subject_type, subject_id, evidence_type, summary, locator, evidence_status, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-00000000e001', 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'x', 'x', '{"path":"../secret"}', 'SELF_REPORTED', 'organisation_private', 'CONFIDENTIAL') $$,
  '23514', null, 'a locator must declare a known kind');

-- RLS: server-only -----------------------------------------------------------------
select pg_temp.act_as_anonymous();
select throws_ok($$ select count(*) from evidence.documents $$, '42501', null, 'anonymous cannot read documents');
select pg_temp.act_as_user_a();
select throws_ok($$ select count(*) from evidence.documents $$, '42501', null, 'an authenticated browser session cannot read documents, even its own organisation''s');
select throws_ok($$ select count(*) from evidence.claims $$, '42501', null, 'an authenticated browser session cannot read claims');
select throws_ok(
  $$ insert into evidence.sources (tenant_id, source_type, subject_type, subject_id, visibility_scope, sensitivity_class)
     values (pg_temp.rls_id('tenant_a'), 'USER_STATEMENT', 'COMPANY', '00000000-0000-4000-8000-0000000000c1', 'organisation_private', 'INTERNAL') $$,
  '42501', null, 'an authenticated browser session cannot write sources');
select pg_temp.act_as_privileged();
select is((select count(*)::int from evidence.documents), 2, 'the privileged server role reads every document (physical access, not authorisation)');
select is((select count(*)::int from evidence.claim_evidence), 2, 'the privileged server role reads every link');

select * from finish();
rollback;
