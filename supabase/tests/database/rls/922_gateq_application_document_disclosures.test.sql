-- ADR 0067 §5: submitted GateQ document disclosures are exact, owned and immutable.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(13);

insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Disclosure Capital');
insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs02', 'Seed programme', pg_temp.rls_id('user_b'));
insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000ee21', '00000000-0000-4000-8000-00000000ee11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());
insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000ee31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_23456789abcdefghjkmnpqrs11'),
  ('00000000-0000-4000-8000-00000000ee32', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000ee11',
   '00000000-0000-4000-8000-00000000ee21', 'ga_23456789abcdefghjkmnpqrs12');
insert into gateq.application_sessions (id,application_id,tenant_id,token_hash,expires_at) values
  ('00000000-0000-4000-8000-00000000ee41','00000000-0000-4000-8000-00000000ee31',pg_temp.rls_id('tenant_b'),repeat('7',64),now()+interval '14 days'),
  ('00000000-0000-4000-8000-00000000ee42','00000000-0000-4000-8000-00000000ee32',pg_temp.rls_id('tenant_b'),repeat('8',64),now()+interval '14 days');

-- ee51: application ee31's ready document. ee52: ee31's unprocessed one.
-- ee53: application ee32's ready document. ee54: ee31's, never disclosed.
insert into evidence.documents(id,tenant_id,owner_kind,gateq_application_id,gateq_session_id,title,visibility_scope) values
  ('00000000-0000-4000-8000-00000000ee51',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee41','Ready deck','personal_private'),
  ('00000000-0000-4000-8000-00000000ee52',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee41','Pending deck','personal_private'),
  ('00000000-0000-4000-8000-00000000ee53',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000ee32','00000000-0000-4000-8000-00000000ee42','Other deck','personal_private'),
  ('00000000-0000-4000-8000-00000000ee54',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee41','Removed deck','personal_private');
insert into evidence.document_versions(id,tenant_id,document_id,version_number,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,gateq_session_id,processing_status,malware_scan_status,text_extraction_status) values
  ('00000000-0000-4000-8000-00000000ee61',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee51',1,'cq-documents-private','uploads/ready.pdf','ready.pdf','application/pdf',128,repeat('b',64),'00000000-0000-4000-8000-00000000ee41','COMPLETED','NOT_SCANNED','COMPLETED'),
  ('00000000-0000-4000-8000-00000000ee62',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee52',1,'cq-documents-private','uploads/pending.pdf','pending.pdf','application/pdf',128,repeat('c',64),'00000000-0000-4000-8000-00000000ee41','PROCESSING','PENDING','PROCESSING'),
  ('00000000-0000-4000-8000-00000000ee63',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee53',1,'cq-documents-private','uploads/other.pdf','other.pdf','application/pdf',128,repeat('d',64),'00000000-0000-4000-8000-00000000ee42','COMPLETED','CLEAN','COMPLETED');
update evidence.documents set current_version_id='00000000-0000-4000-8000-00000000ee61' where id='00000000-0000-4000-8000-00000000ee51';
update evidence.documents set current_version_id='00000000-0000-4000-8000-00000000ee62' where id='00000000-0000-4000-8000-00000000ee52';
update evidence.documents set current_version_id='00000000-0000-4000-8000-00000000ee63' where id='00000000-0000-4000-8000-00000000ee53';

select throws_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61',repeat('b',64))$$,
  '23514',null,'a NOT_SCANNED version stays founder-only and is never disclosed to an investor');
update evidence.document_versions set malware_scan_status='CLEAN' where id='00000000-0000-4000-8000-00000000ee61';
select lives_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61',repeat('b',64))$$,
  'an application discloses its own current, processed, scanned-clean version');
select throws_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee53','00000000-0000-4000-8000-00000000ee63',repeat('d',64))$$,
  '23514',null,'an application cannot disclose another application''s document');
select throws_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee52','00000000-0000-4000-8000-00000000ee62',repeat('c',64))$$,
  '23514',null,'a version still processing cannot be disclosed');
select throws_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee52','00000000-0000-4000-8000-00000000ee61',repeat('b',64))$$,
  '23514',null,'a version cannot be disclosed under a different document');
select throws_ok($$insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
  (pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61',repeat('b',64))$$,
  '23514',null,'a disclosure cannot cross the tenant boundary');
select throws_ok($$update evidence.gateq_application_document_disclosures set sha256=repeat('e',64) where document_id='00000000-0000-4000-8000-00000000ee51'$$,
  '23514',null,'a disclosure cannot be rewritten');
select throws_ok($$delete from evidence.gateq_application_document_disclosures where document_id='00000000-0000-4000-8000-00000000ee51'$$,
  '23514',null,'a disclosure cannot be withdrawn');
select throws_ok($$update evidence.documents set status='ARCHIVED' where id='00000000-0000-4000-8000-00000000ee51'$$,
  '23514',null,'a disclosed document cannot be removed from the submission');
select lives_ok($$update evidence.documents set status='ARCHIVED' where id='00000000-0000-4000-8000-00000000ee54'$$,
  'an undisclosed application document can still be removed before submit');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='evidence' and table_name='gateq_application_document_disclosures' and grantee in ('anon','authenticated')),0,'no browser grants on disclosures');
select is((select count(*)::int from pg_policies where schemaname='evidence' and tablename='gateq_application_document_disclosures'),0,'no browser RLS policy on disclosures');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='evidence' and c.relname='gateq_application_document_disclosures'),'disclosures keep RLS on');
select * from finish();
rollback;
