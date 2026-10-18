-- Canonical claim revision UUIDs and permission-safe historical audit.
begin;
create extension if not exists pgtap with schema extensions;
\ir support/fixture.psql
select pg_temp.rls_setup();
select plan(27);
insert into core.companies(id,tenant_id,organisation_id,canonical_name,slug,current_stage_code,short_description,marketplace_visibility)
values('00000000-0000-4000-8000-000000009bc1',pg_temp.rls_id('tenant_a'),pg_temp.rls_id('org_a'),'Structured source proof','structured-source-proof','seed','Test','network_visible');
insert into evidence.claims(id,tenant_id,subject_type,subject_id,claim_type,claim_key,statement,structured_value,asserted_by_type,asserted_by_id,asserted_at,truth_class,evidence_status,lifecycle_status,visibility_scope,current_revision_id)
values('00000000-0000-4000-8000-000000009bc2',pg_temp.rls_id('tenant_a'),'COMPANY','00000000-0000-4000-8000-000000009bc1','test','unicorn.structured','Annual recurring revenue reached one million','{"value":1000000}','SYSTEM',pg_temp.rls_id('user_a'),'2026-10-17T00:00:00Z','USER_CLAIM','SELF_REPORTED','CURRENT','network_visible','00000000-0000-4000-8000-000000009bc3');
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id)
values('00000000-0000-4000-8000-000000009bc3',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',1,'Annual recurring revenue reached one million','{"value":1000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'));
create temp table unicorn_structured_candidate(value jsonb);
insert into unicorn_structured_candidate select jsonb_build_array(jsonb_build_object('company_id','00000000-0000-4000-8000-000000009bc1','revision',1,'assessed_at',clock_timestamp()+interval '1 second','observations',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('kind','CLAIM','id','00000000-0000-4000-8000-000000009bc2','revision','00000000-0000-4000-8000-000000009bc3','label','Annual recurring revenue reached one million','truthClass','USER_CLAIM','evidenceStatus','SELF_REPORTED','lifecycleStatus','CURRENT')))));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'canonical current revision UUID authorizes without timestamp cast');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"not-a-revision"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'malformed revision fails closed without cast exception');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"2026-99-99T00:00:00Z"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'invalid calendar date fails closed without cast exception');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"2026-10-17T00:00:00Z"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'legacy dated revision remains supported');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'legacy historical source binds original asserted timestamp');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"2026-10-16T00:00:00Z"');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'valid but unrelated historical timestamp cannot claim lineage');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc3"');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',to_jsonb((clock_timestamp()-interval '1 day')::text));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'newer profile withholds stale current snapshot');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'profile touch does not erase authorized historical audit');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',to_jsonb((clock_timestamp()+interval '1 second')::text));
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id,change_reason)
values('00000000-0000-4000-8000-000000009bc4',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',2,'Annual recurring revenue reached two million','{"value":2000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'),'Corrected metric');
update evidence.claims set current_revision_id='00000000-0000-4000-8000-000000009bc4',current_revision_number=2,statement='Annual recurring revenue reached two million',structured_value='{"value":2000000}' where id='00000000-0000-4000-8000-000000009bc2';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'correction invalidates latest old revision');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'immutable public prior revision remains historically authorized');
update unicorn_structured_candidate set value=jsonb_set(jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc4"'),'{0,observations,0,source,label}','"Annual recurring revenue reached two million"');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'corrected canonical UUID authorizes current source');
insert into evidence.claim_revisions(id,tenant_id,claim_id,revision_number,statement,structured_value,truth_class,evidence_status,lifecycle_status,changed_by_type,changed_by_id,change_reason,valid_to)
values('00000000-0000-4000-8000-000000009bc5',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc2',3,'Annual recurring revenue reached two million','{"value":2000000}','USER_CLAIM','SELF_REPORTED','CURRENT','SYSTEM',pg_temp.rls_id('user_a'),'Metric expired',(select updated_at + interval '1 microsecond' from knowledge.company_profiles where company_id='00000000-0000-4000-8000-000000009bc1'));
update evidence.claims set current_revision_id='00000000-0000-4000-8000-000000009bc5',current_revision_number=3,valid_to=(select valid_to from evidence.claim_revisions where id='00000000-0000-4000-8000-000000009bc5') where id='00000000-0000-4000-8000-000000009bc2';
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,revision}','"00000000-0000-4000-8000-000000009bc5"');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,assessed_at}',(select to_jsonb(updated_at::text) from knowledge.company_profiles where company_id='00000000-0000-4000-8000-000000009bc1'));
select ok((select (value->0->>'assessed_at')::timestamptz < q.valid_to and q.valid_to < clock_timestamp() from unicorn_structured_candidate cross join evidence.claims q where q.id='00000000-0000-4000-8000-000000009bc2'),'fixture snapshot precedes actual source expiry');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'valid_to expiry withholds current even when snapshot predates expiry');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'expired public source retains dated historical audit');
update evidence.claims set visibility_scope='founder_private' where id='00000000-0000-4000-8000-000000009bc2';
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'privacy revocation withholds latest');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'privacy revocation also withholds history');
select ok(not has_function_privilege('authenticated','private.unicorn_potential_historical_revisions(jsonb)','execute'),'browser cannot invoke historical source oracle');
select ok(not has_function_privilege('anon','private.unicorn_potential_source_eligible_revisions(jsonb,boolean)','execute'),'anonymous cannot invoke common source oracle');
select ok(has_function_privilege('service_role','private.unicorn_potential_historical_revisions(jsonb)','execute'),'trusted service may reauthorize history');
update evidence.claims set visibility_scope='network_visible' where id='00000000-0000-4000-8000-000000009bc2';
update unicorn_structured_candidate set value=jsonb_set(value,'{0,company_id}',to_jsonb(pg_temp.rls_id('tenant_b')::text));
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'another canonical subject cannot reuse source lineage');
-- Retraction is section-specific and independent of review timestamp.
insert into evidence.documents(id,tenant_id,company_id,owner_organisation_id,document_type,title,created_by_user_id,download_audience)
values('00000000-0000-4000-8000-000000009bd1',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc1',pg_temp.rls_id('org_a'),'PITCH_DECK','Source guard test deck',pg_temp.rls_id('user_a'),'INVESTORS');
insert into evidence.document_versions(id,tenant_id,document_id,version_number,storage_bucket,storage_key,original_filename,mime_type,size_bytes,sha256,uploaded_by_user_id,malware_scan_status)
values('00000000-0000-4000-8000-000000009bd2',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bd1',1,'company-private','unicorn-source-guard/deck.pdf','deck.pdf','application/pdf',100,repeat('a',64),pg_temp.rls_id('user_a'),'CLEAN');
update evidence.documents set current_version_id='00000000-0000-4000-8000-000000009bd2' where id='00000000-0000-4000-8000-000000009bd1';
insert into evidence.deck_extractions(id,tenant_id,company_id,document_id,document_version_id,prompt_version,schema_version,sections)
values('00000000-0000-4000-8000-000000009bd3',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bc1','00000000-0000-4000-8000-000000009bd1','00000000-0000-4000-8000-000000009bd2',1,1,(select jsonb_agg('{}'::jsonb) from generate_series(1,12)));
insert into evidence.deck_section_reviews(id,tenant_id,extraction_id,section,action,reviewed_by_user_id,created_at)
values('00000000-0000-4000-8000-000000009bd4',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bd3','MARKET','CONFIRM',pg_temp.rls_id('user_a'),clock_timestamp()-interval '2 seconds');
insert into evidence.deck_section_reviews(id,tenant_id,extraction_id,section,action,reviewed_by_user_id,created_at)
values('00000000-0000-4000-8000-000000009bd7',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bd3','TEAM','CONFIRM',pg_temp.rls_id('user_a'),clock_timestamp()-interval '2 seconds');
update unicorn_structured_candidate set value=jsonb_build_array(jsonb_build_object('company_id','00000000-0000-4000-8000-000000009bc1','revision',2,'assessed_at',clock_timestamp()+interval '1 second','observations',jsonb_build_array(jsonb_build_object('source',jsonb_build_object('kind','DECK_SECTION','id','00000000-0000-4000-8000-000000009bd3:MARKET:0')))));
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),1,'confirmed open deck source authorizes current');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'confirmed open deck source authorizes history');
insert into evidence.deck_section_reviews(id,tenant_id,extraction_id,section,action,reviewed_by_user_id,created_at)
values('00000000-0000-4000-8000-000000009bd5',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bd3','MARKET','DISMISS',pg_temp.rls_id('user_a'),clock_timestamp()-interval '1 second');
select is((select count(*)::int from private.unicorn_potential_eligible_revisions((select value from unicorn_structured_candidate))),0,'pre-assessment-timestamp DISMISS revokes current source');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'DISMISS withdraws historical section too');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,id}','"00000000-0000-4000-8000-000000009bd3:TEAM:0"');
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'dismissal does not withdraw unrelated source section');
update unicorn_structured_candidate set value=jsonb_set(value,'{0,observations,0,source,id}','"00000000-0000-4000-8000-000000009bd3:MARKET:0"');
insert into evidence.deck_section_reviews(id,tenant_id,extraction_id,section,action,correction,reviewed_by_user_id)
values('00000000-0000-4000-8000-000000009bd6',pg_temp.rls_id('tenant_a'),'00000000-0000-4000-8000-000000009bd3','MARKET','CORRECT','Corrected founder statement',pg_temp.rls_id('user_a'));
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),1,'subsequent CORRECT preserves dated historical audit');
update evidence.documents set download_audience='ORGANISATION' where id='00000000-0000-4000-8000-000000009bd1';
select is((select count(*)::int from private.unicorn_potential_historical_revisions((select value from unicorn_structured_candidate))),0,'document privacy withdrawal still withholds corrected historical source');
select * from finish();
rollback;
