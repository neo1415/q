-- Actual provider lifetime/claim state protects cleanup and quota release.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(12);
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

insert into evidence.documents(id,tenant_id,owner_kind,gateq_application_id,gateq_session_id,title,visibility_scope) values
('00000000-0000-4000-8000-00000000dd51',pg_temp.rls_id('tenant_b'),'GATEQ_APPLICATION','00000000-0000-4000-8000-00000000dd31','00000000-0000-4000-8000-00000000dd41','Guest pitch','personal_private');
insert into evidence.document_upload_sessions(id,tenant_id,document_id,gateq_application_id,gateq_session_id,guest_idempotency_hash,guest_request_hash,storage_bucket,storage_key,original_filename,declared_mime_type,declared_size_bytes,authorising_capability,expires_at) values
('00000000-0000-4000-8000-00000000dd71',pg_temp.rls_id('tenant_b'),'00000000-0000-4000-8000-00000000dd51','00000000-0000-4000-8000-00000000dd31','00000000-0000-4000-8000-00000000dd41',repeat('b',64),repeat('c',64),'cq-documents-private','uploads/provider-expiry.pdf','pitch.pdf','application/pdf',1,'gateq.application.upload',now()+interval '10 minutes');
select ok((select evidence.gateq_upload_authorization_retired(u) from evidence.document_upload_sessions u where id='00000000-0000-4000-8000-00000000dd71'),'provably unissued ticket needs no guessed token lifetime');
select throws_ok($$update evidence.document_upload_sessions set provider_authorization_state='KNOWN' where id='00000000-0000-4000-8000-00000000dd71'$$,'23514',null,'known authorization requires actual expiry');
select throws_ok($$update evidence.document_upload_sessions set provider_authorization_state='PENDING' where id='00000000-0000-4000-8000-00000000dd71'$$,'23514',null,'pending authorization requires fenced claim and start time');
update evidence.document_upload_sessions set provider_authorization_state='KNOWN',provider_authorization_expires_at=now()+interval '2 hours' where id='00000000-0000-4000-8000-00000000dd71';
select ok(not (select evidence.gateq_upload_authorization_retired(u) from evidence.document_upload_sessions u where id='00000000-0000-4000-8000-00000000dd71'),'application-side expiry cannot retire a still-valid provider token');
select throws_ok($$update evidence.document_upload_sessions set provider_authorization_expires_at=now()+interval '1 hour' where id='00000000-0000-4000-8000-00000000dd71'$$,'23514',null,'re-sign cannot shorten any earlier token lifetime');
select throws_ok($$update evidence.document_upload_sessions set provider_authorization_expires_at=null where id='00000000-0000-4000-8000-00000000dd71'$$,'23514',null,'known expiry cannot silently become unknown');
select lives_ok($$update evidence.document_upload_sessions set provider_authorization_expires_at=now()+interval '3 hours' where id='00000000-0000-4000-8000-00000000dd71'$$,'longer issued token lifetime may extend cleanup protection');
update evidence.document_upload_sessions set provider_authorization_state='UNKNOWN' where id='00000000-0000-4000-8000-00000000dd71';
select ok(not (select evidence.gateq_upload_authorization_retired(u) from evidence.document_upload_sessions u where id='00000000-0000-4000-8000-00000000dd71'),'unknown newer token retains debt even with an older known expiry');
update evidence.document_upload_sessions set provider_authorization_state='UNKNOWN_PENDING',provider_authorization_claim_id='00000000-0000-4000-8000-00000000dd81',provider_authorization_claimed_at=now() where id='00000000-0000-4000-8000-00000000dd71';
select ok(not (select evidence.gateq_upload_authorization_retired(u) from evidence.document_upload_sessions u where id='00000000-0000-4000-8000-00000000dd71'),'in-flight re-sign preserves prior uncertainty');
select ok(evidence.gateq_upload_authorization_retired(jsonb_populate_record(null::evidence.document_upload_sessions,jsonb_build_object('gateq_application_id','00000000-0000-4000-8000-00000000dd31','provider_authorization_state','KNOWN','provider_authorization_expires_at',now()-interval '1 second'))),'actual elapsed provider lifetime permits cleanup');
select ok(not evidence.gateq_upload_authorization_retired(jsonb_populate_record(null::evidence.document_upload_sessions,jsonb_build_object('gateq_application_id','00000000-0000-4000-8000-00000000dd31','provider_authorization_state','UNKNOWN'))),'unknown legacy ticket never receives a guessed expiry');
select ok(not has_function_privilege('anon','evidence.gateq_upload_authorization_retired(evidence.document_upload_sessions)','execute'),'anonymous callers cannot use internal authorization-lifetime projection');
select * from finish();
rollback;
