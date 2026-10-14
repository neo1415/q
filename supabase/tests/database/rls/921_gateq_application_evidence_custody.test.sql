-- Durable GateQ exchange and immutable submitted dossier boundary.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(16);
insert into core.investor_organisations (id, tenant_id, organisation_id, investor_type, display_name) values
  ('00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('tenant_b'), pg_temp.rls_id('org_b'), 'VC', 'Interview Capital');

insert into gateq.gateways (id, tenant_id, investor_organisation_id, organisation_id, public_id, name, created_by_user_id) values
  ('00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd01', pg_temp.rls_id('org_b'),
   'gq_23456789abcdefghjkmnpqrs01', 'Seed programme', pg_temp.rls_id('user_b'));

insert into gateq.gateway_versions
  (id, gateway_id, tenant_id, version_number, status, inbound_mode, public_title, qualification_policy_version,
   created_by_user_id, published_by_user_id, published_at)
values
  ('00000000-0000-4000-8000-00000000dd21', '00000000-0000-4000-8000-00000000dd11', pg_temp.rls_id('tenant_b'), 1,
   'PUBLISHED', 'QUALIFIED', 'Seed-stage fintech', 'gateq-qualification.v1',
   pg_temp.rls_id('user_b'), pg_temp.rls_id('user_b'), now());

insert into gateq.applications (id, tenant_id, gateway_id, gateway_version_id, public_reference) values
  ('00000000-0000-4000-8000-00000000dd31', pg_temp.rls_id('tenant_b'), '00000000-0000-4000-8000-00000000dd11',
   '00000000-0000-4000-8000-00000000dd21', 'ga_23456789abcdefghjkmnpqrs01');


insert into gateq.application_sessions (id,application_id,tenant_id,token_hash,expires_at) values
('00000000-0000-4000-8000-00000000dd41','00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_b'),repeat('a',64),now()+interval '14 days');
select lives_ok($$insert into evidence.documents(id,tenant_id,owner_kind,gateq_application_id,gateq_session_id,title,visibility_scope) values
('00000000-0000-4000-8000-00000000dd51',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000dd31','00000000-0000-4000-8000-00000000dd41','Guest pitch','personal_private')$$,'guest custody uses an actual application/session, without a user or organisation');
select is((select owner_organisation_id from evidence.documents where id='00000000-0000-4000-8000-00000000dd51'),null::uuid,'guest upload creates no organisation owner');
select throws_ok($$insert into evidence.documents(tenant_id,title,created_by_user_id) values(pg_temp.rls_id('tenant_b'),'Missing owner',pg_temp.rls_id('user_b'))$$,'23514',null,'organisation custody still requires a real organisation');
select throws_ok($$insert into evidence.documents(tenant_id,owner_kind,gateq_application_id,gateq_session_id,title,visibility_scope) values(pg_temp.rls_id('tenant_a'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000dd31','00000000-0000-4000-8000-00000000dd41','Wrong tenant','personal_private')$$,'23503',null,'guest custody cannot cross tenant boundary');
select throws_ok($$insert into evidence.documents(tenant_id,owner_kind,gateq_application_id,gateq_session_id,title,visibility_scope) values(pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000dd32','00000000-0000-4000-8000-00000000dd41','Wrong application','personal_private')$$,'23503',null,'session cannot name another application');
select throws_ok($$update evidence.documents set gateq_session_id=gen_random_uuid() where id='00000000-0000-4000-8000-00000000dd51'$$,'23514',null,'application custody is immutable');
select throws_ok($$update evidence.documents set visibility_scope='public_external' where id='00000000-0000-4000-8000-00000000dd51'$$,'23514',null,'guest custody cannot become public or organisation shared');
select lives_ok($$insert into evidence.document_versions(id,tenant_id,document_id,version_number,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,gateq_session_id) values
('00000000-0000-4000-8000-00000000dd61',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000dd51',1,'cq-documents-private','uploads/guest.pdf','pitch.pdf','application/pdf',128,repeat('b',64),'00000000-0000-4000-8000-00000000dd41')$$,'guest version binds custody without a fabricated uploader');
select throws_ok($$insert into evidence.document_versions(tenant_id,document_id,version_number,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by_user_id,gateq_session_id) values
(pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000dd51',2,'cq-documents-private','uploads/guest2.pdf','pitch.pdf','application/pdf',128,repeat('b',64),pg_temp.rls_id('user_b'),'00000000-0000-4000-8000-00000000dd41')$$,'23514',null,'guest version rejects invented user attribution');
select throws_ok($$update evidence.document_versions set gateq_session_id=null where id='00000000-0000-4000-8000-00000000dd61'$$,'23514',null,'version custody cannot change');
select is((select count(*)::int from information_schema.role_table_grants where table_schema='evidence' and table_name in ('documents','document_versions','document_upload_sessions','document_extractions','document_pages') and grantee in ('anon','authenticated')),0,'no browser grants added');
select is((select count(*)::int from pg_policies where schemaname='evidence' and tablename in ('documents','document_versions','document_upload_sessions','document_extractions','document_pages')),0,'no browser RLS policy added');
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='evidence' and c.relname in ('documents','document_versions','document_upload_sessions','document_extractions','document_pages') and c.relrowsecurity),5,'all custody-bearing canonical tables keep RLS');
select throws_ok($$delete from evidence.document_versions where id='00000000-0000-4000-8000-00000000dd61'$$,'23514',null,'file version identity remains immutable');
select is((select count(*)::int from evidence.documents where owner_organisation_id=pg_temp.rls_id('org_b') and id='00000000-0000-4000-8000-00000000dd51'),0,'guest custody is absent from receiving organisation document set');
select throws_ok($$insert into gateq.application_sessions(application_id,tenant_id,token_hash,expires_at) values('00000000-0000-4000-8000-00000000dd31',pg_temp.rls_id('tenant_a'),repeat('d',64),now()+interval '14 days')$$,'23503',null,'session itself cannot bind the application to another tenant');
select * from finish();
rollback;
