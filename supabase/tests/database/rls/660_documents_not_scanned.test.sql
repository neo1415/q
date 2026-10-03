-- ADR 0042 (founder decision 2026-10-03) · evidence.document_versions.
-- malware_scan_status gains NOT_SCANNED: processed with no scanner under the
-- explicit interim policy. Additive: the earlier values still hold, an
-- unknown value is still refused, and the default stays PENDING.
--
-- EXPECTED DB BEHAVIOUR: the column accepts exactly the five values.
-- APPLICATION SESSION AUTHORISATION IS STILL REQUIRED: who may download a
-- NOT_SCANNED version is decided by the server, from the same audiences.

begin;

create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();

select plan(5);

insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, created_by_user_id) values
  ('00000000-0000-4000-8000-0000000066d1', pg_temp.rls_id('tenant_a'), pg_temp.rls_id('org_a'), 'PITCH_DECK', 'Deck', pg_temp.rls_id('user_a'));
insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id) values
  ('00000000-0000-4000-8000-0000000066f1', pg_temp.rls_id('tenant_a'), '00000000-0000-4000-8000-0000000066d1', 1, 'company-private', 'documents/66d1/v1', 'deck.pdf', 'application/pdf', 613, repeat('a', 64), pg_temp.rls_id('user_a'));

select is((select malware_scan_status from evidence.document_versions where id = '00000000-0000-4000-8000-0000000066f1'),
  'PENDING', 'a new version is PENDING by default, never NOT_SCANNED or CLEAN');
select lives_ok(
  $$ update evidence.document_versions set malware_scan_status = 'NOT_SCANNED' where id = '00000000-0000-4000-8000-0000000066f1' $$,
  'NOT_SCANNED is an accepted status');
select lives_ok(
  $$ update evidence.document_versions set malware_scan_status = 'CLEAN' where id = '00000000-0000-4000-8000-0000000066f1' $$,
  'CLEAN is still accepted (a scanner verdict)');
select throws_ok(
  $$ update evidence.document_versions set malware_scan_status = 'SCANNED_OK' where id = '00000000-0000-4000-8000-0000000066f1' $$,
  '23514', null, 'an unknown status is refused');
select is((select count(*)::int from evidence.document_versions where malware_scan_status not in ('PENDING', 'CLEAN', 'BLOCKED', 'ERROR', 'NOT_SCANNED')),
  0, 'no row holds a value outside the five');

select * from finish();
rollback;
