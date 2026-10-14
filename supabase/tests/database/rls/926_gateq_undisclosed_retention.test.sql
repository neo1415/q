-- Never-disclosed leftovers may expire after Submit; frozen sources may not.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(11);
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


insert into evidence.document_processing_runs(id,document_version_id,pipeline_version,status,completed_at) values
('00000000-0000-4000-8000-00000000ee71','00000000-0000-4000-8000-00000000ee61','retention-v1','COMPLETED',now()),
('00000000-0000-4000-8000-00000000ee73','00000000-0000-4000-8000-00000000ee63','retention-v1','COMPLETED',now());
insert into evidence.document_extractions(id,tenant_id,document_id,document_version_id,processing_run_id,schema_version,extractor_id,extractor_version,pipeline_version,artifact_bucket,artifact_key,artifact_sha256,artifact_bytes,block_count,page_count,visibility_scope,sensitivity_class) values
('00000000-0000-4000-8000-00000000ee81',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61','00000000-0000-4000-8000-00000000ee71',1,'pdf','1.0.0','retention-v1','cq-extractions-private','extractions/retention/frozen.json',repeat('a',64),128,1,1,'personal_private','CONFIDENTIAL'),
('00000000-0000-4000-8000-00000000ee83',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee53','00000000-0000-4000-8000-00000000ee63','00000000-0000-4000-8000-00000000ee73',1,'pdf','1.0.0','retention-v1','cq-extractions-private','extractions/retention/private.json',repeat('c',64),128,1,1,'personal_private','CONFIDENTIAL');
insert into evidence.document_pages(tenant_id,document_id,document_version_id,extraction_id,page_number,text,char_start,char_end,visibility_scope,sensitivity_class) values
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61','00000000-0000-4000-8000-00000000ee81',1,'Frozen',0,6,'personal_private','CONFIDENTIAL'),
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee53','00000000-0000-4000-8000-00000000ee63','00000000-0000-4000-8000-00000000ee83',1,'Private',0,7,'personal_private','CONFIDENTIAL');
insert into evidence.document_upload_sessions(tenant_id,document_id,gateq_application_id,gateq_session_id,guest_idempotency_hash,guest_request_hash,storage_bucket,storage_key,original_filename,declared_mime_type,declared_size_bytes,authorising_capability,expires_at,status,document_version_id,finalized_at,provider_authorization_state,provider_authorization_expires_at) values
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee41',repeat('a',64),repeat('b',64),'cq-documents-private','uploads/ready.pdf','ready.pdf','application/pdf',128,'gateq.application.upload',now()+interval '10 minutes','COMPLETED','00000000-0000-4000-8000-00000000ee61',now(),'KNOWN',now()-interval '1 day'),
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee53','00000000-0000-4000-8000-00000000ee32','00000000-0000-4000-8000-00000000ee42',repeat('c',64),repeat('d',64),'cq-documents-private','uploads/other.pdf','other.pdf','application/pdf',128,'gateq.application.upload',now()+interval '10 minutes','COMPLETED','00000000-0000-4000-8000-00000000ee63',now(),'KNOWN',now()-interval '1 day');
insert into evidence.gateq_application_document_disclosures(tenant_id,application_id,document_id,document_version_id,sha256) values
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee51','00000000-0000-4000-8000-00000000ee61',repeat('b',64));
update gateq.application_sessions set created_at=now()-interval '15 days',expires_at=now()-interval '1 day' where application_id in ('00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee32');
update gateq.applications set status='SUBMITTED',submitted_at=now() where id in ('00000000-0000-4000-8000-00000000ee31','00000000-0000-4000-8000-00000000ee32');
select throws_ok($$update evidence.documents set status='ARCHIVED',custody_cleanup_started_at=now(),custody_deleted_at=now() where id='00000000-0000-4000-8000-00000000ee51'$$,'23514',null,'frozen source version cannot be archived for retention');
select throws_ok($$delete from evidence.document_pages where document_id='00000000-0000-4000-8000-00000000ee51'$$,'23514',null,'submitted frozen pages remain immutable');
select lives_ok($$update evidence.documents set status='ARCHIVED',custody_cleanup_started_at=now(),custody_deleted_at=now() where id='00000000-0000-4000-8000-00000000ee53'$$,'never-disclosed leftover records a retention tombstone after Submit');
select throws_ok($$update evidence.document_pages set text='Changed',char_end=7 where document_id='00000000-0000-4000-8000-00000000ee53'$$,'23514',null,'retention exception never permits rewriting private page text');
select lives_ok($$delete from evidence.document_pages where document_id='00000000-0000-4000-8000-00000000ee53'$$,'only expired never-disclosed guest pages may be erased after recorded deletion');
select is((select count(*)::int from evidence.document_versions where id='00000000-0000-4000-8000-00000000ee63'),1,'immutable version identity and provenance remain after private text erasure');
select ok((select custody_deleted_at is not null from evidence.documents where id='00000000-0000-4000-8000-00000000ee53'),'deletion is recorded rather than silent');
select throws_ok($$insert into evidence.document_processing_runs(document_version_id,pipeline_version) values('00000000-0000-4000-8000-00000000ee63','retention-v2')$$,'23514',null,'no new processor can revive expired guest custody');
select throws_ok($$update evidence.document_processing_runs set status='RUNNING' where id='00000000-0000-4000-8000-00000000ee73'$$,'23514',null,'a terminal processor cannot restart after retention');
select throws_ok($$insert into evidence.document_pages(tenant_id,document_id,document_version_id,extraction_id,page_number,text,char_start,char_end,visibility_scope,sensitivity_class) values(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000ee53','00000000-0000-4000-8000-00000000ee63','00000000-0000-4000-8000-00000000ee83',2,'Private',0,7,'personal_private','CONFIDENTIAL')$$,'23514',null,'late extraction cannot restore expired private pages');
select ok(not has_function_privilege('authenticated','evidence.guard_application_processing_retention()','execute'),'processing admission guard is not a browser capability');
select * from finish();
rollback;
